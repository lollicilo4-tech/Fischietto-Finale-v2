/* Lettura dei JSON generati dal workflow "Aggiorna pronostici" (docs/), solo durante il build.
   Il sito Astro non chiama nessuna API: usa gli stessi file pubblicati oggi su GitHub Pages.
   FF_DATA_DIR permette di puntare a un'altra cartella (per esempio nei test). */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { LEAGUES, MOMENTUM_LEAGUES, leagueByCode, updatedAt } from "./core.js";
import { teamsOf } from "./render.js";
import { setCrests } from "./crests.js";

export const dataDir = () => path.resolve(process.cwd(), process.env.FF_DATA_DIR || "../docs");

const cache = new Map();
function readJson(file) {
  const full = path.join(dataDir(), file);
  if (cache.has(full)) return cache.get(full);
  let value = null;
  if (existsSync(full)) {
    try { value = JSON.parse(readFileSync(full, "utf-8")); }
    catch (e) { throw new Error("JSON non valido in " + full + ": " + e.message); }
  }
  cache.set(full, value);
  return value;
}

/* Nome del file pubblicato per un campionato: Serie A usa turno.json, le altre league-XX-turno.json. */
export const fileName = (league, kind) => leagueByCode(league).file + kind + ".json";

/* Stemmi delle squadre (docs/crests.json, app/crests.py): caricati una volta, alla prima pagina. */
let crestsLoaded = false;
export function crestIndex() {
  const v = readJson("crests.json");
  return v && v.teams && typeof v.teams === "object" ? v.teams : {};
}
function loadCrests() {
  if (crestsLoaded) return;
  crestsLoaded = true;
  setCrests(crestIndex());
}
/* File degli stemmi da trasformare in PNG: [{ stem, file }] (nomi già controllati da apply_generated.py). */
export function crestFiles() {
  const files = new Set();
  Object.values(crestIndex()).forEach((teams) => Object.values(teams || {}).forEach((f) => { if (/^[0-9a-f]{16}\.(png|svg)$/.test(f)) files.add(f); }));
  return [...files].filter((f) => existsSync(path.join(dataDir(), "crests", f))).map((f) => ({ stem: f.slice(0, 16), file: f }));
}
export const crestPath = (file) => path.join(dataDir(), "crests", file);

/* {turno, storico, classifica} di un campionato. Un file mancante diventa null: la pagina
   mostra il messaggio "non disponibile", come oggi quando una lega non è stata aggiornata. */
export function leagueData(league) {
  loadCrests();
  const turno = readJson(fileName(league, "turno"));
  return {
    turno: turno && Array.isArray(turno.matches) ? turno : null,
    storico: readJson(fileName(league, "storico")),
    classifica: readJson(fileName(league, "classifica"))
  };
}

export function leagueMeta(league) {
  const { turno } = leagueData(league);
  return {
    matchday: turno && turno.matchday,
    nMatches: turno ? turno.matches.length : 0,
    updated: turno && turno.generated_at ? updatedAt(turno.generated_at) : "",
    generatedAt: turno && turno.generated_at
  };
}

export const allTeams = (league) => { const d = leagueData(league); return teamsOf(d.turno, d.classifica); };

/* Gol attesi di tutte le partite in programma: il Live Center li usa come pronostico di partenza. */
export function livePriors() {
  const out = [];
  LEAGUES.forEach((l) => {
    const t = leagueData(l.code).turno;
    (t ? t.matches : []).forEach((m) => { if (m.xg) out.push({ home: m.home, away: m.away, xg: [m.xg[0], m.xg[1]] }); });
  });
  return out;
}

/* Calendario per il Worker del momentum (/live-calendar.json): le partite in programma dei campionati
   seguiti dal Worker (MOMENTUM_LEAGUES) con nomi e orario. Il Worker lo usa per chiedere a SportScore il dettaglio delle partite
   in corso anche quando la lista "live" del servizio non le elenca. */
export function liveCalendar() {
  const out = [], seen = new Set();
  MOMENTUM_LEAGUES.forEach((l) => {
    const t = leagueData(l.code).turno;
    if (!t) return;
    /* Una partita già iniziata quando gira "Aggiorna pronostici" esce da matches e resta solo in
       next_rounds: senza questa seconda fonte il Worker la perderebbe a metà (Napoli-Roma, 24 ottobre). */
    const rounds = (t.next_rounds || []).flatMap((r) => (r && Array.isArray(r.matches) ? r.matches : []));
    t.matches.concat(rounds).forEach((m) => {
      const key = l.code + ":" + m.id;
      if (!m || !m.kickoff || !m.home || !m.away || seen.has(key)) return;
      seen.add(key);
      out.push({ league: l.code, liveKey: l.liveKey, id: String(m.id), home: m.home, away: m.away, kickoff: m.kickoff });
    });
  });
  return out.sort((a, b) => a.kickoff.localeCompare(b.kickoff));
}

/* Risultati delle partite giocate di recente (/risultati-recenti.json) per "I miei pronostici":
   { "SA:558563": { hg, ag, actual: "1"|"X"|"2", model: pronostico 1X2 del modello } }. */
export function recentResults() {
  const out = {};
  LEAGUES.forEach((l) => {
    const t = leagueData(l.code).turno;
    ((t && t.played) || []).forEach((m) => {
      if (m && m.id != null && ["1", "X", "2"].includes(m.actual) && Number.isFinite(m.hg) && Number.isFinite(m.ag)) {
        out[l.code + ":" + m.id] = { hg: m.hg, ag: m.ag, actual: m.actual, model: ["1", "X", "2"].includes(m.pick) ? m.pick : null };
      }
    });
  });
  return out;
}

/* Solo i campi che servono a "Più probabili" e "Le scelte del modello" nel browser, incorporati nella pagina. */
export function slimMatches(matches) {
  return (matches || []).map((m) => ({
    id: m.id, home: m.home, away: m.away, prob: m.prob, xg: m.xg, markets: m.markets,
    top_scores: m.top_scores, recommendation: m.recommendation, analysis: { ai: !!(m.analysis && m.analysis.ai) }
  }));
}
/* JSON sicuro dentro <script type="application/json">: "<" non può chiudere il tag. */
export const inlineJson = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
