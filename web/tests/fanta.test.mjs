/* Consigli fantacalcio: calcoli sui gol attesi e HTML senza valori mancanti, sui dati pubblicati e su casi limite. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setLang } from "../src/lib/i18n.js";
import * as F from "../src/lib/fanta.js";

const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs");
const turno = existsSync(path.join(docs, "turno.json")) ? JSON.parse(readFileSync(path.join(docs, "turno.json"), "utf-8")) : null;
const ctx = { league: "SA", favs: [] };
const BETTING_WORDS = /\b(quot[ae]|schedin[ae]|bomba|più sicur[ae]|scommett\w*|gioca(re)? ora)\b/i;
const clean = (html) => {
  for (const bad of ["undefined", "NaN", "[object Object]", "Infinity"]) assert.ok(!html.includes(bad), "contiene " + bad);
  assert.ok(!BETTING_WORDS.test(html), "contiene «" + (html.match(BETTING_WORDS) || [])[0] + "»");
  return html;
};
const M = (id, home, away, xg, prob, kickoff = "2026-11-01T14:00:00Z") => ({ id, home, away, xg, prob, kickoff });

test("porta inviolata e almeno 2 gol seguono Poisson", () => {
  assert.equal(F.cleanSheet(0), 1);
  assert.ok(Math.abs(F.cleanSheet(1) - 0.3679) < 1e-4);
  assert.ok(Math.abs(F.twoPlus(1) - 0.2642) < 1e-4);
  assert.equal(F.twoPlus(0), 0);
});

test("la porta inviolata coincide con il modello pubblicato (No Gol / Gol)", () => {
  if (!turno) return;
  turno.matches.filter((m) => m.prob && m.prob.gg != null && m.xg).forEach((m) => {
    const both = (1 - F.cleanSheet(m.xg[1])) * (1 - F.cleanSheet(m.xg[0]));
    assert.ok(Math.abs(both - m.prob.gg) < 0.01, m.home + "-" + m.away + ": " + both + " invece di " + m.prob.gg);
  });
});

test("una riga per squadra, partite senza gol attesi ignorate", () => {
  const rows = F.fantaRows([M(1, "Inter", "Lecce", [2.1, 0.6]), M(2, "Roma", "Lazio", null), M(3, "Milan", "Como", [1.4, NaN])]);
  assert.deepEqual(rows.map((r) => r.team), ["Inter", "Lecce"]);
  assert.equal(rows[0].opp, "Lecce");
  assert.equal(rows[0].home, true);
  assert.ok(rows[0].cs > rows[1].cs);
  const h = F.highlights(rows);
  assert.equal(h.attack[0].team, "Inter");
  assert.equal(h.defence[0].team, "Inter");
  assert.equal(h.avoid[0].team, "Lecce");
  assert.equal(F.highlights([]), null);
});

test("calendario: giornate in ordine, celle vuote per chi non gioca, ordinato per media", () => {
  const t = {
    matchday: 9,
    matches: [M(1, "Inter", "Lecce", [2, 0.6], { p1: 0.7, px: 0.2, p2: 0.1 })],
    next_rounds: [{ matchday: 10, matches: [M(2, "Lecce", "Roma", [1, 1.5], { p1: 0.25, px: 0.3, p2: 0.45 })] }, { matchday: 11, matches: [] }]
  };
  const cal = F.fantaCalendar(t);
  assert.deepEqual(cal.rounds, [9, 10]);
  assert.deepEqual(cal.teams.map((r) => r.team), ["Inter", "Roma", "Lecce"]);
  assert.equal(cal.teams[0].cells[1], null);
  assert.equal(cal.teams[2].cells[0].home, false);
  assert.ok(Math.abs(cal.teams[2].avg - 0.175) < 1e-9);
  assert.deepEqual(F.fantaCalendar(null), { rounds: [], teams: [] });
  assert.equal(F.tier(0.5), "easy");
  assert.equal(F.tier(0.3), "mid");
  assert.equal(F.tier(0.29), "hard");
  assert.equal(F.short("Como 1907"), "COM");
  assert.equal(F.short("1907"), "—");
});

test("HTML con caratteri speciali ed elenchi vuoti", () => {
  setLang("it");
  const rows = F.fantaRows([M(1, "<b>A</b>", "B&C", [1.5, 1])]);
  const html = clean(F.highlightsHtml(ctx, rows) + F.roundTableHtml(ctx, rows) + F.calendarHtml(ctx, F.fantaCalendar({ matchday: 1, matches: [M(1, "<b>A</b>", "B&C", [1.5, 1], { p1: 0.5, px: 0.25, p2: 0.25 })] })));
  assert.ok(!html.includes("<b>A</b>"));
  assert.ok(html.includes("&lt;b&gt;A&lt;/b&gt;"));
  assert.equal(F.highlightsHtml(ctx, []), "");
  assert.match(F.roundTableHtml(ctx, []), /Nessuna partita/);
  assert.match(F.calendarHtml(ctx, { rounds: [], teams: [] }), /non disponibile/);
  assert.equal(F.deadlineText([]), "");
  assert.match(F.deadlineText([M(1, "A", "B", [1, 1], null, "2026-11-01T14:00:00Z"), M(2, "C", "D", [1, 1], null, "2026-10-31T17:00:00Z")]), /^Prima partita: Sab 31 ott 18:00$/);
});

test("pagina sui dati pubblicati della Serie A", () => {
  if (!turno) return;
  setLang("it");
  const rows = F.fantaRows(turno.matches);
  assert.equal(rows.length, turno.matches.filter((m) => m.xg).length * 2);
  clean(F.highlightsHtml(ctx, rows) + F.roundTableHtml(ctx, rows) + F.calendarHtml(ctx, F.fantaCalendar(turno)));
});
