/* Raccolta del momentum, eseguita dal cron ogni minuto.
   1. Una richiesta alla lista delle partite live di SportScore (le altre due fonti del Live Center
      solo se la prima non risponde o è vuota).
   2. Si tengono le partite dei nostri 8 campionati e, per ognuna, si legge il dettaglio.
   3. Dal dettaglio si calcolano minuto e indice di pressione con le STESSE funzioni del Live Center
      del sito (web/src/lib), così server e browser misurano il momentum nello stesso modo.
   4. Un campione per partita e minuto finisce in D1; il recupero del 1° tempo seguito dal 46'
      si unisce all'ultimo campione, come fa il browser.
   Piano gratuito Cloudflare: 50 richieste esterne e 10 ms di CPU per esecuzione, quindi al massimo
   MAX_DETAILS dettagli e solo calcoli leggeri. */
import {
  LIVE_ENDPOINTS, matchDetailUrl, rowsFrom, combineSources, liveOnly, leagueNameOf, liveLeagueKey,
  matchSlugOf, matchStatus, valueText
} from "../../../web/src/lib/livefeed.js";
import { lcMatchFromPayload, lcTimelineOf, lcMinuteOf, lcStats, lcPressure, lcNowMinute, lcEvents } from "../../../web/src/lib/livecharts.js";
import { LEAGUES } from "../../../web/src/lib/core.js";

export const MAX_DETAILS = 40;             // 40 dettagli + al massimo 3 liste < 50 richieste esterne
export const RETENTION_MS = 12 * 3600 * 1000;
const OUR_LEAGUES = new Set(LEAGUES.map((l) => l.liveKey));
const HEADERS = { Accept: "application/json", "User-Agent": "FischiettoFinale-Momentum/1.0 (+https://fischiettofinale.com)" };

async function getJson(fetchFn, url) {
  const init = { headers: HEADERS };
  if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) init.signal = AbortSignal.timeout(8000);
  const res = await fetchFn(url, init);
  if (!res.ok) throw new Error("HTTP " + res.status + " " + url);
  return res.json();
}

/* Partite in corso. La fonte "fixtures?status=live" basta quasi sempre: le altre si chiedono solo
   se fallisce o è vuota, per restare nel limite di richieste e di CPU. */
export async function fetchLive(fetchFn) {
  const load = (ep) => getJson(fetchFn, ep.url)
    .then((data) => ({ data, verifiedLive: ep.verifiedLive, failed: false }))
    .catch(() => ({ data: null, verifiedLive: ep.verifiedLive, failed: true }));
  const first = await load(LIVE_ENDPOINTS[0]);
  let results = [first];
  if (first.failed || !rowsFrom(first.data).length) results = results.concat(await Promise.all(LIVE_ENDPOINTS.slice(1).map(load)));
  return liveOnly(combineSources(results));  // lancia un errore se tutte le fonti falliscono
}

/* Solo le partite dei nostri campionati, una volta sola ciascuna, con uno slug utilizzabile. */
export function ourMatches(live) {
  const seen = new Set(), out = [];
  for (const m of live) {
    const slug = matchSlugOf(m);
    if (!slug || seen.has(slug) || !/^[a-z0-9][a-z0-9-]*$/i.test(slug)) continue;
    const league = leagueNameOf(m);
    if (!OUR_LEAGUES.has(liveLeagueKey(league))) continue;
    seen.add(slug);
    out.push({ slug, league, status: matchStatus(m),
      home: valueText(m.home || m.home_team || m.homeTeam || m.localteam || m.home_participant),
      away: valueText(m.away || m.away_team || m.awayTeam || m.visitorteam || m.away_participant) });
    if (out.length >= MAX_DETAILS) break;
  }
  return out;
}

/* Campione di una partita dal dettaglio SportScore: { slug, minute, h, a, ... } oppure null
   se il servizio non dà minuto o statistiche utili (nessun numero inventato). */
export function sampleFromPayload(info, payload) {
  const match = lcMatchFromPayload(payload);
  const timeline = lcTimelineOf(match);
  const status = lcMinuteOf(match, info.status);
  const minute = lcNowMinute(status, lcEvents(timeline, info.home, info.away));
  const pressure = lcPressure(lcStats(match && (match.statistics || match.stats || match.match_statistics)));
  if (minute == null || !pressure) return null;
  return { ...info, minute, h: pressure.h, a: pressure.a };
}

export async function fetchSamples(fetchFn, matches) {
  const settled = await Promise.allSettled(matches.map((info) => getJson(fetchFn, matchDetailUrl(info.slug)).then((p) => sampleFromPayload(info, p))));
  return { samples: settled.filter((r) => r.status === "fulfilled" && r.value).map((r) => r.value), failed: settled.filter((r) => r.status === "rejected").length };
}

/* Salva i campioni in un'unica operazione batch di D1. */
export async function storeSamples(db, samples, now) {
  if (!samples.length) return 0;
  const slugs = samples.map((s) => s.slug);
  const prev = await db.prepare("SELECT slug, last_minute FROM matches WHERE slug IN (" + slugs.map(() => "?").join(",") + ")").bind(...slugs).all();
  const last = new Map((prev.results || []).map((r) => [r.slug, r.last_minute]));
  const stmts = [];
  for (const s of samples) {
    const lastMinute = last.get(s.slug);
    // stesso minuto, o recupero del 1° tempo seguito dal 46': si aggiorna l'ultimo campione
    const minute = lastMinute != null && s.minute <= lastMinute ? lastMinute : s.minute;
    stmts.push(db.prepare(
      "INSERT INTO samples (slug, minute, h, a, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) " +
      "ON CONFLICT(slug, minute) DO UPDATE SET h = max(h, excluded.h), a = max(a, excluded.a), updated_at = excluded.updated_at"
    ).bind(s.slug, minute, s.h, s.a, now));
    stmts.push(db.prepare(
      "INSERT INTO matches (slug, home, away, league, last_minute, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) " +
      "ON CONFLICT(slug) DO UPDATE SET home = excluded.home, away = excluded.away, league = excluded.league, " +
      "last_minute = max(coalesce(last_minute, 0), excluded.last_minute), updated_at = excluded.updated_at"
    ).bind(s.slug, s.home, s.away, s.league, minute, now));
  }
  await db.batch(stmts);
  return samples.length;
}

export async function cleanup(db, now) {
  const before = now - RETENTION_MS;
  await db.batch([
    db.prepare("DELETE FROM samples WHERE updated_at < ?1").bind(before),
    db.prepare("DELETE FROM matches WHERE updated_at < ?1").bind(before)
  ]);
}

/* Un'esecuzione completa. Ritorna il riepilogo salvato in meta e mostrato da /health. */
export async function collect({ fetch: fetchFn, db, now = Date.now() }) {
  const report = { at: new Date(now).toISOString(), live: 0, ours: 0, saved: 0, failed: 0, error: null };
  try {
    const live = await fetchLive(fetchFn);
    const matches = ourMatches(live);
    report.live = live.length; report.ours = matches.length;
    const { samples, failed } = await fetchSamples(fetchFn, matches);
    report.failed = failed;
    report.saved = await storeSamples(db, samples, now);
    if (new Date(now).getUTCMinutes() === 0) await cleanup(db, now);
  } catch (e) {
    report.error = String((e && e.message) || e).slice(0, 300);
  }
  await db.prepare("INSERT INTO meta (key, value) VALUES ('last_run', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(JSON.stringify(report)).run();
  return report;
}
