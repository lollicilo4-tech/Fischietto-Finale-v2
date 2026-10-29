/* Giocatori nel fantacalcio (Serie A): probabilità di segnare e bonus attesi nelle prossime giornate.
   Dati: i marcatori di football-data.org (classifica.scorers: gol, assist, presenze, ruolo) e i gol attesi
   di ogni squadra che il modello pubblica in turno.json (giornata in corso e next_rounds).

   Quota di un giocatore: la parte dei gol della squadra che segna quando è in campo,
     quota gol = (gol + K · Q0) / (presenze · gol a partita della squadra + K)
   con K e Q0 che a inizio stagione tengono basse le quote di chi ha segnato tanto in poche partite.
   In una partita in cui la squadra ha λ gol attesi: probabilità di segnare = 1 − e^(−λ · quota gol);
   bonus attesi = 3 · λ · quota gol + 1 · λ · quota assist (bonus classici: gol +3, assist +1).
   Tutto vale SE il giocatore è in campo: le formazioni non le conosciamo. Nella giornata in corso
   togliamo gli assenti confermati dall'analisi delle notizie (analysis.absences_home/away).
   Funzioni pure, provate in Node. Ogni dato nell'HTML passa da esc(). */
import { esc, pc, d2 } from "./core.js";
import { teamLink } from "./render.js";
import { short } from "./fanta.js";

export const K = 6, GOAL_PRIOR = 0.06, ASSIST_PRIOR = 0.04, MAX_GOAL_SHARE = 0.6, MAX_ASSIST_SHARE = 0.4;
export const BONUS = { goal: 3, assist: 1 };
export const ROUNDS = 5;
export const ROLE_LABEL = { P: "Portiere", D: "Difensore", C: "Centrocampista", A: "Attaccante" };
export const ROLE_SHORT = { P: "P", D: "D", C: "C", A: "A" };

/* "Lautaro Martínez" → "lautaro martinez" */
export const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, " ").trim();
const num = (v) => (Number.isFinite(v) ? v : 0);

/* Quote di gol e assist di ogni marcatore la cui squadra è in classifica. */
export function playerRates(classifica) {
  const table = new Map(((classifica && classifica.table) || []).filter((r) => r && r.team && r.pg > 0).map((r) => [r.team, r]));
  return ((classifica && classifica.scorers) || []).filter((s) => s && s.player && Number.isFinite(s.goals) && table.has(s.team)).map((s) => {
    const t = table.get(s.team), perMatch = Math.max(num(t.gf), 1) / t.pg;
    const played = Number.isFinite(s.played) && s.played > 0 ? Math.min(s.played, t.pg) : t.pg;
    const exposure = played * perMatch;
    return {
      player: s.player, team: s.team, role: ROLE_LABEL[s.role] ? s.role : null,
      goals: s.goals, assists: Number.isFinite(s.assists) ? s.assists : null, penalties: num(s.penalties), played, teamPg: t.pg,
      gShare: Math.min(MAX_GOAL_SHARE, (s.goals + K * GOAL_PRIOR) / (exposure + K)),
      aShare: Math.min(MAX_ASSIST_SHARE, (num(s.assists) + K * ASSIST_PRIOR) / (exposure + K))
    };
  });
}

/* Il giocatore è tra gli assenti confermati? Le notizie scrivono quasi sempre solo il cognome ("Dybala"):
   basta il nome intero o una parola del nome dopo la prima, di almeno 4 lettere ("Thuram" per
   Marcus Thuram-Ulien). Un nome di una sola parola ("Raphinha") vale da solo. Senza accenti. */
export function isAbsent(player, absences) {
  const words = norm(player).split(" ");
  const keys = (words.length === 1 ? words : words.slice(1)).filter((w) => w.length >= 4);
  if (!keys.length && !words[0]) return false;
  return (absences || []).some((a) => {
    const text = " " + norm(a) + " ";
    return text.includes(" " + norm(player) + " ") || keys.some((w) => text.includes(" " + w + " "));
  });
}

/* Giornate considerate: quella in corso (solo partite ancora da giocare) e le prossime. */
export function roundsOf(turno, maxRounds = ROUNDS) {
  if (!turno) return [];
  return [{ matchday: turno.matchday, matches: turno.matches || [] }]
    .concat((turno.next_rounds || []).filter((r) => r && Array.isArray(r.matches)))
    .filter((r) => r.matches.length).slice(0, maxRounds);
}

const okXg = (m) => m && Array.isArray(m.xg) && m.xg.length === 2 && m.xg.every((x) => Number.isFinite(x) && x >= 0);

/* Proiezioni: { rounds: [giornate], players: [{ ...quote, cells: [cella|null], total, games }] }.
   cella: { opp, home, lambda, p, xb, absent }. total: bonus attesi nelle partite in cui non è assente. */
export function playerProjections(turno, classifica, maxRounds = ROUNDS) {
  const rounds = roundsOf(turno, maxRounds);
  const players = playerRates(classifica).map((r) => {
    const cells = rounds.map((round, i) => {
      const m = round.matches.find((x) => okXg(x) && (x.home === r.team || x.away === r.team));
      if (!m) return null;
      const home = m.home === r.team, lambda = home ? m.xg[0] : m.xg[1];
      const a = (m.analysis && (home ? m.analysis.absences_home : m.analysis.absences_away)) || [];
      const absent = i === 0 && isAbsent(r.player, a);
      return { opp: home ? m.away : m.home, home, lambda, p: 1 - Math.exp(-lambda * r.gShare),
        xb: BONUS.goal * lambda * r.gShare + BONUS.assist * lambda * r.aShare, absent, kickoff: m.kickoff || null };
    });
    const live = cells.filter((c) => c && !c.absent);
    return { ...r, cells, total: live.reduce((s, c) => s + c.xb, 0), games: live.length };
  });
  return { rounds: rounds.map((r) => r.matchday), players };
}

/* Chi può segnare nella giornata in corso: i più probabili tra chi non è assente. */
export const roundScorers = (proj, n = 10) => proj.players.filter((p) => p.cells[0] && !p.cells[0].absent)
  .sort((a, b) => b.cells[0].p - a.cells[0].p || a.player.localeCompare(b.player)).slice(0, n);
/* Capitano: più bonus attesi nella giornata in corso. */
export const roundCaptains = (proj, n = 3) => proj.players.filter((p) => p.cells[0] && !p.cells[0].absent)
  .sort((a, b) => b.cells[0].xb - a.cells[0].xb || a.player.localeCompare(b.player)).slice(0, n);
export const roundAbsent = (proj) => proj.players.filter((p) => p.cells[0] && p.cells[0].absent);
/* I migliori per le prossime giornate: più bonus attesi in tutte le partite considerate. role: P/D/C/A o null. */
export const bestPlayers = (proj, role = null, n = 20) => proj.players.filter((p) => p.games && (!role || p.role === role))
  .sort((a, b) => b.total - a.total || a.player.localeCompare(b.player)).slice(0, n);
export const rolesPresent = (proj) => ["A", "C", "D"].filter((r) => proj.players.some((p) => p.role === r));

/* Dati per "La mia rosa" (nel browser): un elemento per marcatore con la partita della giornata in corso. */
export const rosaPlayers = (proj) => proj.players.filter((p) => p.cells[0]).map((p) => ({
  player: p.player, team: p.team, role: p.role, gShare: +p.gShare.toFixed(4),
  p: +p.cells[0].p.toFixed(4), xb: +p.cells[0].xb.toFixed(4), absent: p.cells[0].absent
}));

/* ---------- HTML ---------- */
export const pTier = (p) => (p >= 0.4 ? "easy" : p >= 0.25 ? "mid" : "hard");
const where = (c) => (c.home ? "in casa con " : "in trasferta con ") + c.opp;
const roleTag = (p) => (p.role ? '<abbr class="fp-role" title="' + ROLE_LABEL[p.role] + '">' + ROLE_SHORT[p.role] + "</abbr> " : "");

export function roundScorersHtml(ctx, proj) {
  const list = roundScorers(proj, 10), absent = roundAbsent(proj);
  if (!list.length) return '<div class="msg">Nessun marcatore con una partita ancora da giocare in questa giornata.</div>';
  return '<ol class="fp-list">' + list.map((p) => '<li class="' + pTier(p.cells[0].p) + '"><span><b>' + roleTag(p) + esc(p.player) + "</b><small>" + teamLink(ctx, p.team) + " · " + esc(where(p.cells[0])) +
    " · " + p.goals + " gol in " + p.played + (p.played === 1 ? " partita" : " partite") + "</small></span><b>" + pc(p.cells[0].p) + "<small>se gioca</small></b></li>").join("") + "</ol>" +
    (absent.length ? '<p class="fp-note">Esclusi perché assenti confermati: ' + absent.map((p) => esc(p.player) + " (" + esc(p.team) + ")").join(", ") + ".</p>" : "");
}

function tableHtml(ctx, proj, list) {
  return '<div class="fanta-scroll"><table class="fanta-cal fp-table"><thead><tr><th>Giocatore</th>' + proj.rounds.map((d) => "<th>G" + esc(d) + "</th>").join("") +
    '<th title="Bonus attesi: gol +3, assist +1, nelle partite considerate">Bonus</th></tr></thead><tbody>' +
    list.map((p) => "<tr><td><b>" + roleTag(p) + esc(p.player) + "</b><small>" + teamLink(ctx, p.team) + "</small></td>" +
      p.cells.map((c) => (!c ? '<td class="none">–</td>'
        : c.absent ? '<td class="none" title="Assente confermato">ass.</td>'
          : '<td class="' + pTier(c.p) + '" title="' + esc(where(c) + ": probabilità di segnare " + pc(c.p) + " se gioca") + '"><b>' + esc(short(c.opp)) + "</b><small>" + (c.home ? "C" : "T") + " · " + pc(c.p) + "</small></td>")).join("") +
      "<td>" + d2(p.total) + "</td></tr>").join("") + "</tbody></table></div>";
}

/* Tabella dei migliori per le prossime giornate, con i ruoli da scegliere (pulsanti radio e CSS). */
export function bestPlayersHtml(ctx, proj) {
  if (!bestPlayers(proj).length) return '<div class="msg">Marcatori non disponibili: riprova dopo il prossimo aggiornamento.</div>';
  const tabs = [{ key: "all", label: "Tutti", role: null }].concat(rolesPresent(proj).map((r) => ({ key: r.toLowerCase(), label: { A: "Attaccanti", C: "Centrocampisti", D: "Difensori" }[r], role: r })));
  if (tabs.length === 1) return tableHtml(ctx, proj, bestPlayers(proj));
  return '<div class="fp-tabs">' + tabs.map((x, i) => '<input type="radio" name="fp-role" id="fp-' + x.key + '" class="fp-radio fp-radio-' + x.key + '"' + (i === 0 ? " checked" : "") + ">").join("") +
    '<div class="cal-switch" role="group" aria-label="Ruolo">' + tabs.map((x) => '<label for="fp-' + x.key + '" class="cal-label fp-label-' + x.key + '">' + x.label + "</label>").join("") + "</div>" +
    tabs.map((x) => '<div class="fp-pane fp-pane-' + x.key + '">' + tableHtml(ctx, proj, bestPlayers(proj, x.role)) + "</div>").join("") + "</div>";
}
