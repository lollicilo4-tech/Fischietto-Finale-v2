/* Versione inglese: ogni testo passato a t() ha la traduzione, i segnaposto coincidono, le pagine
   generate in inglese non lasciano testi italiani (tranne quelli scritti dal modello Python finché
   non arrivano i campi *_en) e in italiano non cambia nulla. Indirizzi, numeri e date in inglese. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EN } from "../src/lib/i18n-en.js";
import { t, setLang, lang, langOfPath, loc, missingTranslations, resetMissing } from "../src/lib/i18n.js";
import * as C from "../src/lib/core.js";
import * as R from "../src/lib/render.js";
import { computePicks, modelSlipPicks, recLabel, deriveRecommendation, marketText, finalOutcome } from "../src/lib/model.js";
import { liveCardHtml, livePhaseHtml, leagueOptions } from "../src/lib/livefeed.js";
import { liveChartsHtml } from "../src/lib/livecharts.js";
import { myPageHtml, pickerHtml, emptyStore, setPick } from "../src/lib/mypicks.js";
import { nowLiveHtml } from "../src/lib/nowlive.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "../src");
const docs = path.resolve(here, "../../docs");
const read = (f) => (existsSync(path.join(docs, f)) ? JSON.parse(readFileSync(path.join(docs, f), "utf-8")) : null);

function sources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out); else if (/\.(js|mjs|astro)$/.test(name)) out.push(full);
  }
  return out;
}
const literalKeys = () => {
  const keys = new Set();
  for (const f of sources(src)) {
    for (const m of readFileSync(f, "utf-8").matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"\s*[,)]/g)) keys.add(JSON.parse('"' + m[1] + '"'));
  }
  return keys;
};
const holes = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

test("ogni testo passato a t() ha la traduzione inglese, con gli stessi segnaposto", () => {
  const keys = literalKeys();
  assert.ok(keys.size > 300, "le chiavi devono essere trovate nei sorgenti");
  const missing = [...keys].filter((k) => EN[k] == null);
  assert.deepEqual(missing, [], "testi senza traduzione");
  for (const [it, en] of Object.entries(EN)) assert.equal(holes(en), holes(it), "segnaposto diversi in «" + it + "»");
});

test("t(): italiano invariato, inglese tradotto, segnaposto riempiti", () => {
  setLang("it");
  assert.equal(t("Vince {team}", { team: "Inter" }), "Vince Inter");
  assert.equal(t("Testo senza traduzione"), "Testo senza traduzione");
  setLang("en");
  assert.equal(lang(), "en");
  assert.equal(t("Vince {team}", { team: "Inter" }), "Inter win");
  resetMissing();
  assert.equal(t("Testo senza traduzione"), "Testo senza traduzione");
  assert.deepEqual(missingTranslations(), ["Testo senza traduzione"]);
  assert.equal(loc({ text: "ciao", text_en: "hello" }, "text"), "hello");
  assert.equal(loc({ text: "ciao" }, "text"), "ciao");
  setLang("it");
  assert.equal(loc({ text: "ciao", text_en: "hello" }, "text"), "ciao");
  assert.equal(langOfPath("/en/"), "en");
  assert.equal(langOfPath("/en/serie-a/matches/"), "en");
  assert.equal(langOfPath("/enrico/"), "it");
  assert.equal(langOfPath("/"), "it");
});

test("indirizzi inglesi e passaggio da una lingua all'altra", () => {
  setLang("en");
  assert.equal(C.leagueUrl("PL"), "/en/");
  assert.equal(C.leagueUrl("SA"), "/en/serie-a/");
  assert.equal(C.leagueUrl("SA", "partite"), "/en/serie-a/matches/");
  assert.equal(C.leagueUrl("PD", "sicure"), "/en/laliga/most-likely/");
  assert.equal(C.leagueUrl("BL1", "schedina"), "/en/bundesliga/model-picks/");
  assert.equal(C.leagueUrl("FL1", "classifica"), "/en/ligue-1/table/");
  assert.equal(C.leagueUrl("CL", "storico"), "/en/champions-league/history/");
  assert.equal(C.teamUrl("SA", "Inter"), "/en/serie-a/team/inter/");
  assert.equal(C.matchUrl("SA", { id: 7, home: "Inter", away: "Milan" }), "/en/serie-a/match/7-inter-milan/");
  assert.equal(C.liveUrl("PL"), "/en/live/?lega=premier-league");
  assert.equal(C.infoUrl(), "/en/how-it-works/");
  assert.equal(C.privacyUrl(), "/en/privacy/");
  assert.equal(C.myPicksUrl(), "/en/my-predictions/");
  setLang("it");
  assert.equal(C.leagueUrl("SA"), "/");
  assert.equal(C.leagueUrl("PL"), "/premier-league/");
  assert.equal(C.teamUrl("SA", "Inter"), "/serie-a/squadra/inter/");
  assert.equal(C.infoUrl(), "/come-funziona/");
  const pairs = [
    ["/", "/en/serie-a/"], ["/premier-league/", "/en/"], ["/laliga/", "/en/laliga/"],
    ["/serie-a/partite/", "/en/serie-a/matches/"], ["/laliga/piu-probabili/", "/en/laliga/most-likely/"],
    ["/bundesliga/scelte-del-modello/", "/en/bundesliga/model-picks/"], ["/ligue-1/classifica/", "/en/ligue-1/table/"],
    ["/europa-league/storico/", "/en/europa-league/history/"], ["/serie-a/squadra/inter/", "/en/serie-a/team/inter/"],
    ["/serie-a/partita/7-inter-milan/", "/en/serie-a/match/7-inter-milan/"], ["/come-funziona/", "/en/how-it-works/"],
    ["/privacy/", "/en/privacy/"], ["/i-miei-pronostici/", "/en/my-predictions/"], ["/live/", "/en/live/"]
  ];
  for (const [it, en] of pairs) {
    assert.equal(C.altPath(it, "en"), en, it + " → inglese");
    assert.equal(C.altPath(en, "it"), it, en + " → italiano");
  }
  assert.equal(C.altPath("/en/serie-a/", "it"), "/");
  assert.equal(C.altPath("/en/", "it"), "/premier-league/");
});

test("numeri e date in inglese (ora del Regno Unito), in italiano come prima", () => {
  const k = { kickoff: "2026-10-27T19:45:00Z" };
  setLang("it");
  assert.deepEqual([C.d1(1.25), C.d2(0.256), C.thousandsIt(5000), C.thousandsIt(10000), C.dayOf(k), C.when(k), C.roundDay(k.kickoff), C.shortDay(k.kickoff), C.fmtDay("2026-10-19")],
    ["1,3", "0,26", "5000", "10.000", "Martedì 27 ottobre", "20:45", "Mar 27 ott 20:45", "Mar 27/10", "19 ottobre"]);
  assert.equal(C.dayOf({ label: "Dom 15:00" }), "Domenica");
  assert.equal(C.dayOf({}), "Da programmare");
  setLang("en");
  assert.deepEqual([C.d1(1.25), C.d2(0.256), C.thousandsIt(5000), C.thousandsIt(10000), C.dayOf(k), C.when(k), C.roundDay(k.kickoff), C.shortDay(k.kickoff), C.fmtDay("2026-10-19")],
    ["1.3", "0.26", "5,000", "10,000", "Tuesday 27 October", "19:45", "Tue 27 Oct 19:45", "Tue 27/10", "19 October"]);
  assert.equal(C.dayOf({ label: "Dom 15:00" }), "Sunday");
  assert.equal(C.dayOf({}), "To be scheduled");
  assert.equal(R.ordinal(1) + R.ordinal(2) + R.ordinal(3) + R.ordinal(11) + R.ordinal(22), "1st2nd3rd11th22nd");
  setLang("it");
  assert.equal(R.ordinal(3), "3ª");
});

test("etichette dei mercati scritte dal modello Python ricostruite in inglese", () => {
  const m = { home: "Sassuolo", away: "Lazio" };
  const python = {
    "1": "1 · Vince Sassuolo", "2": "2 · Vince Lazio", X: "X · Pareggio", "1X": "1X · Sassuolo non perde", X2: "X2 · Lazio non perde",
    "Over 1,5": "Over 1,5 · almeno 2 gol", "Over 2,5": "Over 2,5 · almeno 3 gol", "Under 2,5": "Under 2,5 · massimo 2 gol",
    "Under 3,5": "Under 3,5 · massimo 3 gol", Gol: "Gol · entrambe segnano", "No Gol": "No Gol · almeno una resta a 0",
    "1x_o15": "1X + Over 1,5", x2_o15: "X2 + Over 1,5", "1_o15": "1 + Over 1,5", "2_o15": "2 + Over 1,5",
    "1x_u35": "1X + Under 3,5", x2_u35: "X2 + Under 3,5", gg_o25: "Gol + Over 2,5", score: "Risultato esatto · 2-1"
  };
  setLang("it");
  for (const [code, label] of Object.entries(python)) assert.equal(recLabel({ code, label }, m), label);
  setLang("en");
  const en = Object.entries(python).map(([code, label]) => recLabel({ code, label }, m));
  for (const s of en) assert.ok(!/(Vince|non perde|gol\b|Gol\b|massimo|almeno|entrambe|Risultato|,\d)/.test(s), "resta italiano: " + s);
  assert.equal(recLabel({ code: "X2", label: python.X2 }, m), "X2 · Lazio avoid defeat");
  assert.equal(recLabel({ code: "score", label: python.score }, m), "Exact score · 2-1");
  assert.equal(recLabel({ code: "gg_o25", label: python.gg_o25 }, m), "Both score + Over 2.5");
  assert.equal(marketText("Over/Under 2,5"), "Over/Under 2.5");
  assert.equal(finalOutcome({ home: "A", away: "B", prob: { p1: 0.2, px: 0.5, p2: 0.3 } })[1], "Draw");
  setLang("it");
});

/* Parole italiane che non devono restare nelle pagine inglesi. */
const ITALIAN = /(\b(della|delle|degli|partite|giornata|squadra|probabilità|pronostic\w*|affidabilità|risultato|pareggio|vince|trasferta|stagione|classifica|selezioni|azzeccat\w|campionato|modello|notizie|ancora|prossim\w)\b)/i;
function englishOnly(html, where, dataTexts) {
  let own = html.replace(/<div class="srcs">[\s\S]*?<\/div>/g, "");
  for (const s of dataTexts) own = own.split(s).join("");
  own = own.replace(/<[^>]+>/g, " ");
  assert.ok(!ITALIAN.test(own), where + ": resta italiano «" + (own.match(ITALIAN) || [])[0] + "» in …" + own.slice(Math.max(0, own.search(ITALIAN) - 60), own.search(ITALIAN) + 60) + "…");
  for (const bad of ["undefined", "NaN", "[object Object]"]) assert.ok(!html.includes(bad), where + " contiene " + bad);
}

test("tutte le sezioni in inglese sui dati pubblicati, senza testi da tradurre", () => {
  setLang("en"); resetMissing();
  for (const L of C.LEAGUES) {
    const turno = read(L.file + "turno.json"), storico = read(L.file + "storico.json"), classifica = read(L.file + "classifica.json");
    const ctx = { league: L.code, favs: [] };
    /* Testi del modello Python e dell'AI: tradotti dai campi *_en (arrivano con una modifica a parte). */
    const data = [];
    ((turno && turno.matches) || []).forEach((m) => {
      if (m.analysis && m.analysis.text && !m.analysis.text_en) data.push(C.esc(m.analysis.text));
      if (m.explain) {
        if (!m.explain.summary_en) data.push(C.esc(m.explain.summary));
        (m.explain.items || []).forEach((x) => { if (!x.text_en) data.push(C.esc(x.text)); });
      }
      (m.analysis && [].concat(m.analysis.absences_home || [], m.analysis.absences_away || []) || []).forEach((a) => data.push(C.esc(a)));
    });
    if (turno) {
      englishOnly(R.grouped(ctx, turno.matches), L.name + " Partite", data);
      englishOnly(R.nextRoundsPanel(ctx, turno.next_rounds), L.name + " Prossime giornate", data);
      englishOnly(R.playedSection(turno.played), L.name + " Già giocate", data);
      englishOnly(R.hero(turno.matches[0]), L.name + " Hero", data);
      const d = R.homeDashboard(ctx, turno.matches);
      if (d) Object.values(d).forEach((h) => englishOnly(h, L.name + " Home", data));
      [true, false].forEach((nodc) => { const c = R.comboHtml(computePicks(turno.matches, nodc), 4); englishOnly(c.combo + c.decay, L.name + " Più probabili", data); });
      ["facile", "media", "difficile"].forEach((mode) => {
        const picks = modelSlipPicks(turno.matches, mode, 5, turno.market_performance || {});
        englishOnly(R.slipHtml(picks, mode, turno.matches, turno.market_performance || {}, (turno.backtest && turno.backtest.markets) || {}), L.name + " Scelte " + mode, data);
      });
      if (turno.matches[0]) englishOnly(R.shareText(turno.matches[0]), L.name + " Condividi", []);
      englishOnly(R.statusTags(turno, "23/10 19:01"), L.name + " Etichette", []);
    }
    if (classifica) {
      englishOnly(R.tableHtml(ctx, classifica), L.name + " Classifica", []);
      englishOnly(R.seasonPanel(ctx, classifica.season), L.name + " Stagione", []);
    }
    if (storico) Object.entries(R.storicoParts(storico)).forEach(([k, h]) => englishOnly(h, L.name + " Storico " + k, []));
    R.teamsOf(turno, classifica).slice(0, 6).forEach((team) => englishOnly(R.teamPage(ctx, team, { turno, storico, classifica }), L.name + " Squadra " + team, data));
  }
  assert.deepEqual(missingTranslations(), [], "testi chiesti in inglese senza traduzione");
  setLang("it");
});

test("Live Center, In corso adesso e I miei pronostici in inglese", () => {
  setLang("en"); resetMissing();
  const now = Date.parse("2026-10-24T18:30:00Z");
  const m = {
    slug: "inter-vs-milan", home: { name: "Inter" }, away: { name: "Milan" }, home_score: 1, away_score: 0, status: "live", status_text: "2nd half",
    league: { name: "Serie A" }, start_at: "2026-10-24T17:00:00Z", venue: "San Siro", round: "9", live_minute: "67",
    events: [{ type: "goal", minute: 12, player: "Lautaro", team: "Inter" }],
    statistics: [{ name: "Ball possession", home: "55%", away: "45%" }, { name: "Dangerous attacks", home: 40, away: 30 }, { name: "Shots on target", home: 5, away: 2 }]
  };
  englishOnly(liveCardHtml(m, [], now), "Scheda live", []);
  englishOnly(leagueOptions([m]), "Filtro campionati", []);
  ["first half", "half time", "extra time", "penalties", "finished", "live"].forEach((s) => englishOnly(livePhaseHtml({ status_text: s }, now), "Fase " + s, []));
  englishOnly(liveChartsHtml({ home: "Inter", away: "Milan", homeScore: 1, awayScore: 0, status: "67", events: m.events, stats: m.statistics, momentum: [{ m: 60, h: 10, a: 5 }, { m: 61, h: 14, a: 6 }], momentumSource: "server", priors: [] }), "Grafici live", []);
  englishOnly(liveChartsHtml({ home: "Inter", away: "Milan", homeScore: 1, awayScore: 0, status: "67", events: [], stats: [], momentum: [{ m: 60, h: 10, a: 5 }], priors: [] }), "Grafici live (inizio)", []);
  englishOnly(nowLiveHtml([{ home: "Inter", away: "Milan", home_score: 1, away_score: 0, status_text: "2nd half", live_minute: "67", league: "Serie A" }], "/en/live/", now), "In corso adesso", []);
  const match = { league: "SA", id: "1", home: "Inter", away: "Milan", kickoff: "2026-10-30T19:45:00Z" };
  let store = emptyStore();
  englishOnly(myPageHtml(store, now), "I miei pronostici vuoto", []);
  englishOnly(pickerHtml(match, store, now), "Pulsanti pronostico", []);
  store = setPick(store, match, "X", now);
  store.picks["SA:2"] = { league: "SA", id: "2", home: "Roma", away: "Lazio", kickoff: "2026-10-20T18:00:00Z", pick: "1", at: now, result: { hg: 2, ag: 1, actual: "1", model: "X" } };
  englishOnly(myPageHtml(store, now), "I miei pronostici", []);
  englishOnly(pickerHtml(match, store, now), "Pulsanti pronostico scelto", []);
  assert.ok(myPageHtml(emptyStore(), now).includes('href="/en/'), "i link restano nelle pagine inglesi");
  assert.deepEqual(missingTranslations(), []);
  setLang("it");
});

test("in italiano le pagine non cambiano: stesse stringhe di prima per i casi principali", () => {
  setLang("it");
  const turno = read("turno.json");
  if (!turno) return;
  const m = turno.matches[0], rec = deriveRecommendation(m);
  assert.equal(recLabel(rec.best, m), rec.best.label);
  assert.ok(R.card({ league: "SA", favs: [] }, m, 0).includes("Pronostico finale del modello"));
});
