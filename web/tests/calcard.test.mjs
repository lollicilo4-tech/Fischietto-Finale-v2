/* Immagine del calendario fantacalcio: PNG 1080×1920 con 3 o 5 giornate e senza dati. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarTree } from "../src/lib/calcard.js";
import { fantaCalendar } from "../src/lib/fanta.js";
import { renderPng, STORY } from "../src/lib/cardkit.js";

const M = (id, home, away, p1, p2) => ({ id, home, away, kickoff: "2026-11-01T14:00:00Z", xg: [1.4, 1.1], prob: { p1, px: 1 - p1 - p2, p2 } });
const teams = ["Inter", "Milan", "Roma", "Lazio", "Napoli", "Juventus", "Atalanta", "Bologna", "Fiorentina", "Torino", "Genoa", "Lecce", "Cagliari", "Parma", "Udinese", "Sassuolo", "Como 1907", "Verona", "Pisa", "Venezia FC"];
const round = (d) => ({ matchday: d, matches: teams.slice(0, 10).map((h, i) => M(d * 100 + i, h, teams[19 - i], 0.45, 0.3)) });

test("PNG 1080×1920 con 5 giornate, 1 giornata e nessun dato", async () => {
  const five = { ...round(9), next_rounds: [10, 11, 12, 13].map(round) };
  for (const turno of [five, round(9), null]) {
    const cal = fantaCalendar(turno);
    const png = Buffer.from(await renderPng(calendarTree(cal), STORY));
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1080, 1920]);
  }
  assert.equal(fantaCalendar(five).rounds.length, 5);
  assert.match(JSON.stringify(calendarTree(fantaCalendar(five))), /GIORNATE 9–13/);
});
