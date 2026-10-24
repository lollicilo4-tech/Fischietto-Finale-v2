/* Grafici del Live Center: stessi controlli di tests/test_frontend_render.py sul sito attuale. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as C from "../src/lib/livecharts.js";
import * as F from "../src/lib/livefeed.js";

const fixture = JSON.parse(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tests/fixtures/sportscore_match.json"), "utf-8"));
const stat = (h, a) => [{ name: "Dangerous Attacks", home: h[0], away: a[0] }, { name: "Shots on Target", home: h[1], away: a[1] }];

test("curva delle probabilità minuto per minuto", () => {
  const events = C.lcEvents([{ minute: 30, type: "goal", side: "home", player: "A" }], "Casa", "Ospiti");
  const curve = C.lcCurve({ lh: 1.4, la: 1.1 }, events, 80, 1, 0);
  assert.equal(curve.length, 81);
  assert.ok(curve[80].p1 > curve[0].p1, "in vantaggio all'80' la probabilità di vittoria cresce");
  const p = curve[40];
  assert.ok(Math.abs(p.p1 + p.px + p.p2 - 1) < 1e-6);
  assert.equal(C.lcCurve({ lh: 1, la: 1 }, events, 80, 2, 0), null, "eventi che non spiegano il risultato");
});

test("risposta vera di SportScore (Zira-Sumgayit, 61')", () => {
  const m = C.lcMatchFromPayload(fixture);
  const events = C.lcEvents(C.lcTimelineOf(m), m.home, m.away);
  assert.deepEqual(events.map((e) => [e.minute, e.kind, e.side]),
    [[8, "goal", "home"], [10, "yellow", "home"], [21, "goal", "home"], [39, "goal", "away"], [56, "goal", "away"]], "il VAR non è un evento del grafico");
  const html = C.liveChartsHtml({ home: m.home, away: m.away, homeScore: m.home_score, awayScore: m.away_score, status: C.lcMinuteOf(m), events: C.lcTimelineOf(m), stats: m.stats, priors: [] });
  assert.ok(html.includes("Andamento della partita") && html.includes('class="lc-timeline"'));
  assert.ok(html.includes("medie generali"), "partita fuori dai nostri campionati");
  assert.ok(html.includes("invito a scommettere"));
});

test("pronostico di partenza dai nostri turni, anche con nomi leggermente diversi", () => {
  const prior = C.lcPrior([{ home: "Inter", away: "Fiorentina", xg: [2.1, 0.9] }], "FC Internazionale Inter", "ACF Fiorentina");
  assert.deepEqual(prior, { lh: 2.1, la: 0.9, model: true });
  assert.equal(C.lcPrior([], "A", "B").model, false);
});

test("momentum stimato: solo dai campioni registrati, senza inventare i minuti mancanti", () => {
  const store = { all: {} };
  C.lcRecordSample(store, "k", 10, C.lcStats(stat([10, 1], [5, 0])), 1000);
  C.lcRecordSample(store, "k", 11, C.lcStats(stat([14, 2], [5, 0])), 2000);
  const list = C.lcRecordSample(store, "k", 30, C.lcStats(stat([20, 2], [9, 1])), 3000);
  const bars = C.lcMomentumBars(list);
  assert.deepEqual(bars, [{ m: 11, v: 8 }], "salto di 19 minuti (pagina chiusa): nessuna barra");
  const old = C.lcRecordSample(store, "nuova", 5, C.lcStats(stat([1, 0], [0, 0])), 3000 + 7 * 3600 * 1000);
  assert.equal(Object.keys(store.all).length, 1, "le serie di più di 6 ore fa vengono scartate");
  assert.equal(old.length, 1);
});

test("feed live: unione delle fonti, filtro sul live, schede sicure", () => {
  const live = { id: 1, home: "A", away: "B", status: "finished", competition: "Serie A" };
  const recent = { id: 2, home: "<img src=x>", away: "D", status_text: "2nd half", competition: "Premier League", home_logo: "javascript:x" };
  const merged = F.combineSources([{ data: { fixtures: [live] }, verifiedLive: true }, { data: { matches: [live, recent, { id: 3, status: "FT" }] }, verifiedLive: false }, { failed: true }]);
  assert.equal(merged.length, 3, "nessun doppione");
  const onlyLive = F.liveOnly(merged);
  assert.deepEqual(onlyLive.map((m) => m.id), [1, 2], "la fonte fixtures è già live; le altre si filtrano per stato");
  const html = F.liveCardHtml(recent, []);
  assert.ok(!html.includes("<img src=x>") && !html.includes("javascript:"));
  assert.ok(html.includes('data-live-league="premier-league"'));
  assert.throws(() => F.combineSources([{ failed: true }, { failed: true }]));
  assert.ok(F.leagueOptions(onlyLive).startsWith('<option value="all">'));
});

test("campionati riconosciuti per nome intero, non per parole contenute", () => {
  const ours = {
    "Serie A": "serie-a", "Italy Serie A": "serie-a", "Serie A Enilive": "serie-a",
    "Premier League": "premier-league", "English Premier League": "premier-league",
    "UEFA Champions League": "champions-league", "Champions League": "champions-league",
    "UEFA Europa League": "europa-league", "UEFA Conference League": "conference-league", "UEFA Europa Conference League": "conference-league",
    "Bundesliga": "bundesliga", "LaLiga": "laliga", "La Liga": "laliga", "LaLiga EA Sports": "laliga", "Spain Primera División": "laliga",
    "Ligue 1": "ligue-1", "Ligue 1 McDonald's": "ligue-1", "Serie B": "serie-b", "Eredivisie": "eredivisie", "Liga Portugal Betclic": "liga-portugal"
  };
  for (const [name, key] of Object.entries(ours)) assert.equal(F.liveLeagueKey(name), key, name);
  const others = ["LigaPro Serie A", "Azerbaijan Premier League", "AFC Champions League", "CAF Champions League", "UEFA Women's Champions League",
    "2. Bundesliga", "LaLiga Hypermotion", "Primera División", "Ligue 2", "Russian Premier League", "Brasileirão Serie A", "Serie A Women"];
  for (const name of others) assert.match(F.liveLeagueKey(name), /^other:/, name);
});

test("minuto in corso come su SportScore", () => {
  const now = Date.parse("2026-10-24T14:10:00Z");
  const base = { time: "2026-10-24T13:00:00+00:00" };
  // Minuto esatto dal dettaglio (le partite dei nostri campionati arrivano da /api/live con live_minute).
  assert.deepEqual(F.liveMinute({ ...base, status_text: "2nd half", live_minute: "67" }, now), { phase: "2H", minute: 67, exact: true });
  assert.equal(F.minuteLabel(48, "1H"), "45+3'");
  assert.equal(F.minuteLabel(94, "2H"), "90+4'");
  assert.equal(F.minuteLabel(67, "2H"), "67'");
  assert.deepEqual(F.liveMinute({ ...base, status_text: "1st half", live_minute: "45+2" }, now).minute, 47);
  // Senza minuto: stima dall'orario (70 minuti dopo l'inizio, 2° tempo → 56').
  assert.deepEqual(F.liveMinute({ ...base, status_text: "2nd half" }, now), { phase: "2H", minute: 56, exact: false });
  assert.deepEqual(F.liveMinute({ ...base, status_text: "1st half" }, Date.parse("2026-10-24T13:20:30Z")).minute, 21);
  // Intervallo e fasi senza minuto.
  assert.deepEqual(F.liveMinute({ ...base, status_text: "Half time", live_minute: "45" }, now), { phase: "HT", minute: null, exact: false });
  const html = F.livePhaseHtml({ ...base, status_text: "2nd half", live_minute: "67" }, now);
  assert.match(html, /<b class="live-minute" data-minute="67" data-minute-at="\d+" data-phase="2H">67'<\/b>/);
  assert.match(html, /2° tempo/);
  assert.match(F.livePhaseHtml({ ...base, status_text: "Half time" }, now), /Intervallo/);
  assert.doesNotMatch(F.livePhaseHtml({ ...base, status_text: "Half time" }, now), /live-minute/);
  assert.match(F.livePhaseHtml({ ...base, status_text: "2nd half" }, now), /title="Minuto stimato/);
});
