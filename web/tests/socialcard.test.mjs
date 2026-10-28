/* Immagini per i social: scelta del giorno, partite principali, misure, PNG 1080×1920, nessuna parola da scommesse. */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as S from "../src/lib/socialcard.js";

const BETTING_WORDS = /\b(quot[ae]|schedin[ae]|bomba|più sicur[ae]|scommett\w*)\b/i;
const X = (league, home, away, kickoff, p = [0.5, 0.3, 0.2]) => ({ league, name: league, home, away, kickoff, p1: p[0], px: p[1], p2: p[2], pick: ["1", home, p[0]] });

test("il giorno è il primo con partite non ancora iniziate, in ora italiana", () => {
  const items = [
    X("SA", "Milan", "Bologna", "2026-10-28T17:30:00Z"),
    X("SA", "Genoa", "Juventus", "2026-10-28T19:45:00Z"),
    X("PL", "Arsenal", "Chelsea", "2026-10-28T23:30:00Z"),  // 00:30 del 29 a Roma
    X("SA", "Roma", "Lazio", "2026-10-29T19:45:00Z")
  ];
  const day = S.socialDay(items, Date.parse("2026-10-28T18:00:00Z"));
  assert.equal(day.key, "2026-10-28");
  assert.equal(day.title, "MERCOLEDÌ 28 OTTOBRE");
  assert.deepEqual(day.items.map((x) => x.home), ["Genoa"], "esclusa la partita già iniziata e quella dopo mezzanotte");
  const late = S.socialDay(items, Date.parse("2026-10-28T21:00:00Z"));
  assert.equal(late.key, "2026-10-29");
  assert.deepEqual(late.items.map((x) => x.home), ["Arsenal", "Roma"]);
  assert.equal(S.socialDay(items, Date.parse("2026-11-30T00:00:00Z")), null);
});

test("partite principali: prima i campionati più seguiti, poi in ordine di orario", () => {
  const items = [];
  for (let i = 0; i < 6; i++) items.push(X("CDR", "Casa" + i, "Ospite" + i, "2026-10-28T17:00:00Z"));
  for (let i = 0; i < 5; i++) items.push(X("SA", "Sa" + i, "Sb" + i, "2026-10-28T1" + (8 + (i % 2)) + ":00:00Z"));
  const top = S.topMatches(items, 8);
  assert.equal(top.length, 8);
  assert.equal(top.filter((x) => x.league === "SA").length, 5);
  assert.deepEqual(top.map((x) => x.kickoff), top.map((x) => x.kickoff).slice().sort());
  const { sets } = S.socialSets(items, Date.parse("2026-10-28T08:00:00Z"));
  assert.deepEqual(sets.map((s) => [s.slug, s.items.length, s.total]), [["oggi", 8, 11], ["serie-a", 5, 5], ["copa-del-rey", 6, 6]]);
  assert.equal(sets[1].file, "/social/serie-a.png");
});

test("le righe stanno nell'immagine con 1, 8 e 10 partite", () => {
  for (const n of [1, 8, 10]) {
    const s = S.rowSizes(n);
    assert.ok(n * s.row + (n - 1) * s.listGap <= 1300, n + " righe");
    assert.ok(s.cellH < s.row);
  }
});

test("PNG 1080×1920 con e senza stemmi, testo senza parole da scommesse", async () => {
  const items = [X("SA", "Milan", "Bologna", "2026-10-28T17:30:00Z"), X("CDR", "Real Unión Irún Club de Fútbol", "Peña Sport", "2026-10-28T18:00:00Z")];
  const { day, sets } = S.socialSets(items, Date.parse("2026-10-28T08:00:00Z"));
  const tree = JSON.stringify(S.storyTree({ ...sets[0], items: sets[0].items.map((x) => ({ ...x, crests: ["", ""] })) }, day));
  assert.doesNotMatch(tree.replace(/Nessun invito a scommettere/g, ""), BETTING_WORDS);
  const png = Buffer.from(await S.storyPng(sets[0], day));
  assert.deepEqual([png.readUInt32BE(0), png.readUInt32BE(16), png.readUInt32BE(20)], [0x89504e47, 1080, 1920]);
});
