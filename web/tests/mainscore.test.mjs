/* Risultato previsto: in linea con l'esito più probabile (pick_score), con top_scores[0] come riserva. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { setLang } from "../src/lib/i18n.js";
import { mainScore, otherScores } from "../src/lib/model.js";
import { card, shareText } from "../src/lib/render.js";
import { todayItems } from "../src/lib/today.js";

const base = {
  id: "1", home: "Milan", away: "Bologna", kickoff: "2026-10-28T17:30:00Z", conf: "media", xg: [1.6, 1.2], xg_base: [1.6, 1.2],
  prob: { p1: 0.46, px: 0.27, p2: 0.27, o15: 0.75, o25: 0.5, u25: 0.5, u35: 0.75, gg: 0.5, ng: 0.5 },
  top_scores: [[1, 1, 0.118], [1, 0, 0.101], [2, 1, 0.097]],
  pick_score: [1, 0, 0.101], markets: {}, form: { home: "", away: "" },
  analysis: { ai: false, text: "x", sources: [], absences_home: [], absences_away: [], factor_home: 1, factor_away: 1 }
};

test("pick_score quando torna con l'esito, altrimenti top_scores[0]", () => {
  assert.deepEqual(mainScore(base), [1, 0, 0.101]);
  assert.deepEqual(mainScore({ ...base, pick_score: undefined }), [1, 1, 0.118], "dati vecchi");
  assert.deepEqual(mainScore({ ...base, pick_score: [0, 2, 0.05] }), [1, 1, 0.118], "non in linea con l'esito 1");
  assert.deepEqual(mainScore({ ...base, pick_score: ["a", 0, 0.1] }), [1, 1, 0.118]);
  assert.deepEqual(otherScores(base).map((x) => x.slice(0, 2)), [[1, 1], [2, 1]], "l'1-1 resta tra gli altri");
});

test("la scheda, il testo da condividere e Oggi in campo mostrano il risultato previsto", () => {
  setLang("it");
  const html = card({ league: "SA", favs: [] }, base, 0);
  assert.match(html, /<div class="match-score"><strong>1-0<\/strong>/);
  assert.match(html, /Risultato previsto<\/span><b>1-0<\/b>/);
  assert.match(html, /altri probabili: 1-1 12%, 2-1 10%/);
  assert.doesNotMatch(html, /Risultato esatto più probabile|Risultato più probabile/);
  assert.match(shareText(base), /risultato previsto 1-0/);
  assert.equal(todayItems({ SA: { matches: [base] } })[0].score, "1-0");
  setLang("en");
  assert.match(card({ league: "SA", favs: [] }, base, 0), /Predicted score<\/span><b>1-0<\/b>.*also likely: 1-1 12%/s);
  setLang("it");
});
