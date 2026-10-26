/* "I miei pronostici": chi visita sceglie 1, X o 2 prima del calcio d'inizio e vede quante ne azzecca
   rispetto al modello. È una sfida contro il modello, non una scommessa: niente soldi, niente quote.
   Tutto resta nel browser (localStorage, chiave PICKS_KEY): nessun account, niente arriva al server.
   Funzioni pure, provate in Node; il DOM è in scripts/mypicks.js e scripts/mypage.js. */
import { esc, leagueByCode, leagueUrl, when, dayOf, defaultLeague, MYPICKS_URL, myPicksUrl } from "./core.js";
import { t } from "./i18n.js";

export const PICKS_KEY = "ff-miei-pronostici-v1";
export { MYPICKS_URL };
export const MAX_PICKS = 400;
const LABEL = { "1": "1", X: "X", "2": "2" };

export const pickKey = (league, id) => league + ":" + id;
export function emptyStore() { return { v: 1, picks: {} }; }
export function parseStore(text) {
  try {
    const s = JSON.parse(text || "");
    if (s && s.v === 1 && s.picks && typeof s.picks === "object") return s;
  } catch (e) { /* dato rovinato: si riparte da zero */ }
  return emptyStore();
}

/* Si può scegliere solo prima del calcio d'inizio (orario sconosciuto: sì). */
export function isOpen(kickoff, now = Date.now()) {
  const t = Date.parse(kickoff || "");
  return !Number.isFinite(t) || now < t;
}

/* Imposta o toglie (pick null, o lo stesso già scelto) il pronostico di una partita. Ritorna lo store nuovo. */
export function setPick(store, match, pick, now = Date.now()) {
  const s = { v: 1, picks: { ...store.picks } };
  const key = pickKey(match.league, match.id), prev = s.picks[key];
  if (!isOpen(match.kickoff, now)) return s;
  if (!pick || !LABEL[pick] || (prev && prev.pick === pick)) { delete s.picks[key]; return s; }
  s.picks[key] = { league: match.league, id: String(match.id), home: match.home, away: match.away, kickoff: match.kickoff || null, pick, at: now };
  // Lo spazio del browser è poco: oltre MAX_PICKS si tolgono i più vecchi.
  const keys = Object.keys(s.picks);
  if (keys.length > MAX_PICKS) keys.sort((a, b) => (s.picks[a].at || 0) - (s.picks[b].at || 0)).slice(0, keys.length - MAX_PICKS).forEach((k) => delete s.picks[k]);
  return s;
}

/* Aggiunge i risultati arrivati (results: { "SA:558563": { hg, ag, actual, model } }). Il risultato resta
   salvato con il pronostico, così lo storico non si perde quando la partita esce dai dati del sito. */
export function withResults(store, results) {
  const s = { v: 1, picks: { ...store.picks } };
  let changed = false;
  Object.keys(s.picks).forEach((k) => {
    const r = results && results[k], p = s.picks[k];
    if (r && LABEL[r.actual] && !p.result) { s.picks[k] = { ...p, result: { hg: r.hg, ag: r.ag, actual: r.actual, model: LABEL[r.model] ? r.model : null } }; changed = true; }
  });
  return { store: s, changed };
}

/* Conti della sfida: solo partite con risultato. Il modello si conta sulle stesse partite. */
export function challengeStats(store) {
  const done = Object.values(store.picks).filter((p) => p.result).sort((a, b) => String(a.kickoff).localeCompare(String(b.kickoff)));
  const you = done.filter((p) => p.pick === p.result.actual).length;
  const withModel = done.filter((p) => p.result.model);
  const model = withModel.filter((p) => p.result.model === p.result.actual).length;
  return { done, total: done.length, you, modelTotal: withModel.length, model };
}

/* ---------- Pulsanti nella scheda della partita ---------- */
export function pickerHtml(match, store, now = Date.now()) {
  const current = store.picks[pickKey(match.league, match.id)];
  const open = isOpen(match.kickoff, now);
  const opt = (pick, text) => '<button type="button" data-my-pick="' + pick + '" aria-pressed="' + String(!!current && current.pick === pick) + '"' + (open ? "" : " disabled") + ">" + esc(text) + "</button>";
  const note = open
    ? (current ? t("Puoi cambiarlo fino al calcio d'inizio (toccalo di nuovo per toglierlo).") : t("Scegli prima del calcio d'inizio e sfida il modello."))
    : (current ? t("Chiuso al calcio d'inizio.") : t("Pronostici chiusi: la partita è iniziata."));
  return '<div class="my-pick" role="group" aria-label="' + t("Il tuo pronostico") + '"><div class="my-pick-head"><b>' + t("Il tuo pronostico") + '</b><a href="' + myPicksUrl() + '">' + t("I miei pronostici →") + "</a></div>" +
    '<div class="my-pick-options">' + opt("1", "1 · " + match.home) + opt("X", "X · " + t("Pareggio")) + opt("2", "2 · " + match.away) + "</div>" +
    '<p class="my-pick-note">' + esc(note) + "</p></div>";
}

/* ---------- Pagina "I miei pronostici" ---------- */
const pct = (a, b) => (b ? Math.round((a / b) * 100) + "%" : "–");
function bar(label, ok, total, cls) {
  return '<div class="my-bar ' + cls + '"><div class="my-bar-top"><b>' + esc(label) + "</b><span>" + t("{a} su {b}", { a: ok, b: total }) + " · " + pct(ok, total) + '</span></div><div class="my-bar-track"><span style="width:' + (total ? Math.round((ok / total) * 100) : 0) + '%"></span></div></div>';
}
const matchLabel = (p) => esc(p.home) + " – " + esc(p.away);
const pickText = (p, pick) => (pick === "1" ? "1 · " + esc(p.home) : pick === "2" ? "2 · " + esc(p.away) : "X · " + t("Pareggio"));
const leagueName = (code) => { const l = leagueByCode(code); return l ? l.name : code; };

export function myPageHtml(store, now = Date.now()) {
  const all = Object.values(store.picks);
  if (!all.length) {
    return '<div class="panel"><h2>' + t("Nessun pronostico ancora") + '</h2><p class="expl">' + t("Apri una partita in <a href=\"{url}\">Partite</a> e scegli 1, X o 2 prima del calcio d'inizio. Quando arriva il risultato lo trovi qui, confrontato con il modello.", { url: leagueUrl(defaultLeague(), "partite") }) + "</p></div>";
  }
  const st = challengeStats(store);
  const waiting = all.filter((p) => !p.result).sort((a, b) => String(a.kickoff).localeCompare(String(b.kickoff)));
  let html = '<div class="panel my-score"><h2>' + t("La sfida") + "</h2>";
  if (st.total) {
    html += bar(t("Tu"), st.you, st.total, "you") + bar(t("Modello"), st.model, st.modelTotal, "model") +
      '<p class="expl">' + (st.you > st.model ? t("Per ora batti il modello.") : st.you === st.model ? t("Per ora sei pari con il modello.") : t("Per ora il modello è avanti.")) +
      " " + t("Contano solo le partite con risultato; il modello si conta sulle stesse partite.") + "</p>" +
      '<div class="my-dots" aria-label="' + t("Ultimi pronostici: verde azzeccato, rosso sbagliato") + '">' +
      st.done.slice(-20).map((p) => '<span class="' + (p.pick === p.result.actual ? "ok" : "ko") + '" title="' + matchLabel(p) + '"></span>').join("") + "</div>";
  } else {
    html += '<p class="expl">' + t("Nessun risultato ancora: i conti partono quando finiscono le prime partite che hai scelto.") + "</p>";
  }
  html += "</div>";
  if (waiting.length) {
    html += '<div class="panel"><h2>' + t("In attesa") + '</h2><div class="my-list">' + waiting.map((p) =>
      '<div class="my-row"><div><b>' + matchLabel(p) + "</b><small>" + esc(leagueName(p.league)) + (p.kickoff ? " · " + esc(dayOf(p)) + " " + esc(when(p)) : "") +
      '</small></div><div class="my-row-pick">' + pickText(p, p.pick) + "<small>" + (isOpen(p.kickoff, now) ? t("modificabile") : t("in corso o in attesa del risultato")) + "</small></div></div>").join("") + "</div></div>";
  }
  if (st.total) {
    html += '<div class="panel"><h2>' + t("Concluse") + '</h2><div class="my-list">' + st.done.slice().reverse().map((p) => {
      const ok = p.pick === p.result.actual, mok = p.result.model && p.result.model === p.result.actual;
      return '<div class="my-row"><div><b>' + matchLabel(p) + " <span class=\"num\">" + esc(String(p.result.hg)) + "-" + esc(String(p.result.ag)) + "</span></b><small>" + esc(leagueName(p.league)) +
        (p.result.model ? " · " + t("modello:") + " " + esc(p.result.model) + (mok ? " ✓" : " ✗") : "") + '</small></div><div class="my-row-pick ' + (ok ? "ok" : "ko") + '">' + (ok ? "✓ " : "✗ ") + pickText(p, p.pick) + "</div></div>";
    }).join("") + "</div></div>";
  }
  return html + '<p class="lead"><button type="button" class="ff-clear" id="my-clear">' + t("Cancella tutti i miei pronostici") + "</button></p>";
}
