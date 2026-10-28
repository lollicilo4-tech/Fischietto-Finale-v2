/* Stemmi delle squadre: elenco dal build, <img> nelle pagine, PNG 64×64 generati da resvg. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setCrests, crestSrc, crestImg } from "../src/lib/crests.js";
import { card, tableHtml, teamPage } from "../src/lib/render.js";
import { todayItems, todayHtml } from "../src/lib/today.js";
import { setLang } from "../src/lib/i18n.js";

const PNG_STEM = "0123456789abcdef", SVG_STEM = "fedcba9876543210", BAD_STEM = "aaaaaaaaaaaaaaaa";
const match = { id: 1, home: "Inter", away: "Milan", kickoff: "2026-10-28T19:45:00Z", conf: "media", prob: { p1: 0.5, px: 0.3, p2: 0.2, o25: 0.5, u25: 0.5, gg: 0.5, ng: 0.5 },
  xg: [1.6, 1.0], xg_base: [1.6, 1.0], top_scores: [[1, 0, 0.12], [1, 1, 0.1]], form: { home: "VVN", away: "PNV" }, last: {}, h2h: [],
  analysis: { ai: false, text: "x", sources: [], absences_home: [], absences_away: [], factor_home: 1, factor_away: 1 } };

test("indirizzi e <img> solo per squadre con uno stemma valido", () => {
  setCrests({ SA: { Inter: PNG_STEM + ".png", Milan: SVG_STEM + ".svg", Roma: "../evil.png" } });
  assert.equal(crestSrc("SA", "Inter"), "/stemmi/" + PNG_STEM + ".png");
  assert.equal(crestSrc("SA", "Milan"), "/stemmi/" + SVG_STEM + ".png", "anche gli SVG diventano PNG");
  assert.equal(crestSrc("SA", "Roma"), "", "nome di file non valido");
  assert.equal(crestSrc("PL", "Inter"), "");
  assert.match(crestImg("SA", "Inter", 20, "crest-row"), /^<img class="crest crest-row" src="\/stemmi\/0123456789abcdef\.png" alt="" width="20" height="20" loading="lazy" decoding="async">$/);
  setLang("it");
  const html = card({ league: "SA", favs: [] }, match, 0);
  assert.equal((html.match(/class="crest /g) || []).length, 4, "scheda e Match Center");
  assert.match(html, /mc-teams has-crest/);
  assert.match(tableHtml({ league: "SA", favs: [] }, { table: [{ pos: 1, team: "Inter", pg: 9, w: 7, d: 1, l: 1, gf: 20, ga: 6, pts: 22 }] }), /crest-row/);
  assert.match(teamPage({ league: "SA", favs: [] }, "Inter", { turno: null, storico: null, classifica: null }), /crest-team/);
  const items = todayItems({ SA: { matches: [match] } });
  assert.equal(items[0].ch, "/stemmi/" + PNG_STEM + ".png");
  assert.match(todayHtml(items, Date.parse("2026-10-28T10:00:00Z")), /crest-inline/);
  setCrests({});
  assert.ok(!card({ league: "SA", favs: [] }, match, 0).includes("crest"), "senza elenco nessuno stemma (come nel browser)");
});

test("PNG 64×64 dal build, anche da SVG; un file rotto non ferma il sito", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ff-crests-"));
  mkdirSync(path.join(dir, "crests"));
  writeFileSync(path.join(dir, "crests", SVG_STEM + ".svg"), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120"><path d="M5 5h90v60l-45 50-45-50z" fill="#c00"/></svg>');
  writeFileSync(path.join(dir, "crests", BAD_STEM + ".svg"), "<svg non chiuso");
  writeFileSync(path.join(dir, "crests.json"), JSON.stringify({ teams: { SA: { Milan: SVG_STEM + ".svg", Roma: BAD_STEM + ".svg", Lazio: "0000000000000000.png" } } }));
  process.env.FF_DATA_DIR = dir;
  const { crestFiles } = await import("../src/lib/data.js");
  assert.deepEqual(crestFiles().map((x) => x.stem).sort(), [BAD_STEM, SVG_STEM].sort(), "solo i file che esistono");
  const page = await import("../src/pages/stemmi/[file].png.js");
  assert.deepEqual(page.getStaticPaths().map((x) => x.params.file).sort(), [BAD_STEM, SVG_STEM].sort());
  const png = Buffer.from(await page.render(SVG_STEM + ".svg"));
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(20), 64, "alto 64 px");
  // Un PNG come sorgente: si usa quello appena prodotto.
  writeFileSync(path.join(dir, "crests", PNG_STEM + ".png"), png);
  const again = Buffer.from(await page.render(PNG_STEM + ".png"));
  assert.deepEqual([again.readUInt32BE(16), again.readUInt32BE(20)], [64, 64]);
  const fallback = await page.GET({ props: { file: BAD_STEM + ".svg" } });
  assert.equal(fallback.headers.get("Content-Type"), "image/png");
  assert.equal(Buffer.from(await fallback.arrayBuffer()).subarray(0, 4).toString("hex"), "89504e47");
  delete process.env.FF_DATA_DIR;
});
