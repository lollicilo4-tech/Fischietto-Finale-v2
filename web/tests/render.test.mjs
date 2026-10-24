/* Rendering su tutti i JSON pubblicati e su dati costruiti apposta per provare i casi limite. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LEAGUES, esc } from "../src/lib/core.js";
import * as R from "../src/lib/render.js";
import { computePicks, modelSlipPicks, deriveRecommendation } from "../src/lib/model.js";

const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs");
const read = (f) => (existsSync(path.join(docs, f)) ? JSON.parse(readFileSync(path.join(docs, f), "utf-8")) : null);
/* Parole da sito di scommesse che il sito non usa (AdSense, AGENTS.md). Restano fuori dal controllo
   i titoli degli articoli citati come fonti e i testi scritti dall'AI (aiTexts): non sono testi del sito. */
const BETTING_WORDS = /\b(quot[ae]|quote eque|schedin[ae]|bomba|più sicur[ae]|top picks?|pagano)\b/i;
let aiTexts = [];
const clean = (html, where) => {
  for (const bad of ["undefined", "NaN", "[object Object]", "Infinity"]) assert.ok(!html.includes(bad), where + " contiene " + bad);
  let own = html.replace(/<div class="srcs">[\s\S]*?<\/div>/g, "");
  for (const t of aiTexts) own = own.split(t).join("");
  assert.ok(!BETTING_WORDS.test(own), where + " contiene «" + (own.match(BETTING_WORDS) || [])[0] + "»");
  return html;
};

for (const L of LEAGUES) {
  test("tutte le sezioni si generano senza valori mancanti · " + L.name, () => {
    const turno = read(L.file + "turno.json"), storico = read(L.file + "storico.json"), classifica = read(L.file + "classifica.json");
    const ctx = { league: L.code, favs: [] };
    aiTexts = ((turno && turno.matches) || []).map((m) => m.analysis && m.analysis.text).filter(Boolean).map(esc);
    if (turno) {
      clean(R.grouped(ctx, turno.matches), "Partite");
      clean(R.nextRoundsPanel(ctx, turno.next_rounds), "Prossime giornate");
      clean(R.playedSection(turno.played), "Già giocate");
      const d = R.homeDashboard(ctx, turno.matches);
      if (d) Object.values(d).forEach((h) => clean(h, "Home"));
      [true, false].forEach((nodc) => [2, 3, 4, 5].forEach((n) => { const c = R.comboHtml(computePicks(turno.matches, nodc), n); clean(c.combo + c.decay, "Più probabili"); }));
      ["facile", "media", "difficile"].forEach((mode) => [3, 4, 5].forEach((n) => {
        const picks = modelSlipPicks(turno.matches, mode, n, turno.market_performance || {});
        assert.equal(new Set(picks.map((p) => p.match.id)).size, picks.length, "una sola selezione per partita");
        assert.ok(picks.length <= n);
        clean(R.slipHtml(picks, mode, turno.matches, turno.market_performance, (turno.backtest || {}).markets), "Le scelte del modello");
      }));
      turno.matches.forEach((m) => { const r = deriveRecommendation(m); assert.ok(r.best && r.best.p > 0); });
    }
    if (storico) Object.values(R.storicoParts(storico)).forEach((h) => clean(h, "Storico"));
    if (classifica) clean(R.tableHtml(ctx, classifica) + R.seasonPanel(ctx, classifica.season), "Classifica");
    R.teamsOf(turno, classifica).forEach((name) => clean(R.teamPage(ctx, name, { turno, storico, classifica }), "Squadra " + name));
  });
}

test("i dati esterni non possono iniettare HTML o link pericolosi", () => {
  const evil = '<script>alert(1)</script>"\'';
  const m = {
    id: '1"><x', home: evil, away: "Ospiti", kickoff: "2026-10-23T18:45:00Z", label: null, conf: '"alta',
    prob: { p1: 0.5, px: 0.3, p2: 0.2, o15: 0.7, o25: 0.5, u25: 0.5, u35: 0.7, gg: 0.5, ng: 0.5 },
    fair_odds: { p1: 2, px: 3.3, p2: 5, o25: 2, gg: 2 }, xg: [1.5, 1], xg_base: [1.5, 1], top_scores: [[1, 0, 0.12], [1, 1, 0.1]],
    form: { home: "VV<", away: "PN" }, last: { home: [{ res: "V", home: true, opp: evil, score: "1-0" }] }, h2h: [{ date: "2025-01-01", home: evil, away: "B", score: "<b>" }],
    explain: { items: [{ side: "home", effect: 3, text: evil }], summary: evil },
    analysis: { ai: true, text: evil, sources: [{ url: "javascript:alert(1)", title: "x" }, { url: "https://ok.example/a", title: evil }], absences_home: [evil], absences_away: [], factor_home: 0.9, factor_away: 1 }
  };
  const html = R.card({ league: "SA", favs: [] }, m, 0);
  assert.ok(!html.includes("<script>"), "nessun tag script");
  assert.ok(!html.includes("javascript:"), "nessun link javascript:");
  assert.ok(html.includes('href="https://ok.example/a"'), "i link http(s) restano");
  assert.ok(!/<x/.test(html) && !html.includes('"alta'), "attributi chiusi correttamente");
});

test("preferiti: stella su partite e classifica, striscia Le tue squadre", () => {
  const turno = read("turno.json");
  const m = turno.matches[0];
  const ctx = { league: "SA", favs: [m.home] };
  assert.ok(R.card(ctx, m, 0).includes('class="match fav"'));
  const strip = R.favStripHtml(R.favStripData(turno.matches), [m.home]);
  assert.ok(strip.includes("Le tue squadre") && strip.includes('data-goto-match="' + m.id + '"'));
  assert.equal(R.favStripHtml(R.favStripData(turno.matches), []), "");
});

test("testo condiviso: niente inviti a scommettere", () => {
  const t = R.shareText(read("turno.json").matches[0]);
  assert.match(t, /Stime statistiche, non un invito a scommettere\.$/);
});
