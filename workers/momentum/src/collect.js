/* Raccolta del momentum, eseguita dal cron ogni minuto.
   1. Una richiesta alla lista delle partite live di SportScore (le altre due fonti del Live Center
      solo se la prima non risponde o è vuota).
   2. Si tengono le partite dei nostri 8 campionati e, per ognuna, si legge il dettaglio.
   3. Dal dettaglio si calcolano minuto e indice di pressione con le STESSE funzioni del Live Center
      del sito (web/src/lib), così server e browser misurano il momentum nello stesso modo.
   4. Un campione per partita e minuto finisce in D1; il recupero del 1° tempo seguito dal 46'
      si unisce all'ultimo campione, come fa il browser.
   5. La lista live di SportScore spesso non contiene i campionati principali: le partite del nostro
      calendario iniziate da poco si cercano anche per nome (src/calendar.js). Il riassunto di ogni
      partita trovata (squadre, punteggio, minuto) va in D1 e il sito lo mostra nel Live (/api/live).
   Piano gratuito Cloudflare: 50 richieste esterne e 10 ms di CPU per esecuzione, quindi al massimo
   REQUEST_LIMIT richieste e solo calcoli leggeri. */
import {
  LIVE_ENDPOINTS, matchDetailUrl, rowsFrom, combineSources, liveOnly, leagueNameOf, liveLeagueKey,
  matchSlugOf, matchStatus, valueText, isLiveStatus
} from "../../../web/src/lib/livefeed.js";
import { lcMatchFromPayload, lcTimelineOf, lcMinuteOf, lcStats, lcPressure, lcNowMinute, lcEvents } from "../../../web/src/lib/livecharts.js";
import { LEAGUES } from "../../../web/src/lib/core.js";
import { CALENDAR_URL, dueMatches, resolveDue, matchKey } from "./calendar.js";

export const MAX_DETAILS = 30;             // partite dalla lista live
export const REQUEST_LIMIT = 48;           // richieste esterne per esecuzione (limite del piano: 50)
export const RETENTION_MS = 12 * 3600 * 1000;
export const LIVE_ROW_MS = 3 * 60 * 1000;  // /api/live mostra solo righe aggiornate negli ultimi 3 minuti
/* Campi del dettaglio SportScore che servono alla scheda del Live (niente eventi e statistiche). */
const ROW_FIELDS = ["home", "away", "home_logo", "away_logo", "home_score", "away_score", "status", "status_text",
  "time", "competition", "competition_logo", "url", "live_minute"];
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
export async function fetchLive(fetchFn, sources = []) {
  const load = (ep) => getJson(fetchFn, ep.url)
    .then((data) => { sources.push({ url: ep.url.split("?")[0].replace("https://sportscore.com", ""), rows: rowsFrom(data).length }); return { data, verifiedLive: ep.verifiedLive, failed: false }; })
    .catch((e) => { sources.push({ url: ep.url.split("?")[0].replace("https://sportscore.com", ""), error: String((e && e.message) || e).split(" http")[0].slice(0, 60) }); return { data: null, verifiedLive: ep.verifiedLive, failed: true }; });
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

/* Riassunto di una partita per la lista del Live: gli stessi campi della lista SportScore. */
export function liveRowFromPayload(payload) {
  const m = payload && payload.match;
  if (!m || typeof m !== "object" || !m.home || !m.away) return null;
  const row = {};
  ROW_FIELDS.forEach((k) => { if (m[k] != null && typeof m[k] !== "object") row[k] = String(m[k]); });
  return row;
}

/* Cache di slug in D1 per le partite del calendario e le loro squadre. */
async function loadCaches(db, due) {
  const teamCache = new Map(), matchCache = new Map();
  if (!due.length) return { teamCache, matchCache };
  const keys = due.map(matchKey), names = [...new Set(due.flatMap((m) => [m.home, m.away]))];
  const marks = (list) => list.map(() => "?").join(",");
  const [ms, ts] = await Promise.all([
    db.prepare("SELECT match_key, slug, tries, updated_at FROM match_slugs WHERE match_key IN (" + marks(keys) + ")").bind(...keys).all(),
    db.prepare("SELECT name, slugs FROM team_slugs WHERE name IN (" + marks(names) + ")").bind(...names).all()
  ]);
  (ms.results || []).forEach((r) => matchCache.set(r.match_key, { slug: r.slug, tries: r.tries || 0, updatedAt: r.updated_at || 0 }));
  (ts.results || []).forEach((r) => { try { const v = JSON.parse(r.slugs); if (Array.isArray(v)) teamCache.set(r.name, v); } catch (e) { /* riga rovinata: si ricerca */ } });
  return { teamCache, matchCache };
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
    db.prepare("DELETE FROM matches WHERE updated_at < ?1").bind(before),
    db.prepare("DELETE FROM live_rows WHERE updated_at < ?1").bind(before),
    db.prepare("DELETE FROM match_slugs WHERE updated_at < ?1").bind(now - 4 * RETENTION_MS)
  ]);
}

/* Un'esecuzione completa. Ritorna il riepilogo salvato in meta e mostrato da /health. */
export async function collect({ fetch: fetchFn, db, now = Date.now(), calendarUrl = CALENDAR_URL }) {
  const report = { at: new Date(now).toISOString(), live: 0, ours: 0, saved: 0, failed: 0, error: null };
  let used = 0;
  const counted = (url, init) => { used++; return fetchFn(url, init); };
  const get = (url) => getJson(counted, url);
  try {
    // 1. Lista live di SportScore. Se non risponde si va avanti con il calendario, ma l'errore resta
    //    nel riepilogo (e /health lo segnala).
    let live = [];
    report.sources = [];
    try { live = await fetchLive(counted, report.sources); } catch (e) { report.error = String((e && e.message) || e).slice(0, 300); }
    const listed = ourMatches(live);
    report.live = live.length; report.ours = listed.length;
    // Nomi dei campionati visti e quali sono stati riconosciuti come nostri: servono a controllare
    // il riconoscimento sui dati veri (si leggono da /health).
    report.leagues = [...new Set(live.map(leagueNameOf))].slice(0, 40);
    report.ourLeagues = [...new Set(listed.map((m) => m.league))];

    // 2. Partite del nostro calendario che dovrebbero essere in corso, cercate per nome.
    let due = [];
    try { const cal = await get(calendarUrl); due = dueMatches(cal && cal.matches, now); report.calendarUpdated = (cal && cal.updated) || null; }
    catch (e) { report.calendarError = String((e && e.message) || e).slice(0, 120); }
    const { teamCache, matchCache } = await loadCaches(db, due);
    const { resolved, budget, changedTeams, changedMatches } = await resolveDue({ due, teamCache, matchCache, getJson: get, matchDetailUrl, now });
    report.calendar = due.length;
    report.searches = budget.searches; report.guesses = budget.guesses;
    report.unresolved = resolved.filter((r) => !r.slug).map((r) => r.cal.home + " - " + r.cal.away);

    // 3. Dettagli: prima quelli già scaricati per trovare lo slug, poi gli altri finché c'è budget.
    const infos = new Map(), prefetched = new Map();
    listed.forEach((m) => infos.set(m.slug, m));
    resolved.forEach((r) => {
      if (!r.slug) return;
      if (r.payload) prefetched.set(r.slug, r.payload);
      if (!infos.has(r.slug)) infos.set(r.slug, { slug: r.slug, league: r.cal.liveKey, status: "", home: r.cal.home, away: r.cal.away });
    });
    const ready = [], toFetch = [];
    infos.forEach((info) => (prefetched.has(info.slug) ? ready : toFetch).push(info));
    const room = Math.max(0, REQUEST_LIMIT - used);
    const settled = await Promise.allSettled(toFetch.slice(0, room).map((info) => get(matchDetailUrl(info.slug)).then((payload) => ({ info, payload }))));
    report.failed = settled.filter((r) => r.status === "rejected").length;
    if (toFetch.length > room) report.skipped = toFetch.length - room;
    const payloads = ready.map((info) => ({ info, payload: prefetched.get(info.slug) }))
      .concat(settled.filter((r) => r.status === "fulfilled").map((r) => r.value));

    // 4. Campioni di momentum e righe del Live.
    const samples = [], rows = [];
    for (const { info, payload } of payloads) {
      const m = (payload && payload.match) || {};
      const full = { ...info, home: valueText(m.home) || info.home, away: valueText(m.away) || info.away,
        league: m.competition ? String(m.competition) : info.league, status: matchStatus(m) || info.status };
      const sample = sampleFromPayload(full, payload);
      if (sample) samples.push(sample);
      const row = liveRowFromPayload(payload);
      if (row) rows.push({ slug: info.slug, league: liveLeagueKey(full.league), row, live: isLiveStatus(m) ? 1 : 0 });
    }
    report.saved = await storeSamples(db, samples, now);
    report.rows = rows.filter((r) => r.live).length;
    report.requests = used;

    // 5. Righe del Live e cache degli slug in un'unica operazione.
    const stmts = rows.map((r) => db.prepare(
      "INSERT INTO live_rows (slug, league, row, live, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) " +
      "ON CONFLICT(slug) DO UPDATE SET league = excluded.league, row = excluded.row, live = excluded.live, updated_at = excluded.updated_at"
    ).bind(r.slug, r.league, JSON.stringify(r.row), r.live, now));
    changedTeams.forEach((name) => stmts.push(db.prepare(
      "INSERT INTO team_slugs (name, slugs, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(name) DO UPDATE SET slugs = excluded.slugs, updated_at = excluded.updated_at"
    ).bind(name, JSON.stringify(teamCache.get(name) || []), now)));
    changedMatches.forEach((key) => { const v = matchCache.get(key); stmts.push(db.prepare(
      "INSERT INTO match_slugs (match_key, slug, tries, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(match_key) DO UPDATE SET slug = excluded.slug, tries = excluded.tries, updated_at = excluded.updated_at"
    ).bind(key, v.slug, v.tries, now)); });
    if (stmts.length) await db.batch(stmts);
    if (new Date(now).getUTCMinutes() === 0) await cleanup(db, now);
  } catch (e) {
    report.error = String((e && e.message) || e).slice(0, 300);
  }
  await db.prepare("INSERT INTO meta (key, value) VALUES ('last_run', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(JSON.stringify(report)).run();
  return report;
}
