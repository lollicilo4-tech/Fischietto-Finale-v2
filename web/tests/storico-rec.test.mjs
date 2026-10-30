/* Storico del pronostico del modello: numeri, elenco con l'1X2 accanto, inglese, caso senza dati. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { setLang } from "../src/lib/i18n.js";
import { recommendationParts } from "../src/lib/render.js";

const h = {
  recommendation_performance: { n: 30, hit: 24, avg_p: 0.75 },
  items: [
    { match: "Fiorentina – Atalanta", pick: "2", p: 0.45, score: "2-2", ok: false, rec: { code: "x2_o15", label: "X2 + Over 1,5", p: 0.5486, ok: true } },
    { match: "Roma – Cagliari", pick: "1", p: 0.63, score: "4-2", ok: true, rec: { code: "Under 3,5", label: "Under 3,5", p: 0.7, ok: false } },
    { match: "Vecchia – Partita", pick: "1", p: 0.5, score: "1-0", ok: true }
  ]
};

test("numeri e partite, con l'esito 1X2 accanto", () => {
  setLang("it");
  const r = recommendationParts(h);
  assert.match(r.hero, /80% <small>pronostico azzeccato/);
  assert.match(r.hero, /<b>24<\/b> pronostici corretti su <b>30<\/b>, con una probabilità media dichiarata del 75%/);
  assert.match(r.list, /Fiorentina – Atalanta · 2-2<\/b><small>Esito 1X2: 2 ✕<\/small><\/span><b class="ok">X2 \+ Over 1,5 · 55% ✓/);
  assert.match(r.list, /class="ko">Under 3,5 · 70% ✕/);
  assert.doesNotMatch(r.list, /Vecchia/);
  setLang("en");
  const en = recommendationParts(h);
  assert.match(en.hero, /prediction correct/);
  assert.match(en.list, /1X2 outcome: 2 ✕/);
  assert.match(en.list, /Over 1\.5/);
  setLang("it");
  assert.match(recommendationParts({}).hero, /si salva da poco/);
});
