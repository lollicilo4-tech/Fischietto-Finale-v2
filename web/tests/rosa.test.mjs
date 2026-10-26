/* "La mia rosa": salvataggio robusto, aggiunta e rimozione, consigli per ruolo e capitano, HTML senza
   valori mancanti e con i nomi scritti da chi visita sempre passati da esc(). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as R from "../src/lib/rosa.js";
import { fantaRows } from "../src/lib/fanta.js";

const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs");
const turno = existsSync(path.join(docs, "turno.json")) ? JSON.parse(readFileSync(path.join(docs, "turno.json"), "utf-8")) : null;
const TEAMS = ["Inter", "Lecce", "Roma", "Lazio"];
const rows = fantaRows([
  { home: "Inter", away: "Lecce", xg: [2.2, 0.5], kickoff: "2026-11-01T14:00:00Z" },
  { home: "Roma", away: "Lazio", xg: [1.2, 1.3], kickoff: "2026-11-01T17:00:00Z" }
]);
const clean = (html) => { for (const bad of ["undefined", "NaN", "[object Object]", "Infinity"]) assert.ok(!html.includes(bad), "contiene " + bad); return html; };
const add = (rosa, role, team, name, i = 0) => R.addPlayer(rosa, { role, team, name }, TEAMS, 1000 + i);

test("dati salvati rovinati o di un'altra versione: si riparte da zero", () => {
  for (const bad of ["", "{", "null", '{"v":2,"players":[]}', '{"v":1,"players":{}}']) assert.deepEqual(R.parseRosa(bad), R.emptyRosa());
  const ok = R.parseRosa(JSON.stringify({ v: 1, players: [{ id: 1, role: "A", team: "Inter", name: "X".repeat(80) }, { id: 2, role: "Z", team: "Inter", name: "Y" }, null] }));
  assert.equal(ok.players.length, 1);
  assert.equal(ok.players[0].id, "1");
  assert.equal(ok.players[0].name.length, R.MAX_NAME);
});

test("aggiunta: ruolo, squadra e nome obbligatori, niente doppioni, limite di giocatori", () => {
  let { rosa, error } = add(R.emptyRosa(), "A", "Inter", "  Lautaro   Martínez ");
  assert.equal(error, null);
  assert.deepEqual(rosa.players.map((p) => [p.role, p.team, p.name]), [["A", "Inter", "Lautaro Martínez"]]);
  assert.match(add(rosa, "X", "Inter", "Y").error, /ruolo/);
  assert.match(add(rosa, "A", "Juventus", "Y").error, /squadra/);
  assert.match(add(rosa, "A", "Inter", "   ").error, /nome/);
  assert.match(add(rosa, "C", "Inter", "lautaro martínez").error, /già/);
  let big = R.emptyRosa();
  for (let i = 0; i < R.MAX_PLAYERS; i++) big = add(big, "D", "Roma", "Giocatore " + i, i).rosa;
  assert.equal(big.players.length, R.MAX_PLAYERS);
  assert.match(add(big, "D", "Roma", "Uno in più", 99).error, /già 40/);
  const id = rosa.players[0].id;
  assert.equal(R.removePlayer(rosa, id).players.length, 0);
  assert.equal(R.removePlayer(rosa, "altro").players.length, 1);
});

test("consigli: ordine per ruolo, capitano tra C e A, squadra che non gioca in fondo", () => {
  let rosa = R.emptyRosa();
  [["P", "Lecce", "Portiere Lecce"], ["P", "Inter", "Portiere Inter"], ["C", "Roma", "Centro Roma"], ["A", "Lazio", "Punta Lazio"], ["A", "Inter", "Punta Inter"], ["D", "Juventus", "x"]]
    .forEach(([r, t, n], i) => { const res = R.addPlayer(rosa, { role: r, team: t, name: n }, TEAMS.concat("Juventus"), i); rosa = res.rosa; });
  rosa = R.addPlayer(rosa, { role: "D", team: "Inter", name: "Difensore" }, TEAMS, 50).rosa;
  rosa.players.push({ id: "z", role: "A", team: "Atalanta", name: "Senza partita" });
  const a = R.rosaAdvice(rosa, rows);
  assert.deepEqual(a.groups.map((g) => g.role), ["P", "D", "C", "A"]);
  assert.deepEqual(a.groups[0].players.map((p) => p.name), ["Portiere Inter", "Portiere Lecce"]);
  assert.deepEqual(a.groups[3].players.map((p) => p.name), ["Punta Inter", "Punta Lazio", "Senza partita"]);
  assert.equal(a.groups[3].players[2].tier, "none");
  assert.equal(a.captain.name, "Punta Inter");
  assert.equal(a.groups[0].players[0].tier, "easy");
  assert.equal(a.groups[0].players[1].tier, "hard");
  /* A parità di gol attesi il capitano è l'attaccante. */
  const tie = { v: 1, players: [{ id: "1", role: "C", team: "Inter", name: "Aaa" }, { id: "2", role: "A", team: "Inter", name: "Zzz" }] };
  assert.equal(R.rosaAdvice(tie, rows).captain.name, "Zzz");
  assert.equal(R.rosaAdvice({ v: 1, players: [{ id: "1", role: "P", team: "Inter", name: "P" }] }, rows).captain, null);
});

test("HTML: rosa vuota, nomi scritti da chi visita sempre in sicurezza", () => {
  assert.match(R.rosaHtml(R.emptyRosa(), rows), /rosa è vuota/);
  const rosa = { v: 1, players: [{ id: '1"><img src=x>', role: "A", team: "Inter", name: "<script>alert(1)</script>" }, { id: "2", role: "D", team: "Atalanta", name: "Fuori" }] };
  const html = clean(R.rosaHtml(rosa, rows));
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes('"><img'));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.match(html, /Capitano consigliato/);
  assert.match(html, /non gioca in questo turno/);
});

test("consigli sui dati pubblicati della Serie A", () => {
  if (!turno) return;
  const r = fantaRows(turno.matches);
  const teams = [...new Set(r.map((x) => x.team))];
  let rosa = R.emptyRosa();
  teams.forEach((t, i) => { rosa = R.addPlayer(rosa, { role: R.ROLES[i % 4], team: t, name: "Giocatore " + i }, teams, i).rosa; });
  const a = R.rosaAdvice(rosa, r);
  assert.equal(a.total, teams.length);
  assert.ok(a.captain);
  clean(R.rosaHtml(rosa, r));
});
