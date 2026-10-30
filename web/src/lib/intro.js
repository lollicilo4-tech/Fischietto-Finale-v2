/* Testi introduttivi delle pagine di campionato e di squadra, scritti a partire dai dati pubblicati
   (turno, classifica, simulazione della stagione, marcatori, storico). Ogni frase compare solo se il dato
   c'è: niente frasi fisse uguali in tutte le pagine. In italiano o in inglese (lang).
   Funzioni pure, provate in Node. Ogni nome passa da esc(). */
import { esc, pc, d2, dayOf, leagueByCode, roundWord } from "./core.js";
import { finalOutcome } from "./model.js";
import { zoneLabel } from "./render.js";

const ok = (m) => m && m.prob && Array.isArray(m.xg) && m.xg.length === 2;
const vs = (m) => esc(m.home + " – " + m.away);
const lower = (s) => String(s).charAt(0).toLowerCase() + String(s).slice(1);

/* Le vittorie, i pareggi e le sconfitte in una stringa di forma ("VVNPV", in italiano). */
function formCount(form) {
  const f = String(form || "").toUpperCase();
  return { w: (f.match(/[VW]/g) || []).length, d: (f.match(/[ND]/g) || []).length, l: (f.match(/[PL]/g) || []).length, n: f.length };
}

/* ---------- Campionato ---------- */
export function leagueIntro(league, data, lang = "it") {
  const L = leagueByCode(league), en = lang === "en";
  const turno = data && data.turno, classifica = data && data.classifica, storico = data && data.storico;
  const matches = ((turno && turno.matches) || []).filter(ok);
  const out = [];
  if (matches.length) {
    const days = matches.map((m) => m.kickoff).filter(Boolean).sort();
    const word = lower(roundWord(league));
    const span = days.length > 1 && dayOf({ kickoff: days[0] }) !== dayOf({ kickoff: days[days.length - 1] })
      ? (en ? "from " + dayOf({ kickoff: days[0] }) + " to " + dayOf({ kickoff: days[days.length - 1] }) : "da " + lower(dayOf({ kickoff: days[0] })) + " a " + lower(dayOf({ kickoff: days[days.length - 1] })))
      : (en ? "on " + dayOf({ kickoff: days[0] }) : lower(dayOf({ kickoff: days[0] })));
    out.push(en
      ? (turno.matchday ? "In " + word + " " + esc(turno.matchday) + " of the " + esc(L.name) : "In the " + esc(L.name)) + " there " + (matches.length === 1 ? "is 1 match" : "are " + matches.length + " matches") + " still to play, " + span + "."
      : (turno.matchday ? (L.knockout ? "Nel " : "Nella ") + word + " " + esc(turno.matchday) + " di " + esc(L.name) : "In " + esc(L.name)) + " " + (matches.length === 1 ? "resta 1 partita" : "restano " + matches.length + " partite") + " da giocare, " + span + ".");
    const strongest = matches.slice().sort((a, b) => finalOutcome(b)[2] - finalOutcome(a)[2])[0];
    const fo = finalOutcome(strongest);
    out.push(en
      ? "The clearest prediction is " + vs(strongest) + ": " + (fo[0] === "X" ? "a draw" : esc(fo[1]) + " to win") + " at " + pc(fo[2]) + "."
      : "La previsione più netta è " + vs(strongest) + ": " + (fo[0] === "X" ? "pareggio" : "vince " + esc(fo[1])) + " al " + pc(fo[2]) + ".");
    if (matches.length > 1) {
      const balanced = matches.slice().sort((a, b) => finalOutcome(a)[2] - finalOutcome(b)[2])[0];
      if (balanced !== strongest) {
        const p = balanced.prob;
        out.push(en
          ? "The most open is " + vs(balanced) + " (1 " + pc(p.p1) + ", X " + pc(p.px) + ", 2 " + pc(p.p2) + ")."
          : "La più equilibrata è " + vs(balanced) + " (1 " + pc(p.p1) + ", X " + pc(p.px) + ", 2 " + pc(p.p2) + ").");
      }
      const goals = matches.slice().sort((a, b) => (b.xg[0] + b.xg[1]) - (a.xg[0] + a.xg[1]))[0];
      out.push(en
        ? "The one with the most expected goals is " + vs(goals) + ", about " + d2(goals.xg[0] + goals.xg[1]) + "."
        : "Quella con più gol attesi è " + vs(goals) + ", circa " + d2(goals.xg[0] + goals.xg[1]) + ".");
    }
  }
  const table = (classifica && classifica.table) || [];
  if (table.length >= 2 && table[0].pg > 0) {
    const [a, b] = table, gap = a.pts - b.pts;
    out.push(en
      ? esc(a.team) + " lead the table with " + a.pts + " points" + (gap > 0 ? ", " + gap + " ahead of " + esc(b.team) : ", level with " + esc(b.team)) + "."
      : "In classifica comanda " + esc(a.team) + " con " + a.pts + " punti" + (gap > 0 ? ", " + gap + " in più di " + esc(b.team) : ", alla pari con " + esc(b.team)) + ".");
  }
  const season = classifica && classifica.season && Array.isArray(classifica.season.teams) ? classifica.season.teams : [];
  const fav = season.filter((x) => Number.isFinite(x.title)).sort((x, y) => y.title - x.title)[0];
  if (fav && fav.title > 0) {
    out.push(en
      ? "In the model's simulations of the rest of the season, " + esc(fav.team) + " finish first " + pc(fav.title) + " of the time."
      : "Nelle simulazioni del resto della stagione " + esc(fav.team) + " arriva prima nel " + pc(fav.title) + " dei casi.");
  }
  const top = ((classifica && classifica.scorers) || [])[0];
  if (top && Number.isFinite(top.goals) && top.goals > 0) {
    out.push(en
      ? "Top scorer: " + esc(top.player) + " (" + esc(top.team) + ") with " + top.goals + " goals."
      : "Il capocannoniere è " + esc(top.player) + " (" + esc(top.team) + ") con " + top.goals + " gol.");
  }
  if (storico && storico.n >= 10 && Number.isFinite(storico.hit)) {
    out.push(en
      ? "So far the model has called the outcome in " + storico.hit + " of " + storico.n + " matches (" + pc(storico.hit / storico.n) + ")."
      : "Finora il modello ha azzeccato l'esito in " + storico.hit + " partite su " + storico.n + " (" + pc(storico.hit / storico.n) + ").");
  }
  return out.length ? '<p class="lead intro">' + out.join(" ") + "</p>" : "";
}

/* ---------- Squadra ---------- */
export function teamIntro(league, team, data, lang = "it") {
  const L = leagueByCode(league), en = lang === "en";
  const turno = data && data.turno, classifica = data && data.classifica;
  const out = [];
  const row = ((classifica && classifica.table) || []).find((r) => r && r.team === team);
  if (row && row.pg > 0) {
    out.push(en
      ? esc(team) + " are " + ordinal(row.pos) + " in the " + esc(L.name) + " with " + row.pts + " points from " + row.pg + " matches: " + row.w + " won, " + row.d + " drawn, " + row.l + " lost, " + row.gf + " scored and " + row.ga + " conceded."
      : esc(team) + " occupa il " + row.pos + "° posto in " + esc(L.name) + " con " + row.pts + " punti in " + row.pg + " partite: " + row.w + (row.w === 1 ? " vittoria, " : " vittorie, ") + row.d + (row.d === 1 ? " pareggio, " : " pareggi, ") + row.l + (row.l === 1 ? " sconfitta" : " sconfitte") + ", " + row.gf + " gol fatti e " + row.ga + " subiti.");
    const st = classifica.stats && classifica.stats[team];
    if (st && st.home && st.away && st.home.pg && st.away.pg) {
      const ph = (3 * st.home.w + st.home.d) / st.home.pg, pa = (3 * st.away.w + st.away.d) / st.away.pg;
      if (Math.abs(ph - pa) >= 0.6) {
        const better = ph > pa;
        out.push(en
          ? "They do much better " + (better ? "at home" : "away") + ": " + d2(Math.max(ph, pa)) + " points per match against " + d2(Math.min(ph, pa)) + (better ? " away" : " at home") + "."
          : "Rende molto meglio " + (better ? "in casa" : "in trasferta") + ": " + d2(Math.max(ph, pa)) + " punti a partita contro " + d2(Math.min(ph, pa)) + (better ? " in trasferta" : " in casa") + ".");
      }
    }
  }
  const all = ((turno && turno.matches) || []).concat(...((turno && turno.next_rounds) || []).map((r) => (r && r.matches) || []));
  const next = all.filter((m) => ok(m) && (m.home === team || m.away === team)).sort((a, b) => String(a.kickoff).localeCompare(String(b.kickoff)))[0];
  if (next) {
    const home = next.home === team, p = home ? next.prob.p1 : next.prob.p2;
    if (next.form) {
      const f = formCount(home ? next.form.home : next.form.away);
      if (f.n >= 3) out.push(en
        ? "In their last " + f.n + " matches: " + f.w + " won, " + f.d + " drawn, " + f.l + " lost."
        : "Nelle ultime " + f.n + " partite: " + f.w + (f.w === 1 ? " vittoria, " : " vittorie, ") + f.d + (f.d === 1 ? " pareggio, " : " pareggi, ") + f.l + (f.l === 1 ? " sconfitta." : " sconfitte."));
    }
    out.push(en
      ? "Next match: " + vs(next) + " (" + esc(dayOf(next)) + "), with " + esc(team) + " given a " + pc(p) + " chance of winning and the draw at " + pc(next.prob.px) + "."
      : "Prossima partita: " + vs(next) + " (" + esc(lower(dayOf(next))) + "), con " + esc(team) + " vincente al " + pc(p) + " e il pareggio al " + pc(next.prob.px) + ".");
  }
  const scorers = ((classifica && classifica.scorers) || []).filter((s) => s && s.team === team && s.goals > 0);
  if (scorers.length) {
    const s = scorers[0];
    out.push(en
      ? "Their top scorer is " + esc(s.player) + " with " + s.goals + (s.goals === 1 ? " goal." : " goals.")
      : "Il suo miglior marcatore è " + esc(s.player) + " con " + s.goals + " gol.");
  }
  const season = classifica && classifica.season;
  const sim = season && Array.isArray(season.teams) ? season.teams.find((x) => x.team === team) : null;
  if (sim && Array.isArray(season.zones)) {
    const z = season.zones.filter((x) => Number.isFinite(sim[x.key])).map((x) => ({ label: zoneLabel(x), p: sim[x.key] })).sort((a, b) => b.p - a.p)[0];
    if (z && z.p >= 0.05) out.push(en
      ? "In the model's season simulations their most likely zone is \"" + esc(z.label) + "\" (" + pc(z.p) + ")."
      : "Nelle simulazioni della stagione la zona più probabile è \"" + esc(z.label) + "\" (" + pc(z.p) + ").");
  }
  return out.length ? '<p class="lead intro">' + out.join(" ") + "</p>" : "";
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
