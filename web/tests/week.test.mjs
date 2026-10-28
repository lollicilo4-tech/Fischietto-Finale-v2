/* Riepilogo della settimana: finestra di 7 giorni, numeri, colpi migliori e flop, testo in due lingue, immagini. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { setLang } from "../src/lib/i18n.js";
import * as W from "../src/lib/week.js";
import { weekStoryTree, weekPreviewTree } from "../src/lib/weekcard.js";
import { renderPng, STORY, PREVIEW } from "../src/lib/cardkit.js";

const NOW = Date.parse("2026-10-28T12:00:00Z");
const G = (id, home, away, kickoff, pick, pick_p, hg, ag, ok, exact = false) => ({ id, home, away, kickoff, pick, pick_p, p_actual: ok ? pick_p : 0.2, hg, ag, ok, exact });
const storici = {
  SA: { week: [G("1", "Milan", "Bologna", "2026-10-27T19:45:00Z", "1", 0.49, 2, 0, true, true), G("2", "Genoa", "Juventus", "2026-10-26T19:45:00Z", "2", 0.71, 1, 1, false),
    G("old", "Roma", "Lazio", "2026-10-19T19:45:00Z", "1", 0.5, 1, 0, true), G("bad", "X", "Y", "non è una data", "1", 0.5, 1, 0, true)] },
  PL: { week: [G("3", "Arsenal", "Chelsea", "2026-10-25T16:30:00Z", "X", 0.31, 0, 0, true), G("4", "Spurs", "Leeds", "2026-10-25T14:00:00Z", "1", 0.62, 0, 1, false)] },
  CL: null
};

test("solo gli ultimi 7 giorni, con il campionato, dalla più recente", () => {
  const items = W.weekItems(storici, NOW);
  assert.deepEqual(items.map((x) => x.id), ["1", "2", "3", "4"]);
  assert.equal(items[0].league, "SA");
  assert.equal(items[2].name, "Premier League");
  assert.deepEqual(W.weekItems({}, NOW), []);
});

test("numeri, campionati, colpi migliori e flop", () => {
  setLang("it");
  const s = W.weekSummary(W.weekItems(storici, NOW));
  assert.deepEqual([s.n, s.hit, s.exact], [4, 2, 1]);
  assert.equal(Math.round(s.expected * 100), 213);
  assert.deepEqual(s.leagues.map((r) => [r.code, r.hit, r.n]), [["SA", 1, 2], ["PL", 1, 2]]);
  assert.deepEqual(s.best.map((x) => x.id), ["1", "3"], "prima il risultato esatto");
  assert.deepEqual(s.flops.map((x) => x.id), ["2", "4"], "prima l'errore più convinto");
  assert.equal(W.rangeLabel(s), "25 – 27 ottobre");
  assert.equal(W.rangeLabel({ from: "2026-10-29", to: "2026-11-04" }), "29 ottobre – 4 novembre");
  assert.equal(W.rangeLabel({ from: "2026-10-29", to: "2026-10-29" }), "29 ottobre");
});

test("HTML in italiano e in inglese, anche senza partite", () => {
  const items = W.weekItems(storici, NOW);
  setLang("it");
  const it = W.weekHtml(W.weekSummary(items));
  assert.match(it, /<b>2<\/b> su 4/);
  assert.match(it, /href="\/serie-a\/storico\/"/);
  assert.doesNotMatch(it, /undefined|NaN/);
  setLang("en");
  const en = W.weekHtml(W.weekSummary(items));
  assert.match(en, /out of 4/);
  assert.match(en, /Best calls/);
  assert.match(W.weekHtml(W.weekSummary([])), /No finished matches/);
  setLang("it");
});

test("immagini della misura giusta, con e senza partite", async () => {
  setLang("it");
  for (const s of [W.weekSummary(W.weekItems(storici, NOW)), W.weekSummary([])]) {
    const story = Buffer.from(await renderPng(weekStoryTree(s), STORY));
    assert.deepEqual([story.readUInt32BE(16), story.readUInt32BE(20)], [1080, 1920]);
    const prev = Buffer.from(await renderPng(weekPreviewTree(s), PREVIEW));
    assert.deepEqual([prev.readUInt32BE(16), prev.readUInt32BE(20)], [1200, 630]);
  }
});
