/* Consigli per il fantacalcio (solo Serie A, solo in italiano): ricavati dai gol attesi che il modello
   pubblica già in turno.json, senza dati nuovi né API.
   - Porta inviolata: probabilità che l'avversaria non segni, exp(-gol attesi dell'avversaria). Con il modello
     Dixon-Coles è esatta: la correzione cambia solo i risultati bassi e si annulla sulla somma di ogni riga.
   - Almeno 2 gol: 1 - e^-λ (1 + λ), Poisson sui gol attesi della squadra.
   - Calendario: probabilità di vittoria della squadra nelle prossime giornate (turno + next_rounds).
   Funzioni pure: niente DOM, niente fetch. Ogni dato nell'HTML passa da esc(). */
import { pc, d2, esc, roundDay } from "./core.js";
import { teamLink } from "./render.js";

const ok = (m) => m && m.home && m.away && Array.isArray(m.xg) && m.xg.length === 2 && m.xg.every((x) => Number.isFinite(x) && x >= 0);

export const cleanSheet = (xgAgainst) => Math.exp(-xgAgainst);
export const twoPlus = (xgFor) => 1 - Math.exp(-xgFor) * (1 + xgFor);

/* Una riga per squadra delle partite ancora da giocare del turno. */
export function fantaRows(matches) {
  const rows = [];
  (matches || []).filter(ok).forEach((m) => {
    [[m.home, m.away, true, m.xg[0], m.xg[1]], [m.away, m.home, false, m.xg[1], m.xg[0]]].forEach(([team, opp, home, xf, xa]) => {
      rows.push({ team, opp, home, xgFor: xf, xgAgainst: xa, cs: cleanSheet(xa), two: twoPlus(xf), kickoff: m.kickoff || null });
    });
  });
  return rows;
}

/* Le tre squadre in evidenza: capitano (più gol attesi), difesa (porta inviolata più probabile),
   giornata difficile (meno gol attesi e porta inviolata meno probabile). */
export function highlights(rows) {
  if (!rows.length) return null;
  const by = (f) => rows.slice().sort(f);
  return {
    attack: by((a, b) => b.xgFor - a.xgFor || a.team.localeCompare(b.team)).slice(0, 3),
    defence: by((a, b) => b.cs - a.cs || a.team.localeCompare(b.team)).slice(0, 3),
    avoid: by((a, b) => (a.xgFor - a.xgAgainst) - (b.xgFor - b.xgAgainst) || a.team.localeCompare(b.team)).slice(0, 3)
  };
}

/* Calendario: le giornate disponibili (quella in corso e le prossime) e, per ogni squadra, avversaria,
   casa/trasferta e probabilità di vittoria. Ordinato dalla media più alta. */
export function fantaCalendar(turno) {
  if (!turno) return { rounds: [], teams: [] };
  const rounds = [{ matchday: turno.matchday, matches: turno.matches || [] }]
    .concat((turno.next_rounds || []).filter((r) => r && Array.isArray(r.matches)))
    .filter((r) => r.matches.length);
  const table = new Map();
  rounds.forEach((r, i) => r.matches.forEach((m) => {
    if (!m || !m.home || !m.away || !m.prob) return;
    [[m.home, m.away, true, m.prob.p1], [m.away, m.home, false, m.prob.p2]].forEach(([team, opp, home, p]) => {
      if (!Number.isFinite(p)) return;
      if (!table.has(team)) table.set(team, new Array(rounds.length).fill(null));
      table.get(team)[i] = { opp, home, p };
    });
  }));
  const teams = [...table.entries()].map(([team, cells]) => {
    const ps = cells.filter(Boolean).map((c) => c.p);
    return { team, cells, avg: ps.length ? ps.reduce((s, x) => s + x, 0) / ps.length : 0 };
  }).sort((a, b) => b.avg - a.avg || a.team.localeCompare(b.team));
  return { rounds: rounds.map((r) => r.matchday), teams };
}

/* Fascia di colore della cella: favorevole · equilibrata · difficile. */
export const tier = (p) => (p >= 0.5 ? "easy" : p >= 0.3 ? "mid" : "hard");
/* Porta inviolata: in Serie A una squadra la tiene in circa un terzo delle partite. */
export const csTier = (p) => (p >= 0.35 ? "easy" : p >= 0.2 ? "mid" : "hard");
/* Sigla dell'avversaria: le prime tre lettere (Como 1907 → COM). Il nome intero sta nel title. */
export const short = (name) => String(name).replace(/[^A-Za-zÀ-ÿ]/g, "").slice(0, 3).toUpperCase() || "—";
const where = (home) => (home ? "in casa" : "in trasferta");

/* Prima partita ancora da giocare del turno: entro quell'ora va schierata la formazione. */
export function firstKickoff(matches) {
  const ks = (matches || []).map((m) => m && m.kickoff).filter((k) => Number.isFinite(Date.parse(k || ""))).sort();
  return ks.length ? ks[0] : null;
}

/* ---------- HTML ---------- */
function pickCard(ctx, title, hint, list, value) {
  return '<div class="panel fanta-pick"><div class="fanta-pick-head"><h3>' + esc(title) + "</h3><small>" + esc(hint) + "</small></div><ol>" +
    list.map((r) => "<li><span>" + teamLink(ctx, r.team) + "<small>" + esc(where(r.home)) + " con " + esc(r.opp) + "</small></span><b>" + value(r) + "</b></li>").join("") +
    "</ol></div>";
}

export function highlightsHtml(ctx, rows) {
  const h = highlights(rows);
  if (!h) return "";
  return '<div class="fanta-picks">' +
    pickCard(ctx, "Capitano", "attaccanti delle squadre con più gol attesi", h.attack, (r) => d2(r.xgFor) + "<small>gol attesi</small>") +
    pickCard(ctx, "Portiere e difesa", "porta inviolata più probabile", h.defence, (r) => pc(r.cs) + "<small>porta inviolata</small>") +
    pickCard(ctx, "Giornata difficile", "meglio pensarci prima di schierarli", h.avoid, (r) => d2(r.xgFor) + " – " + d2(r.xgAgainst) + "<small>gol fatti – subiti attesi</small>") +
    "</div>";
}

export function roundTableHtml(ctx, rows) {
  if (!rows.length) return '<div class="msg">Nessuna partita della giornata ancora da giocare.</div>';
  const sorted = rows.slice().sort((a, b) => b.xgFor - a.xgFor || a.team.localeCompare(b.team));
  return '<div class="fanta-scroll"><table class="table fanta-table"><thead><tr><th>Squadra</th><th>Avversaria</th><th>Gol attesi</th><th class="hide-s">Almeno 2 gol</th><th>Porta inviolata</th></tr></thead><tbody>' +
    sorted.map((r) => "<tr><td>" + teamLink(ctx, r.team) + "</td><td>" + esc(r.opp) + ' <small class="fanta-where">' + (r.home ? "C" : "T") + "</small></td><td>" + d2(r.xgFor) +
      "</td><td class=\"hide-s\">" + pc(r.two) + '</td><td class="fanta-cs ' + csTier(r.cs) + '">' + pc(r.cs) + "</td></tr>").join("") +
    "</tbody></table></div>";
}

export function calendarHtml(ctx, cal) {
  if (!cal.teams.length) return '<div class="msg">Calendario non disponibile.</div>';
  return '<div class="fanta-scroll"><table class="fanta-cal"><thead><tr><th>Squadra</th>' + cal.rounds.map((d) => "<th>G" + esc(d) + "</th>").join("") + "<th>Media</th></tr></thead><tbody>" +
    cal.teams.map((r) => "<tr><td>" + teamLink(ctx, r.team) + "</td>" +
      r.cells.map((c) => (c
        ? '<td class="' + tier(c.p) + '" title="' + esc(c.opp + " " + where(c.home) + ": vittoria " + pc(c.p)) + '"><b>' + esc(short(c.opp)) + "</b><small>" + (c.home ? "C" : "T") + " · " + pc(c.p) + "</small></td>"
        : '<td class="none">–</td>')).join("") +
      "<td>" + pc(r.avg) + "</td></tr>").join("") +
    "</tbody></table></div>";
}

export const deadlineText = (matches) => {
  const k = firstKickoff(matches);
  return k ? "Prima partita: " + roundDay(k) : "";
};
