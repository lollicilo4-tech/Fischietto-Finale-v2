import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify, romeParts, when, dayOf, shortDay, updatedAt, thousandsIt, esc, safeUrl, leagueUrl, teamUrl, matchUrl, matchSlug, LEAGUES, leagueBySlug } from "../src/lib/core.js";

test("orari sempre nel fuso italiano, con ora legale e solare", () => {
  // 18:45 UTC del 23 ottobre = 20:45 in Italia (ora legale); 19:45 UTC del 1° novembre = 20:45 (ora solare)
  assert.equal(when({ kickoff: "2026-10-23T18:45:00Z" }), "20:45");
  assert.equal(when({ kickoff: "2026-11-01T19:45:00Z" }), "20:45");
  assert.equal(dayOf({ kickoff: "2026-10-23T18:45:00Z" }), "Venerdì 23 ottobre");
  // 23:30 UTC di sabato è già domenica in Italia
  assert.equal(dayOf({ kickoff: "2026-10-24T22:30:00Z" }), "Domenica 25 ottobre");
  assert.equal(shortDay("2026-10-19T18:45:00Z"), "Lun 19/10");
  assert.equal(updatedAt("2026-10-23T16:58:00Z"), "23/10 18:58");
  assert.equal(romeParts("non una data"), null);
  assert.equal(when({ label: "Sab 20:45" }), "20:45");
  assert.equal(dayOf({ label: "Sab 20:45" }), "Sabato");
  assert.equal(dayOf({}), "Da programmare");
});

test("numeri come toLocaleString('it-IT')", () => {
  assert.equal(thousandsIt(5000), "5000");
  assert.equal(thousandsIt(10000), "10.000");
  assert.equal(thousandsIt(1234567), "1.234.567");
});

test("escaping e link esterni", () => {
  assert.equal(esc(`<img src=x onerror="a('b')">&`), "&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;");
  assert.equal(safeUrl("javascript:alert(1)"), "");
  assert.equal(safeUrl(" https://example.org/a "), "https://example.org/a");
  assert.equal(safeUrl("//evil.example"), "");
});

test("indirizzi delle pagine", () => {
  assert.equal(leagueUrl("SA"), "/");
  assert.equal(leagueUrl("SA", "partite"), "/serie-a/partite/");
  assert.equal(leagueUrl("PL", "home"), "/premier-league/");
  assert.equal(leagueUrl("UECL", "sicure"), "/conference-league/piu-probabili/");
  assert.equal(leagueUrl("SA", "schedina"), "/serie-a/scelte-del-modello/");
  assert.equal(teamUrl("SA", "Hellas Verona"), "/serie-a/squadra/hellas-verona/");
  assert.equal(slugify("Atlético Madrid"), "atletico-madrid");
  assert.equal(slugify("Bodø/Glimt"), "bodo-glimt");
  assert.equal(slugify("1. FC Köln"), "1-fc-koln");
  assert.equal(slugify("Brighton & Hove Albion"), "brighton-e-hove-albion");
  assert.equal(slugify("Borussia Mönchengladbach"), "borussia-monchengladbach");
  assert.equal(slugify("FC Bayern München"), "fc-bayern-munchen");
  assert.equal(slugify("Gießen"), "giessen");
  assert.equal(slugify("<>"), "squadra");
  assert.equal(matchSlug({ id: "558567", home: "Torino", away: "Monza" }), "558567-torino-monza");
  assert.equal(matchUrl("SA", { id: "1/../2", home: "A", away: "B" }), "/serie-a/partita/12-a-b/");
  assert.equal(new Set(LEAGUES.map((l) => l.slug)).size, LEAGUES.length);
  LEAGUES.forEach((l) => assert.equal(leagueBySlug(l.slug).code, l.code));
});
