/* Esempio vero in Come funziona: scelta della partita e testo in due lingue con i numeri pubblicati. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { setLang } from "../src/lib/i18n.js";
import { exampleMatch, exampleHtml } from "../src/lib/example.js";

const M = (id, home, away, p1, px, p2, xg, top, pick) => ({ id, home, away, kickoff: "2026-11-01T11:30:00Z", prob: { p1, px, p2 }, xg, top_scores: top, pick_score: pick });
const turno = { matches: [
  M("1", "Milan", "Inter", 0.4, 0.27, 0.33, [1.5, 1.3], [[1, 1, 0.12], [1, 0, 0.1], [2, 1, 0.09]], [1, 0, 0.1]),
  M("2", "Como 1907", "Venezia FC", 0.71, 0.19, 0.1, [2.09, 0.65], [[2, 0, 0.14], [1, 0, 0.13], [3, 0, 0.1]], [2, 0, 0.14]),
  { id: "3", home: "Senza", away: "Dati" }
] };

test("sceglie la partita con il favorito più netto, ignora quelle senza dati", () => {
  assert.equal(exampleMatch(turno).id, "2");
  assert.equal(exampleMatch(null), null);
  assert.equal(exampleHtml("SA", null), "");
});

test("testo con i numeri veri, in italiano e in inglese", () => {
  setLang("it");
  const it = exampleHtml("SA", exampleMatch(turno), "it");
  assert.match(it, /Como 1907 2,09 gol attesi/);
  assert.match(it, /1 71% · X 19% · 2 10%/);
  assert.match(it, /risultato previsto .*<b>2-0<\/b> \(14%\)/);
  assert.match(it, /non vince 3 volte su 10/);
  assert.match(it, /href="\/serie-a\/partita\/2-como-1907-venezia-fc\/"/);
  assert.doesNotMatch(it, /undefined|NaN/);
  setLang("en");
  const en = exampleHtml("SA", exampleMatch(turno), "en");
  assert.match(en, /Como 1907 2.09 expected goals/);
  assert.match(en, /fails to win 3 times out of 10/);
  setLang("it");
});
