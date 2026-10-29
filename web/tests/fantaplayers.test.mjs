/* Giocatori nel fantacalcio: quote con il freno di inizio stagione, probabilità di segnare, assenti,
   prossime giornate, capitano, HTML sicuro e "La mia rosa" con i marcatori. */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as P from "../src/lib/fantaplayers.js";
import { rosaHtml, matchScorer, rosaAdvice } from "../src/lib/rosa.js";
import { highlightsHtml, fantaRows } from "../src/lib/fanta.js";
import { cardData } from "../src/lib/fantacard.js";

const M = (id, home, away, xg, extra = {}) => ({ id, home, away, xg, kickoff: "2026-11-01T14:00:00Z", prob: { p1: 0.5, px: 0.25, p2: 0.25 }, ...extra });
const classifica = {
  table: [{ team: "Inter", pg: 9, gf: 20 }, { team: "Lecce", pg: 9, gf: 6 }, { team: "Roma", pg: 9, gf: 12 }, { team: "Genoa", pg: 9, gf: 9 }],
  scorers: [
    { player: "Lautaro Martínez", team: "Inter", goals: 8, assists: 2, penalties: 1, played: 9, role: "A" },
    { player: "Hakan Çalhanoğlu", team: "Inter", goals: 3, assists: 4, penalties: 3, played: 8, role: "C" },
    { player: "Nikola Krstović", team: "Lecce", goals: 3, assists: 0, penalties: 0, played: 9, role: "A" },
    { player: "Lampo Veloce", team: "Roma", goals: 2, assists: null, penalties: 0, played: 2, role: null },
    { player: "Senza squadra", team: "Pisa", goals: 4, assists: 0, played: 9, role: "A" }
  ]
};
const turno = {
  matchday: 10,
  matches: [M(1, "Inter", "Lecce", [2.1, 0.7], { analysis: { absences_home: ["Hakan Calhanoglu (infortunio)"], absences_away: [] } })],
  next_rounds: [{ matchday: 11, matches: [M(2, "Roma", "Inter", [1.2, 1.5]), M(3, "Genoa", "Lecce", [1.3, 1.0])] }]
};

test("quote: parte dei gol della squadra con il freno di inizio stagione", () => {
  const r = P.playerRates(classifica);
  assert.deepEqual(r.map((x) => x.player), ["Lautaro Martínez", "Hakan Çalhanoğlu", "Nikola Krstović", "Lampo Veloce"], "senza squadra in classifica: fuori");
  const lautaro = r[0];
  assert.ok(Math.abs(lautaro.gShare - (8 + 6 * 0.06) / (9 * 20 / 9 + 6)) < 1e-9);
  const lampo = r[3];
  assert.ok(lampo.gShare < 0.35, "2 gol in 2 partite non fanno un bomber: " + lampo.gShare);
  assert.ok(r.every((x) => x.gShare <= P.MAX_GOAL_SHARE && x.aShare <= P.MAX_ASSIST_SHARE));
});

test("assenti: cognome senza accenti, solo nella giornata in corso", () => {
  assert.equal(P.isAbsent("Hakan Çalhanoğlu", ["Hakan Calhanoglu (infortunio)"]), true);
  assert.equal(P.isAbsent("Lautaro Martínez", ["Lisandro Martinez"]), true, "stesso cognome: prudenza");
  assert.equal(P.isAbsent("Lautaro Martínez", ["Bastoni"]), false);
  assert.equal(P.isAbsent("Raphinha", ["raphinha squalificato"]), true);
  assert.equal(P.isAbsent("Marcus Thuram-Ulien", ["Thuram"]), true, "cognome composto");
  assert.equal(P.isAbsent("Paulo Dybala", ["Dybala", "Svilar"]), true);
  assert.equal(P.isAbsent("Marcus Thuram-Ulien", ["Marcus Rashford"]), false, "il nome di battesimo non basta");
  const proj = P.playerProjections(turno, classifica);
  const calha = proj.players.find((x) => x.player === "Hakan Çalhanoğlu");
  assert.equal(calha.cells[0].absent, true);
  assert.equal(calha.cells[1].absent, false);
  assert.equal(calha.games, 1);
});

test("probabilità, bonus attesi, chi può segnare, capitano, prossime giornate", () => {
  const proj = P.playerProjections(turno, classifica);
  assert.deepEqual(proj.rounds, [10, 11]);
  const lautaro = proj.players[0];
  assert.ok(Math.abs(lautaro.cells[0].p - (1 - Math.exp(-2.1 * lautaro.gShare))) < 1e-9);
  assert.ok(Math.abs(lautaro.cells[0].xb - (3 * 2.1 * lautaro.gShare + 2.1 * lautaro.aShare)) < 1e-9);
  assert.equal(lautaro.cells[1].home, false);
  assert.equal(proj.players.find((x) => x.player === "Lampo Veloce").cells[0], null, "la Roma non gioca nella giornata in corso");
  assert.deepEqual(P.roundScorers(proj).map((x) => x.player), ["Lautaro Martínez", "Nikola Krstović"]);
  assert.equal(P.roundCaptains(proj, 1)[0].player, "Lautaro Martínez");
  assert.deepEqual(P.roundAbsent(proj).map((x) => x.player), ["Hakan Çalhanoğlu"]);
  assert.equal(P.bestPlayers(proj)[0].player, "Lautaro Martínez");
  assert.deepEqual(P.bestPlayers(proj, "C").map((x) => x.player), ["Hakan Çalhanoğlu"]);
  assert.deepEqual(P.rolesPresent(proj), ["A", "C"]);
});

test("HTML: dati scappati, assenti indicati, ruoli da scegliere", () => {
  const bad = { ...classifica, scorers: [{ player: "<b>X</b>", team: "Inter", goals: 2, assists: 0, played: 5, role: "A" }] };
  const proj = P.playerProjections(turno, bad);
  const ctx = { league: "SA", favs: [] };
  const html = P.roundScorersHtml(ctx, proj) + P.bestPlayersHtml(ctx, proj);
  assert.doesNotMatch(html, /<b>X<\/b>/);
  assert.match(html, /&lt;b&gt;X&lt;\/b&gt;/);
  const full = P.playerProjections(turno, classifica);
  assert.match(P.roundScorersHtml(ctx, full), /Esclusi perché assenti confermati: Hakan Çalhanoğlu \(Inter\)/);
  assert.match(P.bestPlayersHtml(ctx, full), /id="fp-a"/);
  assert.match(P.bestPlayersHtml(ctx, full), /ass\./);
  assert.match(P.bestPlayersHtml(ctx, { rounds: [], players: [] }), /non disponibili/);
  assert.doesNotMatch(html + P.bestPlayersHtml(ctx, full), /undefined|NaN/);
});

test("capitano con i nomi nella pagina e nell'immagine; senza marcatori resta quello per squadra", () => {
  const proj = P.playerProjections(turno, classifica);
  const ctx = { league: "SA", favs: [] };
  assert.match(highlightsHtml(ctx, fantaRows(turno.matches), P.roundCaptains(proj)), /Lautaro Martínez/);
  assert.match(highlightsHtml(ctx, fantaRows(turno.matches)), /attaccanti delle squadre con più gol attesi/);
  const d = cardData(turno, classifica);
  assert.equal(d.attack[0].team, "Lautaro Martínez");
  assert.equal(d.captainPlayers, true);
  assert.equal(cardData(turno).attack[0].team, "Inter");
});

test("La mia rosa: il giocatore scritto a mano trova il suo marcatore", () => {
  const players = P.rosaPlayers(P.playerProjections(turno, classifica));
  assert.equal(matchScorer({ name: "Lautaro", team: "Inter" }, players).player, "Lautaro Martínez");
  assert.equal(matchScorer({ name: "lautaro martinez", team: "Inter" }, players).player, "Lautaro Martínez");
  assert.equal(matchScorer({ name: "Lautaro", team: "Roma" }, players), null, "altra squadra");
  assert.equal(matchScorer({ name: "Lu", team: "Inter" }, players), null, "troppo corto");
  const rosa = { v: 1, players: [
    { id: "1", role: "A", team: "Inter", name: "Lautaro" },
    { id: "2", role: "C", team: "Inter", name: "Calhanoglu" },
    { id: "3", role: "A", team: "Lecce", name: "Sconosciuto Rossi" }
  ] };
  const rows = fantaRows(turno.matches);
  const a = rosaAdvice(rosa, rows, players);
  assert.equal(a.captain.name, "Lautaro");
  const html = rosaHtml(rosa, rows, players);
  assert.match(html, /segna, se gioca/);
  assert.match(html, /assente confermato/);
  assert.match(html, /gol attesi squadra/);
});
