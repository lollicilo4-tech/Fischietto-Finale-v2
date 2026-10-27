/* "Oggi in campo": partite di tutti i campionati raggruppate per giorno, con l'ora vera. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { todayItems, todayGroups, todayHtml } from "../src/lib/today.js";
import { setLang } from "../src/lib/i18n.js";

const match = (id, home, away, kickoff) => ({ id, home, away, kickoff, prob: { p1: 0.5, px: 0.3, p2: 0.2 }, conf: "media", top_scores: [[1, 0, 0.12]] });
const turni = {
  SA: { matches: [match(1, "Inter", "Milan", "2026-10-28T19:45:00Z"), match(2, "Roma", "Lazio", "2026-10-29T17:00:00Z")] },
  PL: { matches: [match(3, "Arsenal", "Chelsea", "2026-10-28T12:30:00Z"), match(4, "Leeds", "Fulham", "2026-10-28T20:00:00Z"), match(5, "Spurs", "Everton", "2026-11-05T20:00:00Z")] },
  BL1: null
};

test("partite di tutti i campionati in ordine di orario, con il link alla partita", () => {
  setLang("it");
  const items = todayItems(turni);
  assert.deepEqual(items.map((x) => x.home), ["Arsenal", "Inter", "Leeds", "Roma", "Spurs"]);
  assert.equal(items[1].url, "/serie-a/partita/1-inter-milan/");
  assert.deepEqual(items[1].pick, ["1", "Inter", 0.5]);
  assert.equal(items[0].flag + items[0].name, "🏴Premier League");
});

test("oggi, domani e dopodomani; le partite iniziate da più di due ore escono", () => {
  setLang("it");
  const items = todayItems(turni);
  const now = Date.parse("2026-10-28T15:00:00Z");  // 16:00 in Italia: Arsenal-Chelsea iniziata alle 13:30 italiane
  const g = todayGroups(items, now);
  assert.deepEqual(g.map((x) => [x.label, x.items.map((i) => i.home)]), [["Oggi", ["Inter", "Leeds"]], ["Domani", ["Roma"]], ["Venerdì 30 ottobre", []]]);
  const live = todayGroups(items, Date.parse("2026-10-28T13:00:00Z"))[0].items.map((i) => i.home);
  assert.deepEqual(live, ["Arsenal", "Inter", "Leeds"], "iniziata da mezz'ora: resta");
  const html = todayHtml(items, Date.parse("2026-10-28T13:00:00Z"));
  assert.match(html, /Iniziata/);
  assert.match(html, /href="\/serie-a\/partita\/1-inter-milan\/"/);
  assert.ok(!/undefined|NaN/.test(html));
  // Dopo mezzanotte "Oggi" diventa il giorno dopo.
  assert.deepEqual(todayGroups(items, Date.parse("2026-10-28T23:30:00Z")).map((x) => [x.label, x.items.length]), [["Oggi", 1], ["Domani", 0], ["Sabato 31 ottobre", 0]]);
});

test("giorni senza partite e versione inglese", () => {
  setLang("it");
  const items = todayItems(turni);
  assert.match(todayHtml(items, Date.parse("2026-10-30T10:00:00Z")), /Nei prossimi giorni non ci sono partite/);
  assert.match(todayHtml(items, Date.parse("2026-11-04T10:00:00Z")), /Oggi non ci sono partite nei nostri campionati/);
  setLang("en");
  const en = todayItems(turni);
  assert.equal(en[1].url, "/en/serie-a/match/1-inter-milan/");
  const html = todayHtml(en, Date.parse("2026-10-28T15:00:00Z"));
  assert.match(html, /<h2>Today<\/h2>/);
  assert.match(html, /<h2>Tomorrow<\/h2>/);
  assert.match(html, /Model: 1 · Inter 50%/);
  setLang("it");
});
