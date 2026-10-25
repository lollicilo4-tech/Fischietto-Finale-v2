/* "I miei pronostici": regole della sfida, risultati, HTML. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyStore, parseStore, setPick, withResults, challengeStats, pickerHtml, myPageHtml, isOpen, MAX_PICKS } from "../src/lib/mypicks.js";

const NOW = Date.parse("2026-10-25T10:00:00Z");
const inter = { league: "SA", id: "558563", home: "Inter", away: "Fiorentina", kickoff: "2026-10-25T11:30:00Z" };
const lazio = { league: "SA", id: "558565", home: "Lazio", away: "Parma", kickoff: "2026-10-24T18:45:00Z" };

test("si sceglie prima del calcio d'inizio, si cambia e si toglie", () => {
  let s = setPick(emptyStore(), inter, "1", NOW);
  assert.equal(s.picks["SA:558563"].pick, "1");
  s = setPick(s, inter, "X", NOW);
  assert.equal(s.picks["SA:558563"].pick, "X");
  s = setPick(s, inter, "X", NOW);
  assert.equal(s.picks["SA:558563"], undefined, "toccare di nuovo lo toglie");
  assert.deepEqual(setPick(emptyStore(), lazio, "1", NOW).picks, {}, "partita iniziata: niente pronostico");
  assert.equal(isOpen(null, NOW), true);
  assert.deepEqual(parseStore("rotto"), emptyStore());
});

test("risultati: si salvano con il pronostico e si contano tu contro modello", () => {
  let s = setPick(emptyStore(), inter, "1", NOW);
  s = setPick(s, { ...lazio, kickoff: "2026-10-26T18:45:00Z" }, "2", NOW);
  const res = { "SA:558563": { hg: 2, ag: 0, actual: "1", model: "1" }, "SA:558565": { hg: 1, ag: 1, actual: "X", model: "1" } };
  const { store, changed } = withResults(s, res);
  assert.equal(changed, true);
  assert.equal(withResults(store, res).changed, false, "una volta sola");
  const st = challengeStats(store);
  assert.deepEqual([st.total, st.you, st.modelTotal, st.model], [2, 1, 2, 1]);
});

test("oltre MAX_PICKS si tolgono i più vecchi", () => {
  let s = emptyStore();
  for (let i = 0; i < MAX_PICKS + 5; i++) s = setPick(s, { league: "PL", id: String(i), home: "A", away: "B", kickoff: null }, "1", NOW + i);
  assert.equal(Object.keys(s.picks).length, MAX_PICKS);
  assert.equal(s.picks["PL:0"], undefined);
});

test("HTML: pulsanti della scheda e pagina della sfida, senza parole da scommessa", () => {
  const s = setPick(emptyStore(), inter, "2", NOW);
  const html = pickerHtml(inter, s, NOW);
  assert.match(html, /data-my-pick="2" aria-pressed="true">2 · Fiorentina/);
  assert.doesNotMatch(html, /disabled/);
  assert.match(pickerHtml(inter, s, Date.parse("2026-10-25T12:00:00Z")), /disabled/);
  const done = withResults(s, { "SA:558563": { hg: 2, ag: 0, actual: "1", model: "1" } }).store;
  const page = myPageHtml(done, NOW);
  assert.match(page, /La sfida/);
  assert.match(page, /0 su 1/);
  assert.match(page, /Inter – Fiorentina <span class="num">2-0<\/span>/);
  assert.match(myPageHtml(emptyStore(), NOW), /Nessun pronostico ancora/);
  assert.doesNotMatch(page + html, /\b(quot[ae]|scommess[ae]|vinci|puntat[ae])\b/i);
  assert.ok(!myPageHtml(setPick(emptyStore(), { ...inter, home: "<script>" }, "1", NOW), NOW).includes("<script>"), "nomi sempre con esc()");
});
