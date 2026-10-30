/* "Un esempio vero" nella pagina Come funziona: una partita di Serie A in programma, spiegata passo per
   passo con i numeri pubblicati (gol attesi → risultati possibili → 1 X 2 → risultato previsto).
   Si aggiorna a ogni build: l'esempio è sempre una partita vera della giornata. Funzioni pure. */
import { esc, pc, d2, dayOf, when, matchUrl } from "./core.js";
import { finalOutcome, mainScore, otherScores } from "./model.js";

const usable = (m) => m && m.prob && Array.isArray(m.xg) && m.xg.length === 2 && Array.isArray(m.top_scores) && m.top_scores.length >= 2;

/* La partita più netta della giornata: con un favorito chiaro l'esempio si legge meglio. */
export function exampleMatch(turno) {
  const list = ((turno && turno.matches) || []).filter(usable);
  return list.sort((a, b) => finalOutcome(b)[2] - finalOutcome(a)[2] || String(a.kickoff).localeCompare(String(b.kickoff)))[0] || null;
}

const score = (z) => z[0] + "-" + z[1];

/* HTML dell'esempio, in italiano (lang "it") o in inglese ("en"). Vuoto se non ci sono partite. */
export function exampleHtml(league, m, lang = "it") {
  if (!m) return "";
  const fo = finalOutcome(m), s = mainScore(m), others = otherScores(m);
  const total = m.xg[0] + m.xg[1];
  const link = '<a href="' + esc(matchUrl(league, m)) + '">' + esc(m.home + " – " + m.away) + "</a>";
  const name = fo[0] === "1" ? m.home : fo[0] === "2" ? m.away : null;
  if (lang === "en") {
    return "<p>Take " + link + " (" + esc(dayOf(m) + " " + when(m)) + "). The model gives <b>" + esc(m.home) + " " + d2(m.xg[0]) + " expected goals</b> and <b>" + esc(m.away) + " " + d2(m.xg[1]) +
      "</b>: about " + d2(total) + " goals in total.</p>" +
      "<p>From these two numbers come the chances of every possible score. The most likely single scores are " + m.top_scores.slice(0, 3).map((z) => "<b>" + score(z) + "</b> (" + pc(z[2]) + ")").join(", ") +
      ": even the most likely one happens only about once in " + Math.max(2, Math.round(1 / m.top_scores[0][2])) + " matches. That is why an exact score is never a certainty.</p>" +
      "<p>Adding up all the scores where the home side wins, draws or loses gives <b>1 " + pc(m.prob.p1) + " · X " + pc(m.prob.px) + " · 2 " + pc(m.prob.p2) + "</b>. " +
      (name ? "The most likely outcome is a win for " + esc(name) + " (" + pc(fo[2]) + ")" : "The most likely outcome is a draw (" + pc(fo[2]) + ")") +
      ", so the predicted score is the most likely one among those in line with it: <b>" + score(s) + "</b> (" + pc(s[2]) + ")" + (others.length ? ", with " + others.map((z) => score(z) + " " + pc(z[2])).join(" and ") + " close behind" : "") + ".</p>" +
      "<p>" + (name ? "Even so, " + esc(name) + " fails to win " : "Even so, the draw does not happen ") + Math.round((1 - fo[2]) * 10) + " times out of 10: that is what a probability means.</p>";
  }
  return "<p>Prendiamo " + link + " (" + esc(dayOf(m).toLowerCase() + " " + when(m)) + "). Il modello dà <b>" + esc(m.home) + " " + d2(m.xg[0]) + " gol attesi</b> e <b>" + esc(m.away) + " " + d2(m.xg[1]) +
    "</b>: circa " + d2(total) + " gol in tutto.</p>" +
    "<p>Da questi due numeri nascono le probabilità di ogni risultato possibile. I singoli risultati più probabili sono " + m.top_scores.slice(0, 3).map((z) => "<b>" + score(z) + "</b> (" + pc(z[2]) + ")").join(", ") +
    ": anche il più probabile capita più o meno una volta ogni " + Math.max(2, Math.round(1 / m.top_scores[0][2])) + " partite. Per questo un risultato esatto non è mai una certezza.</p>" +
    "<p>Sommando tutti i risultati in cui vince la squadra di casa, si pareggia o vince quella in trasferta si ottiene <b>1 " + pc(m.prob.p1) + " · X " + pc(m.prob.px) + " · 2 " + pc(m.prob.p2) + "</b>. " +
    (name ? "L'esito più probabile è il segno " + fo[0] + " (vince " + esc(name) + ", " + pc(fo[2]) + ")" : "L'esito più probabile è il pareggio (" + pc(fo[2]) + ")") +
    ", quindi il risultato previsto è il più probabile tra quelli in linea con questo esito: <b>" + score(s) + "</b> (" + pc(s[2]) + ")" + (others.length ? ", con " + others.map((z) => score(z) + " " + pc(z[2])).join(" e ") + " poco dietro" : "") + ".</p>" +
    "<p>" + (name ? "Anche così, " + esc(name) + " non vince " : "Anche così, il pareggio non arriva ") + Math.round((1 - fo[2]) * 10) + " volte su 10: è questo il senso di una probabilità.</p>";
}
