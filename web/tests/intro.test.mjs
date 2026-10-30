/* Testi introduttivi: frasi solo con i dati presenti, grammatica, due lingue, nomi scappati. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { setLang } from "../src/lib/i18n.js";
import { leagueIntro, teamIntro } from "../src/lib/intro.js";

const M = (id, home, away, p1, px, p2, xg, kickoff, form) => ({ id, home, away, prob: { p1, px, p2 }, xg, kickoff, form });
const data = {
  turno: { matchday: 10, matches: [
    M("1", "Como 1907", "Venezia FC", 0.71, 0.19, 0.10, [2.1, 0.6], "2026-10-31T14:00:00Z", { home: "VVNVP", away: "PPNPP" }),
    M("2", "Sassuolo", "Fiorentina", 0.40, 0.24, 0.36, [1.4, 1.3], "2026-11-01T14:00:00Z"),
    M("3", "Frosinone", "Torino", 0.45, 0.22, 0.33, [2.2, 1.7], "2026-11-02T19:45:00Z")
  ], next_rounds: [] },
  classifica: {
    table: [{ pos: 1, team: "Inter", pg: 9, w: 8, d: 1, l: 0, gf: 25, ga: 10, pts: 25 }, { pos: 2, team: "Como 1907", pg: 9, w: 7, d: 1, l: 1, gf: 18, ga: 9, pts: 22 }],
    stats: { "Como 1907": { home: { pg: 5, w: 5, d: 0, l: 0 }, away: { pg: 4, w: 2, d: 1, l: 1 } } },
    season: { zones: [{ key: "title", label: "Primo posto", from: 1, to: 1 }, { key: "top4", label: "Prime 4", from: 1, to: 4 }], teams: [{ team: "Inter", title: 0.55, top4: 0.97 }, { team: "Como 1907", title: 0.2, top4: 0.7 }] },
    scorers: [{ player: "Gustavo Varela", team: "Monza", goals: 8 }, { player: "Nico Paz", team: "Como 1907", goals: 5 }]
  },
  storico: { n: 40, hit: 23 }
};

test("campionato: giornata, previsioni, classifica, stagione, marcatori, storico", () => {
  setLang("it");
  const it = leagueIntro("SA", data, "it");
  assert.match(it, /Nella giornata 10 di Serie A restano 3 partite da giocare/);
  assert.match(it, /La previsione più netta è Como 1907 – Venezia FC: vince Como 1907 al 71%/);
  assert.match(it, /La più equilibrata è Sassuolo – Fiorentina/);
  assert.match(it, /Quella con più gol attesi è Frosinone – Torino, circa 3,90/);
  assert.match(it, /comanda Inter con 25 punti, 3 in più di Como 1907/);
  assert.match(it, /Inter arriva prima nel 55%/);
  assert.match(it, /Gustavo Varela \(Monza\) con 8 gol/);
  assert.match(it, /23 partite su 40 \(57%\)/);
  assert.match(leagueIntro("CDR", { turno: { matchday: 1, matches: data.turno.matches } }, "it"), /^<p class="lead intro">Nel turno 1 di Copa del Rey/);
  assert.equal(leagueIntro("SA", {}, "it"), "");
  setLang("en");
  assert.match(leagueIntro("SA", data, "en"), /In matchday 10 of the Serie A there are 3 matches still to play/);
  setLang("it");
});

test("squadra: posizione, casa/trasferta, forma, prossima partita, marcatore, zona", () => {
  setLang("it");
  const it = teamIntro("SA", "Como 1907", data, "it");
  assert.match(it, /Como 1907 occupa il 2° posto in Serie A con 22 punti in 9 partite: 7 vittorie, 1 pareggio, 1 sconfitta/);
  assert.match(it, /Rende molto meglio in casa/);
  assert.match(it, /Nelle ultime 5 partite: 3 vittorie, 1 pareggio, 1 sconfitta/);
  assert.match(it, /Prossima partita: Como 1907 – Venezia FC .*vincente al 71%/);
  assert.match(it, /miglior marcatore è Nico Paz con 5 gol/);
  assert.match(it, /zona più probabile è "Prime 4" \(70%\)/);
  setLang("en");
  const en = teamIntro("SA", "Como 1907", data, "en");
  assert.match(en, /are 2nd in the Serie A/);
  assert.match(en, /They do much better at home/);
  assert.match(en, /"Top 4" \(70%\)/);
  setLang("it");
  assert.equal(teamIntro("SA", "Nessuno", {}, "it"), "");
  const bad = teamIntro("SA", "<b>X</b>", { classifica: { table: [{ pos: 1, team: "<b>X</b>", pg: 1, w: 1, d: 0, l: 0, gf: 1, ga: 0, pts: 3 }] } }, "it");
  assert.doesNotMatch(bad, /<b>X<\/b>/);
});
