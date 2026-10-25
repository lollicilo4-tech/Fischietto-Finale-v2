/* Avvisi via email: quando partono, quante volte, e che l'indirizzo non finisca mai in /health. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateAlerts, runAlerts, FEED_DOWN_MS, FEED_EMPTY_MS, UNRESOLVED_MS, REPEAT_MS, MAX_PER_DAY } from "../src/alerts.js";
import worker from "../src/index.js";
import { fakeD1 } from "./fake-d1.mjs";

const T0 = Date.parse("2026-10-25T15:00:00Z");
const MIN = 60000;
const ok = { error: null, unresolved: [], calendarUpdated: "2026-10-26T00:00:00Z" };  // aggiornamento recente per tutta la durata dei test
const keys = (r) => r.alerts.map((a) => a.key);

test("tutto a posto: solo l'email di prova, una volta", () => {
  const r1 = evaluateAlerts(ok, {}, T0);
  assert.deepEqual(keys(r1), ["welcome"]);
  const r2 = evaluateAlerts(ok, r1.state, T0 + MIN);
  assert.deepEqual(keys(r2), []);
});

test("avvisi spenti senza ALERT_TO: niente email, ma lo stato si aggiorna", () => {
  const r = evaluateAlerts({ ...ok, error: "All SportScore live endpoints failed" }, {}, T0, { configured: false });
  assert.deepEqual(keys(r), []);
  assert.equal(r.state.feedDownSince, T0);
});

test("SportScore giù: avviso dopo 10 minuti, ripetuto non prima di 6 ore", () => {
  const down = { ...ok, error: "All SportScore live endpoints failed" };
  let st = evaluateAlerts(ok, {}, T0).state;
  st = evaluateAlerts(down, st, T0 + MIN).state;
  assert.deepEqual(keys(evaluateAlerts(down, st, T0 + 5 * MIN)), []);
  const r = evaluateAlerts(down, st, T0 + MIN + FEED_DOWN_MS);
  assert.deepEqual(keys(r), ["feed"]);
  assert.match(r.alerts[0].lines.join(" "), /10 minuti/);
  assert.deepEqual(keys(evaluateAlerts(down, r.state, T0 + 2 * FEED_DOWN_MS)), []);
  assert.deepEqual(keys(evaluateAlerts(down, r.state, T0 + MIN + FEED_DOWN_MS + REPEAT_MS)), ["feed"]);
  // Torna a funzionare: il conteggio riparte da zero.
  assert.equal(evaluateAlerts(ok, r.state, T0 + 3 * FEED_DOWN_MS).state.feedDownSince, null);
});

test("partita non trovata per 20 minuti: un avviso con il nome", () => {
  const miss = { ...ok, unresolved: ["Celta - Real Betis"] };
  let st = evaluateAlerts(ok, {}, T0).state;
  st = evaluateAlerts(miss, st, T0 + MIN).state;
  const r = evaluateAlerts(miss, st, T0 + MIN + UNRESOLVED_MS);
  assert.deepEqual(keys(r), ["unresolved:Celta - Real Betis"]);
  assert.match(r.alerts[0].lines.join(" "), /SEARCH_ALIASES/);
  // Trovata poco dopo: niente più avvisi né stato.
  assert.deepEqual(evaluateAlerts(ok, r.state, T0 + 30 * MIN).state.unresolvedSince, {});
});

test("pronostici fermi da più di 6 ore", () => {
  const r = evaluateAlerts({ ...ok, calendarUpdated: "2026-10-25T06:00:00Z" }, { welcomeSent: true }, T0);
  assert.deepEqual(keys(r), ["stale"]);
  assert.match(r.alerts[0].subject, /9 ore/);
});

test("al massimo MAX_PER_DAY email al giorno", () => {
  const many = { ...ok, unresolved: Array.from({ length: 10 }, (_, i) => "Casa" + i + " - Ospite" + i) };
  let st = evaluateAlerts(many, { welcomeSent: true }, T0).state;
  const r = evaluateAlerts(many, st, T0 + UNRESOLVED_MS);
  assert.equal(r.alerts.length, MAX_PER_DAY);
});

test("runAlerts manda con il binding EMAIL e riprova gli avvisi non partiti", async () => {
  const db = fakeD1(), sent = [];
  let fail = true;
  const env = { DB: db, ALERT_TO: "proprietario@example.com", EMAIL: { send: async (m) => { if (fail) throw new Error("destination address not verified"); sent.push(m); } } };
  const r1 = await runAlerts(env, ok, T0);
  assert.deepEqual([r1.configured, r1.sent], [true, 0]);
  const health = await (await worker.fetch(new Request("https://w.example/health"), { DB: db })).json();
  assert.deepEqual(health.alerts, { configured: true, welcomeSent: false, lastError: "destination address not verified", sentToday: 0 });
  assert.ok(!JSON.stringify(health).includes("proprietario@example.com"), "l'indirizzo non compare in /health");
  fail = false;
  const r2 = await runAlerts(env, ok, T0 + MIN);
  assert.equal(r2.sent, 1);
  assert.equal(sent[0].to, "proprietario@example.com");
  assert.equal(sent[0].from.email, "avvisi@fischiettofinale.com");
  assert.match(sent[0].subject, /Avvisi attivi/);
  assert.equal((await runAlerts(env, ok, T0 + 2 * MIN)).sent, 0);
});

test("senza binding o senza ALERT_TO non si manda niente", async () => {
  const db = fakeD1();
  const r = await runAlerts({ DB: db }, { ...ok, error: "All SportScore live endpoints failed" }, T0);
  assert.deepEqual([r.configured, r.sent], [false, 0]);
});

test("lista live vuota da un'ora: un avviso (non dipende dal sito)", () => {
  const empty = { ...ok, sources: [{ url: "/api/v1/fixtures/", rows: 0 }, { url: "/api/v1/matches/", rows: 50 }] };
  let st = evaluateAlerts(empty, { welcomeSent: true }, T0).state;
  assert.deepEqual(keys(evaluateAlerts(empty, st, T0 + 30 * MIN)), []);
  assert.deepEqual(keys(evaluateAlerts(empty, st, T0 + FEED_EMPTY_MS)), ["feed-empty"]);
  const full = { ...ok, sources: [{ url: "/api/v1/fixtures/", rows: 80 }] };
  assert.equal(evaluateAlerts(full, st, T0 + FEED_EMPTY_MS).state.feedEmptySince, null);
});
