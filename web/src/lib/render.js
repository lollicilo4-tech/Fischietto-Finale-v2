/* Rendering HTML delle sezioni del sito, ricavato da static/index.html.
   Le funzioni sono pure: ricevono i dati pubblicati (docs/*.json) e un contesto
   { league, favs } e restituiscono stringhe HTML. Le usa Astro durante il build
   (pagine statiche) e il browser nelle isole interattive, così il markup è uno solo.
   Ogni dato inserito nell'HTML passa da esc() o safeUrl(), come nel sito attuale. */
import {
  pc, d1, d2, esc, safeUrl, when, dayOf, shortDay, roundDay, fmtDay, decimalIt, thousandsIt,
  leagueByCode, teamUrl, matchUrl, leagueUrl
} from "./core.js";
import { finalOutcome, homeOutcome, prudentChoice, byStrength, deriveRecommendation, slipReason, marketReliability } from "./model.js";

const favSet = (ctx) => new Set((ctx && ctx.favs) || []);
const isFav = (ctx, name) => favSet(ctx).has(name);
const isFavMatch = (ctx, m) => isFav(ctx, m.home) || isFav(ctx, m.away);
const STAR = '<span class="fav-star" aria-label="Squadra seguita">★</span>';

export function chips(f) {
  return f ? f.split("").map((c) => '<span class="chip ' + esc(c) + '">' + esc(c) + "</span>").join("") : '<span class="abs">nessun dato</span>';
}
export function teamLink(ctx, name) {
  return '<a class="team-link ff-btn" href="' + teamUrl(ctx.league, name) + '" data-team="' + esc(name) + '">' + esc(name) + "</a>";
}

/* ---------- Partite ---------- */
function lastRows(arr, label) {
  if (!arr || !arr.length) return "";
  return '<div class="t">' + esc(label) + "</div>" + arr.map((x) =>
    '<div class="r"><span class="chip ' + esc(x.res) + '">' + esc(x.res) + "</span><span>" + (x.home ? "vs " : "@ ") + esc(x.opp) + "</span><b>" + esc(x.score) + "</b></div>").join("");
}
function results(m) {
  const h = (m.h2h || []).map((x) => {
    const d = x.date.slice(8, 10) + "/" + x.date.slice(5, 7) + "/" + x.date.slice(2, 4);
    return '<div class="r"><small>' + esc(d) + "</small><span>" + esc(x.home) + " – " + esc(x.away) + "</span><b>" + esc(x.score) + "</b></div>";
  }).join("");
  const l = m.last || {};
  const out = lastRows(l.home, "Ultime di " + m.home) + lastRows(l.away, "Ultime di " + m.away) + (h ? '<div class="t">Ultimi scontri diretti</div>' + h : "");
  return out ? '<div class="res">' + out + "</div>" : "";
}

export function whyPanel(m) {
  const e = m.explain;
  if (!e || !e.items || !e.items.length) return "";
  const label = { home: m.home, away: m.away, both: "Partita" };
  const shown = e.items.filter((x) => x.effect !== 0).slice(0, 5);
  return '<div class="why-panel"><h4>Perché il modello dice così</h4><ul>' + shown.map((x) =>
    '<li><span class="why-side ' + esc(x.side) + '">' + esc(label[x.side] || "") + "</span>" + esc(x.text) + "</li>").join("") +
    '</ul><p class="why-sum">' + esc(e.summary) + "</p></div>";
}

function matchCenter(ctx, m, p, a, s, fo, prudent) {
  return '<div class="match-center">' +
    '<div class="mc-kicker"><span>Match Center</span><span class="mc-ai">' + (a.ai && a.sources.length ? "AI + statistiche" : "Solo statistiche") + "</span></div>" +
    '<div class="mc-teams"><div class="mc-team"><small>CASA</small><b>' + teamLink(ctx, m.home) + '</b></div><div class="mc-vs">VS</div><div class="mc-team"><small>TRASFERTA</small><b>' + teamLink(ctx, m.away) + "</b></div></div>" +
    '<div class="mc-probs"><div class="mc-prob ' + (fo[0] === "1" ? "hot" : "") + '"><small>1</small><strong>' + pc(p.p1) + "</strong></div>" +
    '<div class="mc-prob ' + (fo[0] === "X" ? "hot" : "") + '"><small>X</small><strong>' + pc(p.px) + "</strong></div>" +
    '<div class="mc-prob ' + (fo[0] === "2" ? "hot" : "") + '"><small>2</small><strong>' + pc(p.p2) + "</strong></div></div>" +
    '<div class="mc-grid"><div class="mc-stat"><small>Gol attesi</small><b>' + d1(m.xg[0]) + " – " + d1(m.xg[1]) + "</b></div>" +
    '<div class="mc-stat"><small>Affidabilità</small><b>' + esc(m.conf) + '</b></div><div class="mc-stat"><small>Forma casa</small><div class="mc-form">' + chips(m.form && m.form.home) + "</div></div>" +
    '<div class="mc-stat"><small>Forma trasferta</small><div class="mc-form">' + chips(m.form && m.form.away) + "</div></div></div>" +
    '<div class="mc-score"><span>Risultato più probabile</span><b>' + s[0] + "-" + s[1] + "</b><span>" + pc(s[2]) + "</span></div>" +
    '<div class="mc-explain"><b>Perché questo esito</b><p class="expl">' + esc(a.text) + "</p></div>" +
    '<div class="mc-final reference-final-card"><div class="title">✦ Pronostico finale del modello</div><div class="reference-final-grid">' +
    '<div class="reference-final-item"><small>Esito 1X2 più probabile</small><b>' + esc(fo[0] + " · " + fo[1]) + "</b><strong>" + pc(fo[2]) + "</strong></div>" +
    '<div class="reference-final-item"><small>Doppia chance più prudente</small><b>' + esc(prudent[0]) + "</b><strong>" + pc(prudent[1]) + "</strong></div>" +
    '<div class="reference-final-item"><small>Risultato esatto più probabile</small><b>' + esc(s[0] + "-" + s[1]) + "</b><strong>" + pc(s[2]) + "</strong></div></div>" +
    '<p class="reference-final-note">Stima statistica del modello: non è una certezza e non costituisce un invito a scommettere.</p></div></div>';
}

/* Testo condiviso da "Condividi" (WhatsApp, menu del telefono o appunti). */
export function shareText(m) {
  const p = m.prob, s = m.top_scores[0];
  const top = p.p1 >= p.px && p.p1 >= p.p2 ? ["1", m.home, p.p1] : p.px >= p.p2 ? ["X", "pareggio", p.px] : ["2", m.away, p.p2];
  return m.home + " – " + m.away + ": per il modello " + top[0] + " (" + top[1] + ") al " + pc(top[2]) +
    ", risultato più probabile " + s[0] + "-" + s[1] + ". Stime statistiche, non un invito a scommettere.";
}

/* Scheda di una partita. opts.open: aperta (pagina della partita); opts.standalone: senza link a sé stessa. */
export function card(ctx, m, i, opts = {}) {
  const p = m.prob, f = m.fair_odds, a = m.analysis, s = m.top_scores[0], rec = deriveRecommendation(m);
  const fo = finalOutcome(m), prudent = prudentChoice(m);
  const alt = m.top_scores.slice(1).map((x) => x[0] + "-" + x[1]).join(", ");
  const absHome = a.absences_home || [], absAway = a.absences_away || [], nAbs = absHome.length + absAway.length;
  const adjusted = a.adjusted != null ? !!a.adjusted : (Math.abs(a.factor_home - 1) > 0.005 || Math.abs(a.factor_away - 1) > 0.005);
  let abs = "";
  if (nAbs) {
    abs = '<div class="abs-confirmed"><h4>' + (a.ai ? "Assenze confermate dalle fonti" : "Assenze") + "</h4>" +
      (absHome.length ? "<div><b>" + esc(m.home) + ":</b> " + absHome.map(esc).join(", ") + "</div>" : "") +
      (absAway.length ? "<div><b>" + esc(m.away) + ":</b> " + absAway.map(esc).join(", ") + "</div>" : "") +
      (adjusted ? '<div class="s">Gol attesi corretti: ' + [[m.home, a.factor_home, 0], [m.away, a.factor_away, 1]]
        .filter((t) => Math.abs(t[1] - 1) > 0.005)
        .map((t) => esc(t[0]) + " " + d2(m.xg_base[t[2]]) + " → " + d2(m.xg[t[2]])).join(" · ") + "</div>" : "") +
      "</div>";
  }
  const src = a.sources.length ? '<div class="src-status">' + (a.ai && nAbs
    ? "Ogni assenza elencata è confermata dal testo di almeno uno di questi articoli."
    : "Fonti web recuperate automaticamente: la presenza di un link non conferma da sola un’indisponibilità.") +
    '</div><div class="srcs">' + a.sources.filter((x) => safeUrl(x.url)).map((x) =>
      '<a href="' + esc(safeUrl(x.url)) + '" target="_blank" rel="noopener noreferrer">' + esc(x.title) + "</a>").join("") + "</div>" : "";
  const adj = adjusted && !nAbs
    ? '<div class="abs">Correzione sui gol attesi: ' + esc(m.home) + " ×" + d2(a.factor_home) + ", " + esc(m.away) + " ×" + d2(a.factor_away) +
      " (gol attesi di base " + d1(m.xg_base[0]) + " - " + d1(m.xg_base[1]) + ").</div>" : "";
  const adjBadge = adjusted && a.ai
    ? '<div class="adj-line"><span class="adj-badge">Corretto per assenze</span><span>' + nAbs + (nAbs === 1 ? " assenza confermata" : " assenze confermate") + "</span></div>" : "";
  const who = a.ai && a.sources.length ? "Analisi con le ultime notizie" : a.ai ? "Analisi AI senza fonti verificabili" : "Analisi statistica";
  const fav = isFavMatch(ctx, m);
  const pageLink = opts.standalone ? "" : '<a class="share-btn ff-btn" href="' + matchUrl(ctx.league, m) + '">Pagina della partita →</a>';
  return '<details class="match' + (fav ? " fav" : "") + '" id="m-' + esc(m.id) + '" style="--i:' + i + '" data-home="' + esc(m.home) + '" data-away="' + esc(m.away) + '"' +
    (m.kickoff ? ' data-kickoff="' + esc(m.kickoff) + '"' : "") + (opts.open ? " open" : "") + "><summary>" +
    '<div class="mhead"><span>' + (fav ? STAR : "") + esc(when(m)) + '</span><span class="conf ' + esc(m.conf) + '">Affidabilità ' + esc(m.conf) + "</span></div>" +
    '<div class="match-summary-main">' +
    '<div class="match-team"><div class="team-side">Casa</div><div class="team-name">' + esc(m.home) + "</div></div>" +
    '<div class="match-score"><strong>' + s[0] + "-" + s[1] + "</strong>probabile</div>" +
    '<div class="match-team away"><div class="team-side">Trasferta</div><div class="team-name">' + esc(m.away) + "</div></div>" +
    "</div>" +
    '<div class="bar" role="img" aria-label="' + esc(m.home) + " " + pc(p.p1) + ", pareggio " + pc(p.px) + ", " + esc(m.away) + " " + pc(p.p2) + '">' +
    '<i class="h" style="flex:' + p.p1 + '"><small>1</small>' + pc(p.p1) + "</i>" +
    '<i class="d" style="flex:' + p.px + '"><small>X</small>' + pc(p.px) + "</i>" +
    '<i class="a" style="flex:' + p.p2 + '"><small>2</small>' + pc(p.p2) + "</i></div>" +
    adjBadge +
    '<div class="match-pick"><span class="pick-pill">Modello</span><span class="value">' + esc(fo[0] + " · " + fo[1]) + " <b>" + pc(fo[2]) + "</b></span></div></summary>" +
    '<div class="detail">' + matchCenter(ctx, m, p, a, s, fo, prudent) +
    '<div class="match-actions"><button type="button" class="share-btn" data-share="' + esc(m.id) + '" data-share-text="' + esc(shareText(m)) + '" data-share-url="' + esc(matchUrl(ctx.league, m)) + '">↗ Condividi</button>' + pageLink + "</div>" +
    whyPanel(m) +
    '<div><div class="who">' + who + '</div><p class="expl">' + esc(a.text) + "</p></div>" +
    abs + adj + (a.ai && !a.sources.length ? '<div class="src-status">Analisi AI eseguita, ma nessuna fonte pertinente è stata verificata per questa partita. I fattori restano neutrali.</div>' : "") + src +
    '<div class="final-prediction" aria-label="Pronostico finale del modello">' +
    '<div class="title">Pronostico finale del modello</div>' +
    '<div class="main-outcome"><span class="outcome">' + esc(rec.best.label) + '</span><span class="prob">' + pc(rec.best.p) + "</span></div>" +
    '<div class="rows">' +
    (rec.best.base != null ? '<div class="row"><span>Media del campionato per questo mercato</span><b class="num">' + pc(rec.best.base) + " · " + (rec.best.edge >= 0 ? "+" : "") + Math.round(rec.best.edge * 100) + " punti</b></div>" : "") +
    '<div class="row"><span>Alternativa più prudente</span><b>' + esc(prudent[0]) + ' · <span class="num">' + pc(prudent[1]) + "</span></b></div>" +
    '<div class="row"><span>Altri mercati forti</span><b class="num">' + rec.alternatives.slice(1, 3).map((x) => esc(x.label) + " · " + pc(x.p)).join(" · ") + "</b></div>" +
    '<div class="row"><span>Risultato esatto più probabile</span><b class="num">' + esc(s[0] + "-" + s[1]) + " · " + pc(s[2]) + "</b></div>" +
    "</div>" +
    '<p class="note">Stima statistica del modello: non è una certezza e non costituisce un invito a scommettere.</p>' +
    "</div>" +
    '<div class="grid">' +
    '<div class="stat wide"><div class="k">Quote eque 1 · X · 2</div><div class="v num">' + d2(f.p1) + " · " + d2(f.px) + " · " + d2(f.p2) + "</div></div>" +
    '<div class="stat"><div class="k">Risultato probabile</div><div class="v">' + s[0] + "-" + s[1] + '</div><div class="s">' + pc(s[2]) + " · poi " + alt + "</div></div>" +
    '<div class="stat"><div class="k">Gol attesi</div><div class="v">' + d1(m.xg[0]) + " - " + d1(m.xg[1]) + '</div><div class="s">totale ' + d1(m.xg[0] + m.xg[1]) + "</div></div>" +
    '<div class="stat"><div class="k">Over 2,5</div><div class="v">' + pc(p.o25) + '</div><div class="s">quota equa ' + d2(f.o25) + " · Under " + pc(p.u25) + "</div></div>" +
    '<div class="stat"><div class="k">Segnano entrambe</div><div class="v">' + pc(p.gg) + '</div><div class="s">quota equa ' + d2(f.gg) + " · No " + pc(p.ng) + "</div></div>" +
    "</div>" +
    results(m) +
    "</div></details>";
}

export function grouped(ctx, list) {
  let html = "", last = null, i = 0;
  list.forEach((m) => {
    const g = dayOf(m);
    if (g !== last) { html += '<h3 class="day">' + esc(g) + "</h3>"; last = g; }
    html += card(ctx, m, i++);
  });
  return html;
}

/* Dati minimi per la striscia "Le tue squadre", costruita nel browser dai preferiti salvati sul telefono. */
export const favStripData = (matches) => matches.map((m) => ({
  id: String(m.id), home: m.home, away: m.away,
  info: dayOf(m) + " " + when(m) + " · 1 " + pc(m.prob.p1) + " · X " + pc(m.prob.px) + " · 2 " + pc(m.prob.p2)
}));
export function favStripHtml(items, favs) {
  const set = new Set(favs || []), list = items.filter((m) => set.has(m.home) || set.has(m.away));
  return list.length ? '<div class="fav-strip"><h2>Le tue squadre</h2>' + list.map((m) =>
    '<a class="ff-btn" href="#m-' + esc(m.id) + '" data-goto-match="' + esc(m.id) + '"><span>' + esc(m.home) + " – " + esc(m.away) + "</span><small>" + esc(m.info) + "</small></a>").join("") + "</div>" : "";
}

/* Partite già giocate: pronostico fatto prima, risultato vero, esito. */
export function played(x) {
  const p = x.prob, v = [];
  v.push('<span class="' + (x.ok ? "y" : "n") + '">' + (x.ok ? "✓ Esito azzeccato" : "✕ Esito sbagliato") + " (" + esc(x.pick) + " al " + pc(x.pick_p) + ")</span>");
  if (x.ou) v.push('<span class="' + (x.ou.ok ? "y" : "n") + '">' + (x.ou.ok ? "✓" : "✕") + " Over/Under 2,5</span>");
  if (x.gg) v.push('<span class="' + (x.gg.ok ? "y" : "n") + '">' + (x.gg.ok ? "✓" : "✕") + " Gol/No Gol</span>");
  const top = x.top ? "<span>Risultato previsto " + x.top[0] + "-" + x.top[1] + "</span>" : "";
  return '<div class="played"><div class="mhead"><span>' + esc(shortDay(x.kickoff)) + "</span><span>Finita</span></div>" +
    '<div class="final"><div class="nm">' + esc(x.home) + '</div><div class="score">' + esc(x.hg) + "-" + esc(x.ag) + '</div><div class="nm r">' + esc(x.away) + "</div></div>" +
    '<div class="bar" role="img" aria-label="Pronostico: ' + pc(p.p1) + " " + pc(p.px) + " " + pc(p.p2) + '">' +
    '<i class="h" style="flex:' + p.p1 + '"><small>1</small>' + pc(p.p1) + "</i>" +
    '<i class="d" style="flex:' + p.px + '"><small>X</small>' + pc(p.px) + "</i>" +
    '<i class="a" style="flex:' + p.p2 + '"><small>2</small>' + pc(p.p2) + "</i></div>" +
    '<div class="verdict">' + v.join("") + top + "</div></div>";
}
export function playedSection(list) {
  if (!list || !list.length) return "";
  const hits = list.filter((x) => x.ok).length;
  return '<h2 class="sub2">Già giocate</h2><p class="lead">Ultime ' + list.length + " partite pronosticate: esito azzeccato " + hits + " volte su " + list.length +
    '.</p><div class="list">' + list.map(played).join("") + "</div>";
}

/* Il pronostico più netto del turno, in cima a Partite. */
export function hero(m) {
  if (!m) return "";
  const p = m.prob, s = m.top_scores[0], rec = deriveRecommendation(m);
  return '<div class="hero" style="--i:0"><span class="badge">Pronostico più netto del turno</span>' +
    '<div class="vs"><div class="side l"><div class="nm">' + esc(m.home) + '</div><div class="big">' + pc(p.p1) + "</div></div>" +
    '<div class="mid"><div class="label">X</div><div class="big">' + pc(p.px) + "</div></div>" +
    '<div class="side r"><div class="nm">' + esc(m.away) + '</div><div class="big">' + pc(p.p2) + "</div></div></div>" +
    '<div class="meta"><span>Risultato probabile <b class="num">' + s[0] + "-" + s[1] + "</b></span>" +
    "<span>Pronostico del modello <b>" + esc(rec.best.label) + " · " + pc(rec.best.p) + "</b></span></div>" +
    '<a class="cta ff-btn" href="#m-' + esc(m.id) + '" data-open="m-' + esc(m.id) + '">Apri l\'analisi</a></div>';
}

/* Home: partita del giorno, numeri del turno e previsioni più forti. */
export function homeDashboard(ctx, matches) {
  const ranked = byStrength(matches);
  if (!ranked.length) return null;
  const m = ranked[0], p = m.prob, s = m.top_scores[0], rec = deriveRecommendation(m), fo = homeOutcome(m);
  const open = (x) => leagueUrl(ctx.league, "partite") + "#m-" + encodeURIComponent(x.id);
  const feature = '<div class="feature-card"><div class="feature-top"><span class="badge">' + esc(rec.best.label) + " " + pc(rec.best.p) + '</span><span class="conf ' + esc(m.conf) + '">Affidabilità ' + esc(m.conf) +
    '</span></div><div class="feature-match"><div class="feature-team"><small>Casa</small><b>' + esc(m.home) + '</b></div><div class="feature-vs">VS</div><div class="feature-team r"><small>Trasferta</small><b>' + esc(m.away) +
    '</b></div></div><div class="feature-prob"><span class="' + (fo[0] === "1" ? "hot" : "") + '"><b>1</b>' + pc(p.p1) + '</span><span class="' + (fo[0] === "X" ? "hot" : "") + '"><b>X</b>' + pc(p.px) +
    '</span><span class="' + (fo[0] === "2" ? "hot" : "") + '"><b>2</b>' + pc(p.p2) + '</span></div><div class="feature-bottom"><div class="feature-score"><small>Risultato più probabile</small>' + s[0] + "-" + s[1] +
    '</div><a class="feature-open ff-btn" href="' + esc(open(m)) + '">Vedi analisi →</a></div></div>';
  const n = matches.length, avg = matches.reduce((x, y) => x + Math.max(y.prob.p1, y.prob.px, y.prob.p2), 0) / n;
  const quick = '<div class="quick-card"><div class="q-label">Partite</div><div class="q-value">' + n + '</div><div class="q-note">analizzate dal modello</div></div>' +
    '<div class="quick-card"><div class="q-label">Forza media</div><div class="q-value">' + pc(avg) + '</div><div class="q-note">esito principale medio</div></div>';
  const strong = ranked.slice(0, 4).map((x) => {
    const f = homeOutcome(x), sc = x.top_scores[0][0] + "-" + x.top_scores[0][1];
    return '<a class="home-row ff-btn" href="' + esc(open(x)) + '"><span class="hr-p">' + pc(f[2]) + "<small>" + esc(f[0] + " · " + f[1]) + '</small></span><span class="hr-teams">' + esc(x.home) + " — " + esc(x.away) +
      "<small>" + esc(x.conf) + " · " + esc(sc) + ' probabile</small></span><span class="hr-score">' + esc(sc) + "</span></a>";
  }).join("");
  return { feature, quick, strong };
}

/* ---------- Prossime giornate ---------- */
function roundRows(ctx, list, team) {
  return list.map((m) => {
    const p = m.prob;
    const mark = (n) => (team && n === team) || (!team && isFav(ctx, n)) ? "<b>" + esc(n) + "</b>" : esc(n);
    return '<div class="nr-row"><span class="nr-teams">' + mark(m.home) + " – " + mark(m.away) + "<small>" + esc(roundDay(m.kickoff)) +
      " · probabile " + esc(m.top[0] + "-" + m.top[1]) + '</small></span><span class="nr-p"><i>1 ' + pc(p.p1) + "</i><i>X " + pc(p.px) + "</i><i>2 " + pc(p.p2) + "</i></span></div>";
  }).join("");
}
export function nextRoundsPanel(ctx, rounds) {
  if (!rounds || !rounds.length) return "";
  return '<h2 class="sub2">Prossime giornate</h2><p class="lead">Solo modello statistico: le notizie su infortuni e squalifiche arrivano nelle 48 ore prima di ogni partita. Le probabilità cambiano dopo ogni turno.</p>' +
    rounds.map((r) => '<div class="panel nr-panel"><h3>Giornata ' + esc(r.matchday) + "</h3>" + roundRows(ctx, r.matches) + "</div>").join("");
}

/* ---------- Più sicure ---------- */
export function comboHtml(picks, n) {
  const sel = picks.slice(0, n), prod = sel.reduce((s, x) => s * x.p, 1), strongest = sel[0];
  if (!strongest) return { combo: '<div class="msg">Nessuna selezione disponibile.</div>', decay: "" };
  const combo = '<div class="pick-hero"><div class="ph-top"><span class="ph-label">TOP PICK</span><span class="ph-prob">' + pc(strongest.p) + '</span></div><div class="ph-match">' + esc(strongest.m) +
    '</div><div class="ph-bet">Esito più probabile: <b>' + esc(strongest.label) + '</b> · modello statistico</div><div class="ph-bar"><div class="ph-fill" style="--p:' + Math.round(strongest.p * 100) + '%"></div></div></div>' +
    '<div class="sure-head"><h2>Top picks</h2><small>ordinate per probabilità</small></div><div class="pick-list">' +
    sel.map((x, i) => '<div class="pick-item"><div class="pick-rank">#' + (i + 1) + "<b>" + (i === 0 ? "TOP" : "") + '</b></div><div class="pick-main"><div class="pm-match">' + esc(x.m) +
      '</div><div class="pm-type">' + esc(x.label) + " · " + esc(x.code) + '</div></div><div class="pick-pct">' + pc(x.p) + "<small>probabilità</small></div></div>").join("") +
    '</div><div class="pick-meta"><span class="risk">✓ selezioni ordinate dal modello</span><span>' + n + " selezioni</span><span>probabilità combinata " + pc(prod) + "</span></div>" +
    '<p class="sure-note">Queste sono probabilità statistiche, non garanzie. La probabilità combinata è il prodotto delle singole probabilità e tende a diminuire rapidamente aggiungendo selezioni.</p>';
  let cum = 1;
  const decay = picks.slice(0, 5).map((x, i) => {
    cum *= x.p;
    return '<div class="' + (i + 1 === n ? "on" : "") + '"><span>' + (i + 1) + (i ? " selezioni" : " selezione") + '</span><span class="track"><span class="fill" style="width:' + Math.round(cum * 100) + '%"></span></span><span class="val">' + pc(cum) + "</span></div>";
  }).join("");
  return { combo, decay };
}

/* ---------- Schedina del modello ---------- */
const SLIP_NAME = { sicura: "SICURA", media: "MEDIA", bomba: "BOMBA" };
const SLIP_DESC = {
  sicura: "Parte dal miglior pronostico multi-mercato del modello e privilegia le selezioni più solide.",
  media: "Combina le migliori raccomandazioni del modello tra esiti, gol e combo, cercando un equilibrio.",
  bomba: "Cerca selezioni più spinte tra combo, mercati gol e, quando disponibile, il risultato esatto più probabile."
};
const KIND_NAME = { base: "Esito", esito: "Esito", doppia: "Doppia chance", gol: "Gol", combo: "Combo", score: "Risultato esatto" };
export function slipHtml(picks, mode, matches, marketPerformance = {}, backtestMarkets = {}) {
  const prod = picks.reduce((v, x) => v * x.p, 1), name = SLIP_NAME[mode];
  const aiOn = matches.some((x) => x.analysis && x.analysis.ai);
  const reliability = (x) => {
    const r = marketReliability(x, marketPerformance, backtestMarkets);
    return r.score == null ? "Affidabilità: dati insufficienti" : "Affidabilità: " + r.score + "/100 · " + r.n + " osservazioni" + (r.source === "mercato" ? " · mercato" : " · categoria");
  };
  return '<div class="slip-hero"><div class="slip-kicker">Schedina automatica · ' + name + '</div><div class="slip-title">' + name + '</div><div class="slip-sub">' + SLIP_DESC[mode] +
    '</div><div class="slip-meta"><span>' + picks.length + " selezioni</span><span>Prob. comb. teorica " + pc(prod) + "</span><span>" + (aiOn ? "AI + statistica" : "Solo statistica") + "</span></div></div>" +
    '<div class="slip-list">' + picks.map((x, i) => '<div class="slip-item"><div class="slip-num">0' + (i + 1) + '</div><div><div class="slip-match">' + esc(x.m) + '</div><div class="slip-market">' +
      esc(KIND_NAME[x.kind] + " · " + x.label) + (x.recommended ? " <b>· TOP MODELLO</b>" : "") + '</div><div class="slip-reason">' + esc(slipReason(x)) + '</div><div class="slip-reliability">' + reliability(x) +
      '</div></div><div class="slip-prob">' + pc(x.p) + "<small>stima</small></div></div>").join("") + "</div>" +
    '<div class="slip-foot"><div class="slip-combo">' + pc(prod) + '<small>probabilità combinata teorica</small></div><div class="slip-note">Le selezioni derivano dalle probabilità del modello e dalle sue raccomandazioni multi-mercato. Stima statistica: non è una certezza e non costituisce un invito a scommettere.</div></div>';
}

/* ---------- Classifica e fine stagione ---------- */
export function tableHtml(ctx, classifica) {
  const t = (classifica && classifica.table) || [];
  if (!t.length) return '<div class="msg">Classifica non disponibile.</div>';
  const n = t.length;
  return '<table class="table"><thead><tr><th>#</th><th>Squadra</th><th>PG</th><th class="hide-s">V</th><th class="hide-s">N</th><th class="hide-s">P</th><th>DR</th><th>Pt</th></tr></thead><tbody>' +
    t.map((r) => {
      const dr = r.gf - r.ga, cls = r.pos <= 4 ? "ucl" : (n >= 18 && r.pos > n - 3) ? "rel" : "";
      return '<tr class="' + cls + '" data-team-row="' + esc(r.team) + '"><td>' + r.pos + "</td><td>" + (isFav(ctx, r.team) ? STAR : "") + teamLink(ctx, r.team) + "</td><td>" + r.pg + '</td><td class="hide-s">' + r.w +
        '</td><td class="hide-s">' + r.d + '</td><td class="hide-s">' + r.l + "</td><td>" + (dr > 0 ? "+" : "") + dr + "</td><td>" + r.pts + "</td></tr>";
    }).join("") + "</tbody></table>";
}
export function seasonPct(v) { return v == null ? "–" : v === 0 ? "0%" : v < 0.005 ? "&lt;1%" : (v > 0.995 && v < 1) ? "&gt;99%" : pc(v); }
export function seasonPanel(ctx, se) {
  if (!se || !se.teams || !se.teams.length || !se.zones || !se.zones.length) return "";
  if (!se.remaining) {
    const cup = se.zones.some((z) => z.key === "top8");
    return '<div class="panel season-panel"><h2>' + (cup ? "Fase a girone unico conclusa" : "Stagione conclusa") + '</h2><p class="expl">' +
      (cup ? "La classifica della fase a girone unico è definitiva." : "Non restano partite di campionato da giocare.") + "</p></div>";
  }
  return '<div class="panel season-panel"><h2>Come può finire la stagione</h2><p class="lead" style="margin:0 0 10px">Il modello ha giocato ' +
    thousandsIt(se.n_sim) + " volte le " + esc(se.remaining) + " partite che restano, partendo dalla classifica di oggi. A parità di punti contano " +
    esc(se.tiebreak || "differenza reti e gol fatti") + " (non gli scontri diretti). Sono probabilità, non certezze.</p>" +
    '<table class="season-table"><thead><tr><th>Squadra</th><th>Pos. media</th>' +
    se.zones.map((z) => "<th>" + esc(z.label) + "</th>").join("") + "</tr></thead><tbody>" +
    se.teams.map((r) => '<tr data-team-row="' + esc(r.team) + '"><td>' + (isFav(ctx, r.team) ? STAR : "") + teamLink(ctx, r.team) + "</td><td>" + decimalIt(r.pos_avg) + "</td>" +
      se.zones.map((z) => { const v = r[z.key] || 0; return '<td class="pct"><i style="width:' + Math.round(v * 100) + '%"></i><span>' + seasonPct(r[z.key]) + "</span></td>"; }).join("") + "</tr>").join("") +
    "</tbody></table></div>";
}

/* ---------- Storico ---------- */
export function recapPanel(r) {
  if (!r || !r.n) return "";
  const range = r.from === r.to ? fmtDay(r.from) : fmtDay(r.from) + " – " + fmtDay(r.to);
  const rows = (list, right) => '<div class="team-list">' + list.map((x) => "<div><span>" + esc(x.match) + " · " + esc(x.score) + "</span><b>" + right(x) + "</b></div>").join("") + "</div>";
  return '<div class="panel recap-panel"><h2>Com’è andata l’ultima giornata</h2><p class="expl">' + esc(range) + " · esito azzeccato <b>" + r.hit + " su " + r.n + "</b> (" + pc(r.rate) + ")" +
    (r.exact ? " · risultato esatto indovinato " + r.exact + (r.exact === 1 ? " volta" : " volte") : "") + "</p>" +
    (r.surprises && r.surprises.length ? '<h3 class="sub2" style="font-size:16px;margin:12px 0 6px">Le sorprese</h3>' + rows(r.surprises, (x) => "esito dato al " + pc(x.p_actual)) : "") +
    (r.best && r.best.length ? '<h3 class="sub2" style="font-size:16px;margin:12px 0 6px">Le previsioni migliori</h3>' + rows(r.best, (x) => esc(x.pick) + " al " + pc(x.pick_p) + " ✓") : "") +
    "</div>";
}
function verdictPanel(h) {
  const n = h.n || 0;
  if (!n) return "";
  const rate = h.hit / n, br = h.base_rates || {};
  const top = ["1", "X", "2"].reduce((a, k) => ((br[k] || 0) > (br[a] || 0) ? k : a), "1");
  const names = { 1: "la vittoria della squadra di casa", X: "il pareggio", 2: "la vittoria della squadra in trasferta" };
  let first = "Su " + n + " partite il modello ha indovinato l’esito (1, X o 2) nel " + pc(rate) + " dei casi.";
  if (br[top] != null) first += " Scegliendo sempre " + names[top] + " si indovinerebbe circa il " + pc(br[top]) + ".";
  let second = "";
  if (h.brier != null && h.brier_base) {
    const d = 1 - h.brier / h.brier_base;
    second = d > 0.005 ? " Le sue percentuali sbagliano il " + Math.round(d * 100) + "% in meno di quelle ricavate dalle sole medie del campionato."
      : d < -0.005 ? " Per ora le sue percentuali non fanno meglio delle sole medie del campionato."
        : " Per ora le sue percentuali valgono quanto le sole medie del campionato.";
  }
  const caveat = n < 30 ? "Con meno di 30 partite è solo un primo assaggio: i numeri possono cambiare molto."
    : n < 100 ? "Con " + n + " partite il quadro è indicativo; diventa solido verso le 100."
      : "Il campione è abbastanza ampio per fidarsi del confronto.";
  return '<div class="verdict"><h2>In breve</h2><p>' + esc(first + second) + "</p><p>" + esc(caveat) + "</p></div>";
}
/* Calibrazione come grafico: ogni punto è una fascia di probabilità; sulla diagonale è perfetta. */
function calChart(cal) {
  if (!cal || !cal.length) return "";
  const W = 320, H = 230, L = 42, R = 14, T = 12, B = 38, lo = 0.3, hi = 1;
  const x = (v) => L + (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo) * (W - L - R);
  const y = (v) => H - B - Math.max(0, Math.min(1, v)) * (H - T - B);
  let g = '<line class="axis" x1="' + L + '" y1="' + (H - B) + '" x2="' + (W - R) + '" y2="' + (H - B) + '"/>' +
    '<line class="axis" x1="' + L + '" y1="' + T + '" x2="' + L + '" y2="' + (H - B) + '"/>' +
    '<line class="ideal" x1="' + x(lo) + '" y1="' + y(lo) + '" x2="' + x(hi) + '" y2="' + y(hi) + '"/>';
  [0.4, 0.6, 0.8, 1].forEach((v) => { g += '<text x="' + x(v) + '" y="' + (H - B + 14) + '" text-anchor="middle">' + Math.round(v * 100) + "%</text>"; });
  [0, 0.5, 1].forEach((v) => { g += '<text x="' + (L - 6) + '" y="' + (y(v) + 3) + '" text-anchor="end">' + Math.round(v * 100) + "%</text>"; });
  g += '<text x="' + ((L + W - R) / 2) + '" y="' + (H - 4) + '" text-anchor="middle">Probabilità dichiarata</text>';
  g += '<text x="12" y="' + ((T + H - B) / 2) + '" text-anchor="middle" transform="rotate(-90 12 ' + ((T + H - B) / 2) + ')">Successi reali</text>';
  cal.forEach((b) => {
    const r = 4 + Math.min(7, Math.sqrt(b.n || 1));
    g += '<circle class="dot" cx="' + x(b.avg_p) + '" cy="' + y(b.hit) + '" r="' + r.toFixed(1) + '"><title>' + esc(b.label) + ": detto " + pc(b.avg_p) + ", reale " + pc(b.hit) + " su " + esc(b.n) + " partite</title></circle>";
    g += '<text class="lbl" x="' + (x(b.avg_p) + r + 3) + '" y="' + (y(b.hit) + 3) + '">' + esc(b.n) + "</text>";
  });
  return '<div class="cal-chart"><svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Calibrazione: probabilità dichiarate contro successi reali">' + g + "</svg></div>";
}
function modelReliability(h) {
  const n = h.n || 0, rate = n ? h.hit / n : 0, brier = h.brier, cal = h.calibration || [];
  if (n < 30 || brier == null) return null;
  const gap = cal.length ? cal.reduce((a, x) => a + Math.abs((x.hit || 0) - (x.avg_p || 0)) * x.n, 0) / n : Math.abs(rate - (h.avg_p || 0));
  const calibrationScore = Math.max(0, 100 - gap * 300);
  const brierScore = Math.max(0, 100 - Math.min(1, brier) * 100);
  const recent = h.performance || {}, recentScore = recent.recent_n ? recent.recent_rate * 100 : rate * 100;
  const score = Math.round(calibrationScore * 0.35 + brierScore * 0.35 + recentScore * 0.3);
  return { score: Math.max(0, Math.min(100, score)), rate, calibration: calibrationScore, brier: brierScore, recent: recentScore, n };
}
function modelTrendSvg(h) {
  const items = (h.items || []).slice(0, 20).reverse();
  if (items.length < 2) return '<p style="margin:0">Servono almeno 2 risultati.</p>';
  const W = 320, H = 110, L = 8, R = 8, T = 8, B = 22, w = W - L - R, hg = H - T - B;
  const pts = items.map((x, i) => ({ x: L + (i / (items.length - 1)) * w, y: T + (x.ok ? 0.18 : 0.82) * hg }));
  const line = '<polyline points="' + pts.map((p) => p.x + "," + p.y).join(" ") + '" fill="none" stroke="#4da7ff" stroke-width="2.5"/>';
  const dots = pts.map((p) => '<circle cx="' + p.x + '" cy="' + p.y + '" r="3.5" fill="' + (p.y < T + hg / 2 ? "#72e2bb" : "#ff7a6b") + '"/>').join("");
  return '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Andamento degli ultimi pronostici">' + line + dots + '<text x="8" y="' + (H - 5) +
    '" class="market-cal-label">meno recente</text><text x="' + (W - 8) + '" y="' + (H - 5) + '" text-anchor="end" class="market-cal-label">più recente</text></svg>';
}
function modelScorePanel(h) {
  const r = modelReliability(h);
  if (!r) return '<div class="model-score"><div class="model-score-kicker">Affidabilità del modello</div><div class="model-score-label">Campione in costruzione</div><p style="margin-top:5px;color:#8ea5bd;font-size:11px">Servono risultati reali per calcolare un punteggio affidabile. Nessun correttivo viene applicato.</p></div>';
  const label = r.score >= 75 ? "Modello affidabile" : r.score >= 55 ? "Modello da monitorare" : "Modello in osservazione";
  const trend = (h.performance && h.performance.recent_rate != null) ? h.performance.recent_rate - (h.performance.overall_rate || r.rate) : 0;
  return '<div class="model-score"><div class="model-score-head"><div><div class="model-score-kicker">Affidabilità globale · ' + r.n + ' partite</div><div class="model-score-label">' + label +
    '</div></div><div class="model-score-number">' + r.score + '/100</div></div><div class="model-score-track"><span style="width:' + r.score + '%"></span></div><div class="model-score-grid">' +
    '<div class="model-score-mini"><b>' + pc(r.rate) + "</b><span>Precisione 1X2</span></div>" +
    '<div class="model-score-mini"><b>' + Math.round(r.calibration) + "/100</b><span>Calibrazione</span></div>" +
    '<div class="model-score-mini"><b>' + Math.round(r.brier) + "/100</b><span>Qualità Brier</span></div></div>" +
    '<div class="model-trend"><h3>Forma recente</h3><p>' + ((trend > 0.04) ? "Le ultime partite sono sopra la media storica." : (trend < -0.04) ? "Le ultime partite sono sotto la media storica." : "Le ultime partite sono in linea con la media.") +
    "</p>" + modelTrendSvg(h) + "</div></div>";
}
function backtestPanel(h) {
  const b = h.backtest;
  if (!b || !b.n) return '<div class="backtest"><div class="backtest-head"><h3>Laboratorio · retrospettiva</h3><span>in attesa</span></div><p class="backtest-note">Servono pronostici storici salvati prima delle partite per confrontare il modello su finestre consecutive.</p></div>';
  const labels = [["10", "Ultime 10"], ["25", "Ultime 25"], ["50", "Ultime 50"]];
  const cards = labels.map((x) => {
    const v = b.windows[x[0]], rate = v.rate == null ? 0 : v.rate;
    return '<div class="bt-card"><b>' + (v.rate == null ? "—" : pc(v.rate)) + "</b><small>" + x[1] + " · " + v.n + " partite" + (v.available ? "" : " · campione incompleto") +
      '</small><div class="bt-bar"><span style="width:' + Math.round(rate * 100) + '%"></span></div><small>Brier ' + (v.brier == null ? "—" : d2(v.brier)) + "</small></div>";
  }).join("");
  const markets = Object.keys(b.markets || {}).map((k) => [k, b.markets[k]]).sort((a, c) => (c[1].n || 0) - (a[1].n || 0)).slice(0, 10);
  const rows = markets.map((x) => { const v = x[1]; return '<div class="bt-market-row"><b>' + esc(x[0]) + "</b><span>" + v.hit + "/" + v.n + "</span><span>" + pc(v.rate) + "</span><span>gap " + (v.gap >= 0 ? "+" : "") + pc(v.gap) + "</span></div>"; }).join("");
  return '<div class="backtest"><div class="backtest-head"><h3>Laboratorio · retrospettiva</h3><span>' + b.n + ' pronostici</span></div><p class="backtest-note">Confronto sui pronostici effettivamente salvati prima dell\'esito. Non vengono ricostruite previsioni a posteriori.</p><div class="bt-grid">' +
    cards + "</div>" + (rows ? '<div class="bt-market"><div class="bt-market-row"><b>Mercato</b><span>Hit</span><span>Reale</span><span>Gap</span></div>' + rows + "</div>" : "") + "</div>";
}
function marketPerformancePanel(h) {
  const mp = h.market_performance || {}, order = ["1X2", "Gol", "Over/Under", "Combo", "Risultato esatto"];
  const entries = order.filter((k) => mp[k]);
  if (!entries.length) return '<div class="panel" style="margin-top:14px"><h2>Affidabilità per mercato</h2><p class="expl">Stiamo ancora raccogliendo risultati reali: nessun correttivo viene applicato alla Schedina.</p></div>';
  const reliability = (v) => { if (!v.ready || (v.matches || 0) < 30) return null; const cal = 1 - Math.min(1, Math.abs(v.calibration_gap || 0)); const bri = 1 - Math.min(1, Math.max(0, v.brier || 0)); return Math.round((cal * 0.7 + bri * 0.3) * 100); };
  const cards = entries.map((k) => {
    const v = mp[k], score = reliability(v), pct = score == null ? 0 : score;
    return '<div class="market-perf-card ' + (score == null ? "warn" : "") + '"><div class="market-perf-top"><span class="market-perf-name">' + esc(k) + '</span><span class="market-perf-score">' + (score == null ? "—" : score + "/100") +
      '</span></div><div class="market-perf-track"><span style="width:' + pct + '%"></span></div><div class="market-perf-meta"><span>' + v.hit + " su " + v.n + " selezioni · " + (v.matches == null ? "—" : v.matches) +
      " partite</span><span>prev. " + pc(v.avg_p) + "</span><span>reale " + pc(v.rate) + "</span></div></div>";
  }).join("");
  const readyKeys = entries.filter((k) => mp[k].ready && (mp[k].matches || 0) >= 30), ready = readyKeys.length;
  const W = 320, H = 190, L = 34, R = 14, T = 16, B = 30, innerW = W - L - R, innerH = H - T - B;
  const points = readyKeys.map((k) => { const v = mp[k]; return { x: L + Math.max(0, Math.min(1, v.avg_p)) * innerW, y: T + (1 - Math.max(0, Math.min(1, v.rate))) * innerH, k }; });
  const grid = [0, 0.25, 0.5, 0.75, 1].map((v) => {
    const x = L + v * innerW, y = T + (1 - v) * innerH;
    return '<line x1="' + x + '" y1="' + T + '" x2="' + x + '" y2="' + (T + innerH) + '" stroke="rgba(255,255,255,.07)"/><line x1="' + L + '" y1="' + y + '" x2="' + (L + innerW) + '" y2="' + y +
      '" stroke="rgba(255,255,255,.07)"/><text x="' + x + '" y="' + (H - 8) + '" text-anchor="middle" class="market-cal-label">' + Math.round(v * 100) + '%</text><text x="' + (L - 7) + '" y="' + (y + 3) +
      '" text-anchor="end" class="market-cal-label">' + Math.round(v * 100) + "%</text>";
  }).join("");
  const curve = points.length > 1 ? '<polyline points="' + points.map((p) => p.x + "," + p.y).join(" ") + '" fill="none" stroke="#72e2bb" stroke-width="2.5"/>' : "";
  const dots = points.map((p) => '<circle class="market-cal-dot" cx="' + p.x + '" cy="' + p.y + '" r="4"/><text x="' + p.x + '" y="' + (p.y - 8) + '" text-anchor="middle" class="market-cal-label">' + esc(p.k) + "</text>").join("");
  const diag = '<line x1="' + L + '" y1="' + (T + innerH) + '" x2="' + (L + innerW) + '" y2="' + T + '" stroke="rgba(255,255,255,.22)" stroke-dasharray="4 4"/>';
  const chart = ready ? '<div class="market-cal-chart"><h3>Curva predetto · reale</h3><p>Ogni punto confronta la probabilità media dichiarata con la frequenza reale. La diagonale tratteggiata indica una calibrazione perfetta.</p><svg viewBox="0 0 ' + W + " " + H +
    '" role="img" aria-label="Curva di calibrazione del modello">' + grid + diag + curve + dots + "</svg></div>" : "";
  return '<div class="panel" style="margin-top:14px"><h2>Affidabilità per mercato</h2><p class="expl">Indicatore 0–100 costruito da calibrazione e Brier score. È un indicatore descrittivo, non una garanzia di rendimento. La Schedina usa lo storico solo quando ci sono almeno 10 osservazioni per categoria.</p><div class="market-perf-grid">' +
    cards + "</div>" + chart + '<div class="panel" style="margin-top:12px;padding:12px"><p class="lead" style="margin:0">' +
    (ready ? "Calibrazione storica attiva per " + ready + " categorie." : "Campione ancora insufficiente: il sistema continua a raccogliere dati senza modificare le probabilità del modello.") + "</p></div></div>";
}

/* Tutte le parti della pagina Storico: { lead, verdict, recap, hero, sum, quality, hist }. */
export function storicoParts(h) {
  const out = { lead: "Ogni pronostico viene salvato prima della partita e confrontato con il risultato.", verdict: "", recap: "", hero: "", sum: "", quality: "", hist: "" };
  if (!h) return out;
  if (h.demo) out.lead = "Esempio dimostrativo. Con i dati reali qui compaiono i pronostici salvati prima di ogni partita e confrontati con il risultato.";
  if (!h.n) {
    out.hero = '<div class="hist-kicker">Performance del modello</div><div style="margin-top:8px;font-family:var(--font-display);font-size:30px;font-weight:800">Nessun dato ancora</div><p class="hist-caption">Quando saranno disponibili risultati reali, qui vedrai precisione, andamento e qualità delle probabilità.</p>';
    out.sum = '<div class="stat wide"><div class="k">Ancora vuoto</div><div class="s">Appena si giocano le partite pronosticate, compare il confronto.</div></div>';
    return out;
  }
  out.verdict = verdictPanel(h);
  out.recap = recapPanel(h.recap);
  const histRate = h.hit / h.n, recent = (h.items || []).slice(0, 12);
  const bars = recent.map((x) => '<i class="' + (x.ok ? "y" : "n") + '" style="height:' + (x.ok ? 78 : 34) + '%"><span>' + (x.ok ? "✓" : "✕") + "</span></i>").join("");
  const perf = h.performance || {};
  const perfLabel = perf.label || (h.n < 30 ? "Campione in costruzione" : "Performance");
  const perfClass = perf.status === "in_forma" ? "ok" : perf.status === "da_monitorare" ? "bad" : "neutral";
  out.hero = '<div class="hist-hero-top"><div><div class="hist-kicker">Performance del modello</div><div class="hist-rate">' + pc(histRate) + ' <small>1X2 azzeccato</small></div><div class="perf-status ' + perfClass + '">' + esc(perfLabel) +
    '</div><p class="hist-caption"><b>' + h.hit + "</b> pronostici corretti su <b>" + h.n + "</b>. Ultime " + recent.length + ": <b>" + ((perf.recent_hit != null) ? perf.recent_hit : recent.filter((x) => x.ok).length) + "</b> corrette. " +
    (perf.status === "in_forma" ? "La forma recente è sopra la media storica." : perf.status === "da_monitorare" ? "La forma recente è sotto la media: meglio osservare altri risultati." : perf.status === "stabile" ? "La forma recente è in linea con la media." : "Servono più partite prima di giudicare la forma.") +
    '</p></div><div class="hist-ring" style="--rate:' + Math.round(histRate * 100) + '%"><b>' + pc(histRate) + '</b></div></div><div class="hist-bars">' + bars + "</div>";
  out.sum = '<div class="stat"><div class="k">Esito 1X2 azzeccato</div><div class="v">' + h.hit + " su " + h.n + '</div><div class="s">' + pc(h.hit / h.n) + "</div></div>" +
    '<div class="stat"><div class="k">Probabilità media dichiarata</div><div class="v">' + pc(h.avg_p) + '</div><div class="s">se coincide, il modello è calibrato</div></div>';
  if (h.brier != null) {
    const better = h.brier < h.brier_base, diff = Math.abs(1 - h.brier / h.brier_base);
    const cal = (h.calibration || []).map((b) => '<div class="cal"><span>' + esc(b.label) + '</span><span class="decay" style="display:block"><span class="track" style="display:block"><span class="fill" style="width:' + Math.round(b.hit * 100) +
      '%"></span></span></span><span>' + pc(b.avg_p) + "</span><span>" + pc(b.hit) + "</span></div>").join("");
    let cl = "";
    if (h.claude) {
      const c = h.claude, gain = c.brier_stat - c.brier_final;
      cl = '<div class="panel"><h2>Le notizie aiutano?</h2><p class="expl">Su ' + c.n + " partite: con le notizie l'errore è " + d2(c.brier_final) + ", con la sola statistica " + d2(c.brier_stat) + ". " +
        (c.n < 30 ? "Troppo presto per dirlo." : Math.abs(gain) < 0.003 ? "Per ora non cambia quasi nulla." : gain > 0 ? "Le notizie migliorano le stime." : "Le notizie per ora peggiorano le stime.") +
        " Esito azzeccato: " + c.hit_final + " su " + c.n + " con le notizie, " + c.hit_stat + " su " + c.n + " con la sola statistica.</p></div>";
    }
    if (h.versions) {
      const v = h.versions, g2 = v.brier_old - v.brier_new;
      cl += '<div class="panel"><h2>Modello nuovo o vecchio?</h2><p class="expl">Su ' + v.n + " partite, solo statistica: errore " + d2(v.brier_new) + " per il modello attuale, " + d2(v.brier_old) + " per la prima versione. " +
        (v.n < 30 ? "Troppo presto per dirlo." : Math.abs(g2) < 0.003 ? "Per ora sono alla pari." : g2 > 0 ? "Il modello attuale va meglio." : "La prima versione va meglio.") + "</p></div>";
    }
    const mk = h.markets || {};
    let mkt = "";
    if (mk.ou && mk.ou.n) mkt += '<div class="stat"><div class="k">Over/Under 2,5</div><div class="v">' + mk.ou.hit + " su " + mk.ou.n + '</div><div class="s">' + pc(mk.ou.hit / mk.ou.n) + "</div></div>";
    if (mk.gg && mk.gg.n) mkt += '<div class="stat"><div class="k">Gol / No Gol</div><div class="v">' + mk.gg.hit + " su " + mk.gg.n + '</div><div class="s">' + pc(mk.gg.hit / mk.gg.n) + "</div></div>";
    out.quality = modelScorePanel(h) + backtestPanel(h) + '<h2 class="sub2">Qualità del modello</h2>' +
      '<div class="sum"><div class="stat"><div class="k">Errore del modello</div><div class="v num">' + d2(h.brier) + '</div><div class="s">più è basso, meglio è</div></div>' +
      '<div class="stat"><div class="k">Metodo semplice</div><div class="v num">' + d2(h.brier_base) + '</div><div class="s">solo le medie del campionato</div></div>' + mkt + "</div>" +
      '<div class="panel" style="margin-top:14px"><p class="expl">' + (better
        ? "Il modello sbaglia il " + Math.round(diff * 100) + "% in meno del metodo semplice."
        : "Per ora il modello non fa meglio del metodo semplice (" + Math.round(diff * 100) + "% di errore in più).") +
      (h.n < 50 ? " Con " + h.n + " partite il dato è ancora ballerino: serve almeno una cinquantina di partite, meglio cento." : "") + "</p></div>" +
      (cal ? '<div class="panel"><h2>Quando dico 60%, succede?</h2>' + calChart(h.calibration) + '<p class="lead" style="margin:0 0 10px">Ogni punto è una fascia di pronostici (il numero accanto dice quante partite). Più i punti stanno vicino alla linea tratteggiata, più le percentuali sono affidabili.</p><div class="cal" style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em"><span>Probabilità</span><span>Successi</span><span>Detto</span><span>Reale</span></div><div style="display:flex;flex-direction:column;gap:8px">' +
        cal + '</div><p class="lead" style="margin:0">Se "Detto" e "Reale" sono vicini, le percentuali sono affidabili.</p></div>' : "") + cl;
  }
  out.quality += marketPerformancePanel(h);
  out.hist = (h.items || []).map((x) => "<div><span>" + esc(x.match) + "<small>" + esc(x.pick) + " dato al " + pc(x.p) + " · finale " + esc(x.score) + '</small></span><span class="' + (x.ok ? "ok" : "ko") +
    '" aria-label="' + (x.ok ? "Azzeccato" : "Sbagliato") + '">' + (x.ok ? "✓" : "✕") + "</span></div>").join("");
  return out;
}

/* ---------- Pagina squadra ---------- */
function teamUpcomingPanel(ctx, name, next, rounds) {
  const list = [];
  (rounds || []).forEach((r) => r.matches.forEach((m) => { if (m.home === name || m.away === name) list.push(m); }));
  if (!list.length) return "";
  return '<div class="panel"><h2>' + (next ? "Le partite dopo" : "Prossime partite") + '</h2><div class="nr-panel">' + roundRows(ctx, list, name) + "</div></div>";
}
function teamStatsPanel(name, classifica) {
  const st = classifica && classifica.stats ? classifica.stats[name] : null;
  if (!st) return "";
  const sides = [st.home, st.away];
  if (!(st.home.pg + st.away.pg)) return "";
  const avg = (a, b) => (b ? (a / b).toFixed(1).replace(".", ",") : "–");
  const share = (a, b) => (b ? Math.round(a / b * 100) + "%" : "–");
  const row = (label, f) => "<tr><th>" + label + "</th>" + sides.map((s) => "<td>" + f(s) + "</td>").join("") + "</tr>";
  return '<div class="panel"><h2>Statistiche stagione</h2><table class="team-stats"><thead><tr><th></th><th>Casa</th><th>Trasferta</th></tr></thead><tbody>' +
    row("Partite", (s) => s.pg) + row("V · N · P", (s) => s.w + " · " + s.d + " · " + s.l) +
    row("Gol fatti a partita", (s) => avg(s.gf, s.pg)) + row("Gol subiti a partita", (s) => avg(s.ga, s.pg)) +
    row("Senza subire gol", (s) => share(s.clean, s.pg)) + row("Senza segnare", (s) => share(s.blank, s.pg)) +
    row("Almeno 3 gol in partita", (s) => share(s.o25, s.pg)) + row("Segnano entrambe", (s) => share(s.btts, s.pg)) +
    "</tbody></table></div>";
}
const pctArt = (n) => { n = Math.abs(n); return (n === 1 || n === 11 || String(n).charAt(0) === "8") ? "l’" : "il "; };
function vsAverage(v, verb) {
  const d = Math.round((v - 1) * 100);
  return d === 0 ? "Nella media del campionato" : verb + " " + pctArt(d) + Math.abs(d) + "% " + (d > 0 ? "in più" : "in meno") + " della media";
}
const barWidth = (v, better) => { const x = better === "high" ? (v - 0.5) : (1.5 - v); return Math.round(Math.max(0.04, Math.min(1, x)) * 100); };

/* Squadre della lega: classifica, turno e prossime giornate (le coppe possono avere squadre fuori classifica). */
export function teamsOf(turno, classifica) {
  const names = new Set();
  ((classifica && classifica.table) || []).forEach((r) => names.add(r.team));
  ((turno && turno.matches) || []).forEach((m) => { names.add(m.home); names.add(m.away); });
  ((turno && turno.next_rounds) || []).forEach((r) => r.matches.forEach((m) => { names.add(m.home); names.add(m.away); }));
  return [...names].filter(Boolean).sort((a, b) => a.localeCompare(b, "it"));
}

export function teamPage(ctx, name, { turno, storico, classifica }) {
  const t = (classifica && classifica.table) || [], row = t.find((r) => r.team === name);
  const rating = classifica && classifica.ratings ? classifica.ratings[name] : null;
  const se = classifica && classifica.season, srow = se && se.teams ? se.teams.find((r) => r.team === name) : null;
  const matches = (turno && turno.matches) || [];
  const next = matches.find((m) => m.home === name || m.away === name);
  const past = ((storico && storico.items) || []).filter((x) => { const parts = String(x.match).split(" – "); return parts[0] === name || parts[1] === name; }).slice(0, 8);
  const on = isFav(ctx, name);
  let html = '<div class="team-head"><div><small>' + esc(leagueByCode(ctx.league).name) + '</small><h2 id="team-title" tabindex="-1">' + esc(name) + "</h2>" +
    (row ? "<small>" + row.pos + "ª in classifica · " + row.pts + " punti in " + row.pg + " partite · differenza reti " + (row.gf - row.ga > 0 ? "+" : "") + (row.gf - row.ga) + "</small>" : "") +
    '</div><button type="button" class="fav-btn" data-fav="' + esc(name) + '" aria-pressed="' + on + '">' + (on ? "★ Seguita" : "☆ Segui") + "</button></div>";
  if (rating) {
    html += '<div class="team-grid">' +
      '<div class="panel"><div class="k">Attacco</div><p class="expl" style="margin:4px 0 0">' + vsAverage(rating.att, "Segna") + '</p><div class="team-bar"><i style="width:' + barWidth(rating.att, "high") + '%"></i></div></div>' +
      '<div class="panel"><div class="k">Difesa</div><p class="expl" style="margin:4px 0 0">' + vsAverage(rating["def"], "Subisce") + '</p><div class="team-bar"><i style="width:' + barWidth(rating["def"], "low") + '%"></i></div></div>' +
      '<div class="panel"><div class="k">Forma (ultime 5)</div><div style="margin-top:6px">' + chips(rating.form) + "</div></div></div>" +
      '<p class="lead" style="margin:-4px 0 12px">Forza stimata dal modello tenendo conto degli avversari affrontati: barra più lunga = meglio.</p>';
  }
  if (next) {
    const home = next.home === name, p = next.prob;
    html += '<div class="panel"><h2>Prossima partita</h2><p class="expl">' + esc(next.home) + " – " + esc(next.away) + " · " + esc(dayOf(next) + " " + when(next)) + "</p>" +
      '<p class="expl">Vittoria ' + pc(home ? p.p1 : p.p2) + " · pareggio " + pc(p.px) + " · sconfitta " + pc(home ? p.p2 : p.p1) + "</p>" +
      '<div class="match-actions"><a class="share-btn ff-btn" href="' + matchUrl(ctx.league, next) + '">Apri la partita →</a></div></div>';
  }
  html += teamStatsPanel(name, classifica) + teamUpcomingPanel(ctx, name, next, turno && turno.next_rounds);
  if (srow && se.zones && se.zones.length && se.remaining) {
    html += '<div class="panel"><h2>Come può finire la stagione</h2><div class="team-list">' +
      "<div><span>Posizione media</span><b>" + decimalIt(srow.pos_avg) + "ª (tra " + srow.best + "ª e " + srow.worst + "ª)</b></div>" +
      se.zones.map((z) => "<div><span>" + esc(z.label) + "</span><b>" + seasonPct(srow[z.key]) + "</b></div>").join("") +
      '</div><p class="lead" style="margin:8px 0 0">Su ' + thousandsIt(se.n_sim) + " stagioni simulate.</p></div>";
  }
  if (past.length) {
    html += '<div class="panel"><h2>Pronostici passati</h2><div class="team-list">' + past.map((x) =>
      "<div><span>" + esc(x.match) + " · " + esc(x.score) + "</span><b>" + esc(x.pick) + " al " + pc(x.p) + " " + (x.ok ? "✓" : "✕") + "</b></div>").join("") + "</div></div>";
  }
  if (!row && !rating && !next) html += '<div class="msg">Dati della squadra non ancora disponibili.</div>';
  return html;
}

/* ---------- Intestazione: etichette sullo stato dei dati ---------- */
export function statusTags(turno, updated) {
  const d = turno || {}, tags = [];
  tags.push(d.demo ? '<span class="tag warn">Dati di esempio</span>' : '<span class="tag ok">Dati reali</span>');
  if (d.ai_status === "attiva") tags.push('<span class="tag ok">Analisi AI attiva</span>');
  else if (d.ai_status === "parziale") tags.push('<span class="tag warn">AI parzialmente disponibile</span>');
  else if (d.ai_status === "non_disponibile") tags.push('<span class="tag warn">Solo statistica · AI non disponibile</span>');
  else tags.push('<span class="tag">Solo statistica</span>');
  if (updated) tags.push('<span class="tag">Aggiornato ' + esc(updated) + "</span>");
  return tags.join("");
}
