/* Anteprima del link di ogni partita: dati, indirizzo, PNG 1200×630 con e senza stemmi. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { setLang } from "../src/lib/i18n.js";
import * as M from "../src/lib/matchcard.js";
import { badge } from "../src/lib/cardkit.js";

const match = { id: "558549", home: "Milan", away: "Bologna", kickoff: "2026-10-28T23:30:00Z", prob: { p1: 0.4894, px: 0.266, p2: 0.2446 } };
const size = (data) => { const png = Buffer.from(data); return { png: png.readUInt32BE(0) === 0x89504e47, width: png.readUInt32BE(16), height: png.readUInt32BE(20) }; };

test("indirizzo uguale in italiano e in inglese", () => {
  setLang("it");
  const it = M.previewPath("SA", match);
  setLang("en");
  assert.equal(M.previewPath("SA", match), it);
  setLang("it");
  assert.equal(it, "/anteprime/serie-a/558549-milan-bologna.png");
});

test("dati: campionato, data in ora italiana, percentuali e scelta del modello evidenziata", () => {
  const d = M.matchCardData("SA", match);
  assert.equal(d.league, "SERIE A");
  assert.equal(d.date, "29.10.2026", "le 23:30 UTC sono già il 29 a Roma");
  assert.deepEqual(d.cells.map((c) => [c.code, c.value, c.hot]), [["1", "49%", true], ["X", "27%", false], ["2", "24%", false]]);
  assert.equal(d.home.crest, "");
  assert.equal(M.dateLabel("non una data"), "");
});

test("squadra senza stemma: iniziali nel cerchio", () => {
  const node = badge("", "Real Madrid", 100);
  assert.equal(JSON.stringify(node).includes('"RM"'), true);
  assert.equal(badge("data:image/png;base64,AAAA", "X", 100).type, "img");
});

test("PNG 1200×630, anche con nomi lunghi e senza stemmi", async () => {
  for (const m of [match, { ...match, home: "Borussia Mönchengladbach", away: "Olympique de Marseille" }]) {
    const png = await M.matchPng("EL", m);
    assert.deepEqual(size(png), { png: true, width: 1200, height: 630 });
  }
});
