/* Dati strutturati (schema.org) per Google: percorso della pagina, partita e sito, in italiano e in inglese. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { breadcrumbLd, sportsEventLd, websiteLd } from "../src/lib/seo.js";
import { setLang } from "../src/lib/i18n.js";

const SITE = "https://fischiettofinale.com";
const m = { id: 7, home: "Inter", away: "Milan", kickoff: "2026-11-01T19:45:00Z" };

test("percorso della pagina", () => {
  setLang("it");
  const b = breadcrumbLd(SITE, { league: "PL", section: "partite", extra: [{ name: "Arsenal – Chelsea", path: "/premier-league/partita/1-arsenal-chelsea/" }] });
  assert.deepEqual(b.itemListElement.map((x) => [x.position, x.name, x.item]), [
    [1, "Fischietto finale", SITE + "/"], [2, "Premier League", SITE + "/premier-league/"],
    [3, "Partite", SITE + "/premier-league/partite/"], [4, "Arsenal – Chelsea", SITE + "/premier-league/partita/1-arsenal-chelsea/"]
  ]);
  // La Serie A è la Home: un livello solo per Home e campionato.
  assert.deepEqual(breadcrumbLd(SITE, { league: "SA", section: "classifica" }).itemListElement.map((x) => x.name), ["Fischietto finale · Serie A", "Classifica"]);
  assert.equal(breadcrumbLd(SITE, { league: "SA", section: "home" }), null, "la Home non ha percorso");
  assert.equal(breadcrumbLd(SITE, {}), null);
  setLang("en");
  assert.deepEqual(breadcrumbLd(SITE, { league: "SA", section: "schedina" }).itemListElement.map((x) => [x.name, x.item]),
    [["Fischietto finale", SITE + "/en/"], ["Serie A", SITE + "/en/serie-a/"], ["The model's picks", SITE + "/en/serie-a/model-picks/"]]);
  setLang("it");
});

test("partita come SportsEvent, solo con un orario valido", () => {
  setLang("it");
  const e = sportsEventLd(SITE, "SA", m, "descrizione");
  assert.equal(e["@type"], "SportsEvent");
  assert.equal(e.startDate, m.kickoff);
  assert.equal(e.url, SITE + "/serie-a/partita/7-inter-milan/");
  assert.deepEqual([e.homeTeam.name, e.awayTeam.name, e.superEvent.name, e.sport, e.inLanguage], ["Inter", "Milan", "Serie A", "Calcio", "it"]);
  assert.equal(sportsEventLd(SITE, "SA", { ...m, kickoff: null }, ""), null);
  setLang("en");
  const en = sportsEventLd(SITE, "SA", m, "description");
  assert.deepEqual([en.url, en.sport, en.inLanguage], [SITE + "/en/serie-a/match/7-inter-milan/", "Football", "en"]);
  assert.equal(websiteLd(SITE, "x").url, SITE + "/en/");
  setLang("it");
  assert.equal(websiteLd(SITE, "x").url, SITE + "/");
});
