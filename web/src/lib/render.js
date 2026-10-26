/* Rendering HTML delle sezioni del sito, ricavato da static/index.html.
   Le funzioni sono pure: ricevono i dati pubblicati (docs/*.json) e un contesto
   { league, favs } e restituiscono stringhe HTML. Le usa Astro durante il build
   (pagine statiche) e il browser nelle isole interattive, così il markup è uno solo.
   Ogni dato inserito nell'HTML passa da esc() o safeUrl(), come nel sito attuale.
   I testi passano da t() (src/lib/i18n.js): in italiano l'HTML resta identico, in inglese
   si usano le traduzioni e, per i testi scritti dal modello Python, i campi *_en quando ci sono. */
import {
  pc, d1, d2, esc, safeUrl, when, dayOf, shortDay, roundDay, fmtDay, decimalIt, thousandsIt,
  leagueByCode, teamUrl, matchUrl, leagueUrl
} from "./core.js";
import { finalOutcome, homeOutcome, prudentChoice, byStrength, deriveRecommendation, slipReason, marketReliability, recLabel, marketText } from "./model.js";
import { t, isEn, loc } from "./i18n.js";

const favSet = (ctx) => new Set((ctx && ctx.favs) || []);
const isFav = (ctx, name) => favSet(ctx).has(name);
const isFavMatch = (ctx, m) => isFav(ctx, m.home) || isFav(ctx, m.away);
export const starHtml = () => '<span class="fav-star" aria-label="' + t("Squadra seguita") + '">★</span>';

/* Affidabilità (alta · media · bassa) e lettere della forma (V · N · P → W · D · L in inglese).
   Il valore originale resta nella classe CSS. */
const confText = (c) => t(String(c));
const RES_EN = { V: "W", N: "D", P: "L" };
const resText = (c) => (isEn() && RES_EN[c]) || c;
/* Posizione in classifica: "3ª" · "3rd". */
export const ordinal = (n) => {
  if (!isEn()) return n + "ª";
  const k = n % 100, s = k >= 11 && k <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" })[n % 10] || "th";
  return n + s;
};

export function chips(f) {
  return f ? f.split("").map((c) => '<span class="chip ' + esc(c) + '">' + esc(resText(c)) + "</span>").join("") : '<span class="abs">' + t("nessun dato") + "</span>";
}
export function teamLink(ctx, name) {
  return '<a class="team-link ff-btn" href="' + teamUrl(ctx.league, name) + '" data-team="' + esc(name) + '">' + esc(name) + "</a>";
}

/* ---------- Partite ---------- */
function lastRows(arr, label) {
  if (!arr || !arr.length) return "";
  return '<div class="t">' + esc(label) + "</div>" + arr.map((x) =>
    '<div class="r"><span class="chip ' + esc(x.res) + '">' + esc(resText(x.res)) + "</span><span>" + (x.home ? "vs " : "@ ") + esc(x.opp) + "</span><b>" + esc(x.score) + "</b></div>").join("");
}
function results(m) {
  const h = (m.h2h || []).map((x) => {
    const d = x.date.slice(8, 10) + "/" + x.date.slice(5, 7) + "/" + x.date.slice(2, 4);
    return '<div class="r"><small>' + esc(d) + "</small><span>" + esc(x.home) + " – " + esc(x.away) + "</span><b>" + esc(x.score) + "</b></div>";
  }).join("");
  const l = m.last || {};
  const out = lastRows(l.home, t("Ultime di {team}", { team: m.home })) + lastRows(l.away, t("Ultime di {team}", { team: m.away })) +
    (h ? '<div class="t">' + t("Ultimi scontri diretti") + "</div>" + h : "");
  return out ? '<div class="res">' + out + "</div>" : "";
}

export function whyPanel(m) {
  const e = m.explain;
  if (!e || !e.items || !e.items.length) return "";
  const label = { home: m.home, away: m.away, both: t("Partita") };
  const shown = e.items.filter((x) => x.effect !== 0).slice(0, 5);
  return '<div class="why-panel"><h4>' + t("Perché il modello dice così") + "</h4><ul>" + shown.map((x) =>
    '<li><span class="why-side ' + esc(x.side) + '">' + esc(label[x.side] || "") + "</span>" + esc(loc(x, "text")) + "</li>").join("") +
    '</ul><p class="why-sum">' + esc(loc(e, "summary")) + "</p></div>";
}

const NOTE_NO_BET = "Stima statistica del modello: non è una certezza e non costituisce un invito a scommettere.";

function matchCenter(ctx, m, p, a, s, fo, prudent) {
  return '<div class="match-center">' +
    '<div class="mc-kicker"><span>Match Center</span><span class="mc-ai">' + (a.ai && a.sources.length ? t("AI + statistiche") : t("Solo statistiche")) + "</span></div>" +
    '<div class="mc-teams"><div class="mc-team"><small>' + t("CASA") + "</small><b>" + teamLink(ctx, m.home) + '</b></div><div class="mc-vs">VS</div><div class="mc-team"><small>' + t("TRASFERTA") + "</small><b>" + teamLink(ctx, m.away) + "</b></div></div>" +
    '<div class="mc-probs"><div class="mc-prob ' + (fo[0] === "1" ? "hot" : "") + '"><small>1</small><strong>' + pc(p.p1) + "</strong></div>" +
    '<div class="mc-prob ' + (fo[0] === "X" ? "hot" : "") + '"><small>X</small><strong>' + pc(p.px) + "</strong></div>" +
    '<div class="mc-prob ' + (fo[0] === "2" ? "hot" : "") + '"><small>2</small><strong>' + pc(p.p2) + "</strong></div></div>" +
    '<div class="mc-grid"><div class="mc-stat"><small>' + t("Gol attesi") + "</small><b>" + d1(m.xg[0]) + " – " + d1(m.xg[1]) + "</b></div>" +
    '<div class="mc-stat"><small>' + t("Affidabilità") + "</small><b>" + esc(confText(m.conf)) + '</b></div><div class="mc-stat"><small>' + t("Forma casa") + '</small><div class="mc-form">' + chips(m.form && m.form.home) + "</div></div>" +
    '<div class="mc-stat"><small>' + t("Forma trasferta") + '</small><div class="mc-form">' + chips(m.form && m.form.away) + "</div></div></div>" +
    '<div class="mc-score"><span>' + t("Risultato più probabile") + "</span><b>" + s[0] + "-" + s[1] + "</b><span>" + pc(s[2]) + "</span></div>" +
    '<div class="mc-explain"><b>' + t("Perché questo esito") + '</b><p class="expl">' + esc(loc(a, "text")) + "</p></div>" +
    '<div class="mc-final reference-final-card"><div class="title">✦ ' + t("Pronostico finale del modello") + '</div><div class="reference-final-grid">' +
    '<div class="reference-final-item"><small>' + t("Esito 1X2 più probabile") + "</small><b>" + esc(fo[0] + " · " + fo[1]) + "</b><strong>" + pc(fo[2]) + "</strong></div>" +
    '<div class="reference-final-item"><small>' + t("Doppia chance più prudente") + "</small><b>" + esc(prudent[0]) + "</b><strong>" + pc(prudent[1]) + "</strong></div>" +
    '<div class="reference-final-item"><small>' + t("Risultato esatto più probabile") + "</small><b>" + esc(s[0] + "-" + s[1]) + "</b><strong>" + pc(s[2]) + "</strong></div></div>" +
    '<p class="reference-final-note">' + t(NOTE_NO_BET) + "</p></div></div>";
}

/* Testo condiviso da "Condividi" (WhatsApp, menu del telefono o appunti). */
export function shareText(m) {
  const p = m.prob, s = m.top_scores[0];
  const top = p.p1 >= p.px && p.p1 >= p.p2 ? ["1", m.home, p.p1] : p.px >= p.p2 ? ["X", t("pareggio"), p.px] : ["2", m.away, p.p2];
  return t("{home} – {away}: per il modello {code} ({name}) al {p}, risultato più probabile {score}. Stime statistiche, non un invito a scommettere.",
    { home: m.home, away: m.away, code: top[0], name: top[1], p: pc(top[2]), score: s[0] + "-" + s[1] });
}

/* Scheda di una partita. opts.open: aperta (pagina della partita); opts.standalone: senza link a sé stessa. */
export function card(ctx, m, i, opts = {}) {
  const p = m.prob, a = m.analysis, s = m.top_scores[0], rec = deriveRecommendation(m);
  const fo = finalOutcome(m), prudent = prudentChoice(m);
  const alt = m.top_scores.slice(1).map((x) => x[0] + "-" + x[1]).join(", ");
  const absHome = a.absences_home || [], absAway = a.absences_away || [], nAbs = absHome.length + absAway.length;
  const adjusted = a.adjusted != null ? !!a.adjusted : (Math.abs(a.factor_home - 1) > 0.005 || Math.abs(a.factor_away - 1) > 0.005);
  let abs = "";
  if (nAbs) {
    abs = '<div class="abs-confirmed"><h4>' + (a.ai ? t("Assenze confermate dalle fonti") : t("Assenze")) + "</h4>" +
      (absHome.length ? "<div><b>" + esc(m.home) + ":</b> " + absHome.map(esc).join(", ") + "</div>" : "") +
      (absAway.length ? "<div><b>" + esc(m.away) + ":</b> " + absAway.map(esc).join(", ") + "</div>" : "") +
      (adjusted ? '<div class="s">' + t("Gol attesi corretti:") + " " + [[m.home, a.factor_home, 0], [m.away, a.factor_away, 1]]
        .filter((x) => Math.abs(x[1] - 1) > 0.005)
        .map((x) => esc(x[0]) + " " + d2(m.xg_base[x[2]]) + " → " + d2(m.xg[x[2]])).join(" · ") + "</div>" : "") +
      "</div>";
  }
  const src = a.sources.length ? '<div class="src-status">' + (a.ai && nAbs
    ? t("Ogni assenza elencata è confermata dal testo di almeno uno di questi articoli.")
    : t("Fonti web recuperate automaticamente: la presenza di un link non conferma da sola un’indisponibilità.")) +
    '</div><div class="srcs">' + a.sources.filter((x) => safeUrl(x.url)).map((x) =>
      '<a href="' + esc(safeUrl(x.url)) + '" target="_blank" rel="noopener noreferrer">' + esc(x.title) + "</a>").join("") + "</div>" : "";
  const adj = adjusted && !nAbs
    ? '<div class="abs">' + t("Correzione sui gol attesi: {home} ×{fh}, {away} ×{fa} (gol attesi di base {bh} - {ba}).",
      { home: esc(m.home), fh: d2(a.factor_home), away: esc(m.away), fa: d2(a.factor_away), bh: d1(m.xg_base[0]), ba: d1(m.xg_base[1]) }) + "</div>" : "";
  const adjBadge = adjusted && a.ai
    ? '<div class="adj-line"><span class="adj-badge">' + t("Corretto per assenze") + "</span><span>" + nAbs + (nAbs === 1 ? t(" assenza confermata") : t(" assenze confermate")) + "</span></div>" : "";
  const who = a.ai && a.sources.length ? t("Analisi con le ultime notizie") : a.ai ? t("Analisi AI senza fonti verificabili") : t("Analisi statistica");
  const fav = isFavMatch(ctx, m);
  const pageLink = opts.standalone ? "" : '<a class="share-btn ff-btn" href="' + matchUrl(ctx.league, m) + '">' + t("Pagina della partita →") + "</a>";
  const best = recLabel(rec.best, m);
  return '<details class="match' + (fav ? " fav" : "") + '" id="m-' + esc(m.id) + '" style="--i:' + i + '" data-home="' + esc(m.home) + '" data-away="' + esc(m.away) + '"' +
    (m.kickoff ? ' data-kickoff="' + esc(m.kickoff) + '"' : "") + (opts.open ? " open" : "") + "><summary>" +
    '<div class="mhead"><span>' + (fav ? starHtml() : "") + esc(when(m)) + '</span><span class="conf ' + esc(m.conf) + '">' + esc(t("Affidabilità " + m.conf)) + "</span></div>" +
    '<div class="match-summary-main">' +
    '<div class="match-team"><div class="team-side">' + t("Casa") + '</div><div class="team-name">' + esc(m.home) + "</div></div>" +
    '<div class="match-score"><strong>' + s[0] + "-" + s[1] + "</strong>" + t("probabile") + "</div>" +
    '<div class="match-team away"><div class="team-side">' + t("Trasferta") + '</div><div class="team-name">' + esc(m.away) + "</div></div>" +
    "</div>" +
    '<div class="bar" role="img" aria-label="' + t("{home} {p1}, pareggio {px}, {away} {p2}", { home: esc(m.home), p1: pc(p.p1), px: pc(p.px), away: esc(m.away), p2: pc(p.p2) }) + '">' +
    '<i class="h" style="flex:' + p.p1 + '"><small>1</small>' + pc(p.p1) + "</i>" +
    '<i class="d" style="flex:' + p.px + '"><small>X</small>' + pc(p.px) + "</i>" +
    '<i class="a" style="flex:' + p.p2 + '"><small>2</small>' + pc(p.p2) + "</i></div>" +
    adjBadge +
    '<div class="match-pick"><span class="pick-pill">' + t("Modello") + '</span><span class="value">' + esc(fo[0] + " · " + fo[1]) + " <b>" + pc(fo[2]) + "</b></span></div></summary>" +
    '<div class="detail">' + matchCenter(ctx, m, p, a, s, fo, prudent) +
    '<div class="match-actions"><button type="button" class="share-btn" data-share="' + esc(m.id) + '" data-share-text="' + esc(shareText(m)) + '" data-share-url="' + esc(matchUrl(ctx.league, m)) + '">↗ ' + t("Condividi") + "</button>" + pageLink + "</div>" +
    whyPanel(m) +
    '<div><div class="who">' + who + '</div><p class="expl">' + esc(loc(a, "text")) + "</p></div>" +
    abs + adj + (a.ai && !a.sources.length ? '<div class="src-status">' + t("Analisi AI eseguita, ma nessuna fonte pertinente è stata verificata per questa partita. I fattori restano neutrali.") + "</div>" : "") + src +
    '<div class="final-prediction" aria-label="' + t("Pronostico finale del modello") + '">' +
    '<div class="title">' + t("Pronostico finale del modello") + "</div>" +
    '<div class="main-outcome"><span class="outcome">' + esc(best) + '</span><span class="prob">' + pc(rec.best.p) + "</span></div>" +
    '<div class="rows">' +
    (rec.best.base != null ? '<div class="row"><span>' + t("Media del campionato per questo mercato") + '</span><b class="num">' + pc(rec.best.base) + " · " + (rec.best.edge >= 0 ? "+" : "") + Math.round(rec.best.edge * 100) + t(" punti") + "</b></div>" : "") +
    '<div class="row"><span>' + t("Alternativa più prudente") + "</span><b>" + esc(prudent[0]) + ' · <span class="num">' + pc(prudent[1]) + "</span></b></div>" +
    '<div class="row"><span>' + t("Altri mercati forti") + '</span><b class="num">' + rec.alternatives.slice(1, 3).map((x) => esc(recLabel(x, m)) + " · " + pc(x.p)).join(" · ") + "</b></div>" +
    '<div class="row"><span>' + t("Risultato esatto più probabile") + '</span><b class="num">' + esc(s[0] + "-" + s[1]) + " · " + pc(s[2]) + "</b></div>" +
    "</div>" +
    '<p class="note">' + t(NOTE_NO_BET) + "</p>" +
    "</div>" +
    '<div class="grid">' +
    '<div class="stat"><div class="k">' + t("Risultato probabile") + '</div><div class="v">' + s[0] + "-" + s[1] + '</div><div class="s">' + pc(s[2]) + t(" · poi ") + alt + "</div></div>" +
    '<div class="stat"><div class="k">' + t("Gol attesi") + '</div><div class="v">' + d1(m.xg[0]) + " - " + d1(m.xg[1]) + '</div><div class="s">' + t("totale") + " " + d1(m.xg[0] + m.xg[1]) + "</div></div>" +
    '<div class="stat"><div class="k">' + marketText("Over 2,5") + '</div><div class="v">' + pc(p.o25) + '</div><div class="s">Under ' + pc(p.u25) + "</div></div>" +
    '<div class="stat"><div class="k">' + t("Segnano entrambe") + '</div><div class="v">' + pc(p.gg) + '</div><div class="s">' + t("No") + " " + pc(p.ng) + "</div></div>" +
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
  return list.length ? '<div class="fav-strip"><h2>' + t("Le tue squadre") + "</h2>" + list.map((m) =>
    '<a class="ff-btn" href="#m-' + esc(m.id) + '" data-goto-match="' + esc(m.id) + '"><span>' + esc(m.home) + " – " + esc(m.away) + "</span><small>" + esc(m.info) + "</small></a>").join("") + "</div>" : "";
}

/* Partite già giocate: pronostico fatto prima, risultato vero, esito. */
export function played(x) {
  const p = x.prob, v = [];
  v.push('<span class="' + (x.ok ? "y" : "n") + '">' + (x.ok ? t("✓ Esito azzeccato") : t("✕ Esito sbagliato")) + " (" + t("{pick} al {p}", { pick: esc(x.pick), p: pc(x.pick_p) }) + ")</span>");
  if (x.ou) v.push('<span class="' + (x.ou.ok ? "y" : "n") + '">' + (x.ou.ok ? "✓" : "✕") + " " + marketText("Over/Under 2,5") + "</span>");
  if (x.gg) v.push('<span class="' + (x.gg.ok ? "y" : "n") + '">' + (x.gg.ok ? "✓" : "✕") + " " + t("Gol/No Gol") + "</span>");
  const top = x.top ? "<span>" + t("Risultato previsto") + " " + x.top[0] + "-" + x.top[1] + "</span>" : "";
  return '<div class="played"><div class="mhead"><span>' + esc(shortDay(x.kickoff)) + "</span><span>" + t("Finita") + "</span></div>" +
    '<div class="final"><div class="nm">' + esc(x.home) + '</div><div class="score">' + esc(x.hg) + "-" + esc(x.ag) + '</div><div class="nm r">' + esc(x.away) + "</div></div>" +
    '<div class="bar" role="img" aria-label="' + t("Pronostico:") + " " + pc(p.p1) + " " + pc(p.px) + " " + pc(p.p2) + '">' +
    '<i class="h" style="flex:' + p.p1 + '"><small>1</small>' + pc(p.p1) + "</i>" +
    '<i class="d" style="flex:' + p.px + '"><small>X</small>' + pc(p.px) + "</i>" +
    '<i class="a" style="flex:' + p.p2 + '"><small>2</small>' + pc(p.p2) + "</i></div>" +
    '<div class="verdict">' + v.join("") + top + "</div></div>";
}
export function playedSection(list) {
  if (!list || !list.length) return "";
  const hits = list.filter((x) => x.ok).length;
  return '<h2 class="sub2">' + t("Già giocate") + '</h2><p class="lead">' + t("Ultime {n} partite pronosticate: esito azzeccato {hits} volte su {n}.", { n: list.length, hits }) +
    '</p><div class="list">' + list.map(played).join("") + "</div>";
}

/* Il pronostico più netto del turno, in cima a Partite. */
export function hero(m) {
  if (!m) return "";
  const p = m.prob, s = m.top_scores[0], rec = deriveRecommendation(m);
  return '<div class="hero" style="--i:0"><span class="badge">' + t("Pronostico più netto del turno") + "</span>" +
    '<div class="vs"><div class="side l"><div class="nm">' + esc(m.home) + '</div><div class="big">' + pc(p.p1) + "</div></div>" +
    '<div class="mid"><div class="label">X</div><div class="big">' + pc(p.px) + "</div></div>" +
    '<div class="side r"><div class="nm">' + esc(m.away) + '</div><div class="big">' + pc(p.p2) + "</div></div></div>" +
    '<div class="meta"><span>' + t("Risultato probabile") + ' <b class="num">' + s[0] + "-" + s[1] + "</b></span>" +
    "<span>" + t("Pronostico del modello") + " <b>" + esc(recLabel(rec.best, m)) + " · " + pc(rec.best.p) + "</b></span></div>" +
    '<a class="cta ff-btn" href="#m-' + esc(m.id) + '" data-open="m-' + esc(m.id) + '">' + t("Apri l'analisi") + "</a></div>";
}

/* Home: partita del giorno, numeri del turno e previsioni più forti. */
export function homeDashboard(ctx, matches) {
  const ranked = byStrength(matches);
  if (!ranked.length) return null;
  const m = ranked[0], p = m.prob, s = m.top_scores[0], rec = deriveRecommendation(m), fo = homeOutcome(m);
  const open = (x) => leagueUrl(ctx.league, "partite") + "#m-" + encodeURIComponent(x.id);
  const feature = '<div class="feature-card"><div class="feature-top"><span class="badge">' + esc(recLabel(rec.best, m)) + " " + pc(rec.best.p) + '</span><span class="conf ' + esc(m.conf) + '">' + esc(t("Affidabilità " + m.conf)) +
    '</span></div><div class="feature-match"><div class="feature-team"><small>' + t("Casa") + "</small><b>" + esc(m.home) + '</b></div><div class="feature-vs">VS</div><div class="feature-team r"><small>' + t("Trasferta") + "</small><b>" + esc(m.away) +
    '</b></div></div><div class="feature-prob"><span class="' + (fo[0] === "1" ? "hot" : "") + '"><b>1</b>' + pc(p.p1) + '</span><span class="' + (fo[0] === "X" ? "hot" : "") + '"><b>X</b>' + pc(p.px) +
    '</span><span class="' + (fo[0] === "2" ? "hot" : "") + '"><b>2</b>' + pc(p.p2) + '</span></div><div class="feature-bottom"><div class="feature-score"><small>' + t("Risultato più probabile") + "</small>" + s[0] + "-" + s[1] +
    '</div><a class="feature-open ff-btn" href="' + esc(open(m)) + '">' + t("Vedi analisi →") + "</a></div></div>";
  const n = matches.length, avg = matches.reduce((x, y) => x + Math.max(y.prob.p1, y.prob.px, y.prob.p2), 0) / n;
  const quick = '<div class="quick-card"><div class="q-label">' + t("Partite") + '</div><div class="q-value">' + n + '</div><div class="q-note">' + t("analizzate dal modello") + "</div></div>" +
    '<div class="quick-card"><div class="q-label">' + t("Forza media") + '</div><div class="q-value">' + pc(avg) + '</div><div class="q-note">' + t("esito principale medio") + "</div></div>";
  const strong = ranked.slice(0, 4).map((x) => {
    const f = homeOutcome(x), sc = x.top_scores[0][0] + "-" + x.top_scores[0][1];
    return '<a class="home-row ff-btn" href="' + esc(open(x)) + '"><span class="hr-p">' + pc(f[2]) + "<small>" + esc(f[0] + " · " + f[1]) + '</small></span><span class="hr-teams">' + esc(x.home) + " — " + esc(x.away) +
      "<small>" + esc(confText(x.conf)) + " · " + esc(sc) + " " + t("probabile") + '</small></span><span class="hr-score">' + esc(sc) + "</span></a>";
  }).join("");
  return { feature, quick, strong };
}

/* ---------- Prossime giornate ---------- */
function roundRows(ctx, list, team) {
  return list.map((m) => {
    const p = m.prob;
    const mark = (n) => (team && n === team) || (!team && isFav(ctx, n)) ? "<b>" + esc(n) + "</b>" : esc(n);
    return '<div class="nr-row"><span class="nr-teams">' + mark(m.home) + " – " + mark(m.away) + "<small>" + esc(roundDay(m.kickoff)) +
      " · " + t("probabile") + " " + esc(m.top[0] + "-" + m.top[1]) + '</small></span><span class="nr-p"><i>1 ' + pc(p.p1) + "</i><i>X " + pc(p.px) + "</i><i>2 " + pc(p.p2) + "</i></span></div>";
  }).join("");
}
export function nextRoundsPanel(ctx, rounds) {
  if (!rounds || !rounds.length) return "";
  return '<h2 class="sub2">' + t("Prossime giornate") + '</h2><p class="lead">' + t("Solo modello statistico: le notizie su infortuni e squalifiche arrivano nelle 48 ore prima di ogni partita. Le probabilità cambiano dopo ogni turno.") + "</p>" +
    rounds.map((r) => '<div class="panel nr-panel"><h3>' + t("Giornata") + " " + esc(r.matchday) + "</h3>" + roundRows(ctx, r.matches) + "</div>").join("");
}

/* ---------- Più probabili ---------- */
export function comboHtml(picks, n) {
  const sel = picks.slice(0, n), prod = sel.reduce((s, x) => s * x.p, 1), strongest = sel[0];
  if (!strongest) return { combo: '<div class="msg">' + t("Nessuna selezione disponibile.") + "</div>", decay: "" };
  const combo = '<div class="pick-hero"><div class="ph-top"><span class="ph-label">' + t("LA PIÙ PROBABILE") + '</span><span class="ph-prob">' + pc(strongest.p) + '</span></div><div class="ph-match">' + esc(strongest.m) +
    '</div><div class="ph-bet">' + t("Esito più probabile:") + " <b>" + esc(strongest.label) + "</b> · " + t("modello statistico") + '</div><div class="ph-bar"><div class="ph-fill" style="--p:' + Math.round(strongest.p * 100) + '%"></div></div></div>' +
    '<div class="sure-head"><h2>' + t("Le più probabili") + "</h2><small>" + t("ordinate per probabilità") + '</small></div><div class="pick-list">' +
    sel.map((x, i) => '<div class="pick-item"><div class="pick-rank">#' + (i + 1) + "<b>" + (i === 0 ? "TOP" : "") + '</b></div><div class="pick-main"><div class="pm-match">' + esc(x.m) +
      '</div><div class="pm-type">' + esc(x.label) + " · " + esc(marketText(x.code)) + '</div></div><div class="pick-pct">' + pc(x.p) + "<small>" + t("probabilità") + "</small></div></div>").join("") +
    '</div><div class="pick-meta"><span class="risk">✓ ' + t("selezioni ordinate dal modello") + "</span><span>" + t("{n} selezioni", { n }) + "</span><span>" + t("probabilità combinata") + " " + pc(prod) + "</span></div>" +
    '<p class="sure-note">' + t("Queste sono probabilità statistiche, non garanzie. La probabilità combinata è il prodotto delle singole probabilità e tende a diminuire rapidamente aggiungendo selezioni.") + "</p>";
  let cum = 1;
  const decay = picks.slice(0, 5).map((x, i) => {
    cum *= x.p;
    return '<div class="' + (i + 1 === n ? "on" : "") + '"><span>' + (i + 1) + (i ? t(" selezioni") : t(" selezione")) + '</span><span class="track"><span class="fill" style="width:' + Math.round(cum * 100) + '%"></span></span><span class="val">' + pc(cum) + "</span></div>";
  }).join("");
  return { combo, decay };
}

/* ---------- Le scelte del modello ---------- */
const SLIP_NAME = { facile: "FACILE", media: "MEDIA", difficile: "DIFFICILE" };
const SLIP_DESC = {
  facile: "Parte dal miglior pronostico multi-mercato del modello e privilegia le selezioni più solide.",
  media: "Combina le migliori raccomandazioni del modello tra esiti, gol e combo, cercando un equilibrio.",
  difficile: "Cerca selezioni meno probabili tra combo, mercati gol e, quando disponibile, il risultato esatto più probabile."
};
const KIND_NAME = { base: "Esito", esito: "Esito", doppia: "Doppia chance", gol: "Gol", combo: "Combo", score: "Risultato esatto" };
const kindName = (k) => (k === "gol" && isEn() ? "Goals" : t(KIND_NAME[k]));
export function slipHtml(picks, mode, matches, marketPerformance = {}, backtestMarkets = {}) {
  const prod = picks.reduce((v, x) => v * x.p, 1), name = t(SLIP_NAME[mode]);
  const aiOn = matches.some((x) => x.analysis && x.analysis.ai);
  const reliability = (x) => {
    const r = marketReliability(x, marketPerformance, backtestMarkets);
    return r.score == null ? t("Affidabilità: dati insufficienti") : t("Affidabilità: {score}/100 · {n} osservazioni", { score: r.score, n: r.n }) + (r.source === "mercato" ? t(" · mercato") : t(" · categoria"));
  };
  return '<div class="slip-hero"><div class="slip-kicker">' + t("Le scelte del modello") + " · " + name + '</div><div class="slip-title">' + name + '</div><div class="slip-sub">' + t(SLIP_DESC[mode]) +
    '</div><div class="slip-meta"><span>' + t("{n} selezioni", { n: picks.length }) + "</span><span>" + t("Prob. comb. teorica") + " " + pc(prod) + "</span><span>" + (aiOn ? t("AI + statistica") : t("Solo statistica")) + "</span></div></div>" +
    '<div class="slip-list">' + picks.map((x, i) => '<div class="slip-item"><div class="slip-num">0' + (i + 1) + '</div><div><div class="slip-match">' + esc(x.m) + '</div><div class="slip-market">' +
      esc(kindName(x.kind) + " · " + x.label) + (x.recommended ? " <b>· " + t("TOP MODELLO") + "</b>" : "") + '</div><div class="slip-reason">' + esc(slipReason(x)) + '</div><div class="slip-reliability">' + reliability(x) +
      '</div></div><div class="slip-prob">' + pc(x.p) + "<small>" + t("stima") + "</small></div></div>").join("") + "</div>" +
    '<div class="slip-foot"><div class="slip-combo">' + pc(prod) + "<small>" + t("probabilità combinata teorica") + '</small></div><div class="slip-note">' + t("Le selezioni derivano dalle probabilità del modello e dalle sue raccomandazioni multi-mercato. Stima statistica: non è una certezza e non costituisce un invito a scommettere.") + "</div></div>";
}

/* ---------- Classifica e fine stagione ---------- */
export function tableHtml(ctx, classifica) {
  const tb = (classifica && classifica.table) || [];
  if (!tb.length) return '<div class="msg">' + t("Classifica non disponibile.") + "</div>";
  const n = tb.length;
  return '<table class="table"><thead><tr><th>#</th><th>' + t("Squadra") + "</th><th>" + t("PG") + '</th><th class="hide-s">' + t("V") + '</th><th class="hide-s">' + t("N") + '</th><th class="hide-s">' + t("P") + "</th><th>" + t("DR") + "</th><th>" + t("Pt") + "</th></tr></thead><tbody>" +
    tb.map((r) => {
      const dr = r.gf - r.ga, cls = r.pos <= 4 ? "ucl" : (n >= 18 && r.pos > n - 3) ? "rel" : "";
      return '<tr class="' + cls + '" data-team-row="' + esc(r.team) + '"><td>' + r.pos + "</td><td>" + (isFav(ctx, r.team) ? starHtml() : "") + teamLink(ctx, r.team) + "</td><td>" + r.pg + '</td><td class="hide-s">' + r.w +
        '</td><td class="hide-s">' + r.d + '</td><td class="hide-s">' + r.l + "</td><td>" + (dr > 0 ? "+" : "") + dr + "</td><td>" + r.pts + "</td></tr>";
    }).join("") + "</tbody></table>";
}
export function seasonPct(v) { return v == null ? "–" : v === 0 ? "0%" : v < 0.005 ? "&lt;1%" : (v > 0.995 && v < 1) ? "&gt;99%" : pc(v); }
/* Nome di una zona della classifica (le scrive il modello Python in italiano): in inglese dalla chiave. */
export function zoneLabel(z) {
  if (!isEn()) return z.label;
  const n = (z.to || 0) - (z.from || 0) + 1;
  return ({ title: "First place", top4: "Top 4", releg: "Bottom " + n, top8: "Top 8 (last 16)", playoff: "9th–24th (play-offs)", out: "Eliminated" })[z.key] || z.label;
}
export function seasonPanel(ctx, se) {
  if (!se || !se.teams || !se.teams.length || !se.zones || !se.zones.length) return "";
  if (!se.remaining) {
    const cup = se.zones.some((z) => z.key === "top8");
    return '<div class="panel season-panel"><h2>' + (cup ? t("Fase a girone unico conclusa") : t("Stagione conclusa")) + '</h2><p class="expl">' +
      (cup ? t("La classifica della fase a girone unico è definitiva.") : t("Non restano partite di campionato da giocare.")) + "</p></div>";
  }
  return '<div class="panel season-panel"><h2>' + t("Come può finire la stagione") + '</h2><p class="lead" style="margin:0 0 10px">' +
    t("Il modello ha giocato {n} volte le {left} partite che restano, partendo dalla classifica di oggi. A parità di punti contano {tiebreak} (non gli scontri diretti). Sono probabilità, non certezze.",
      { n: thousandsIt(se.n_sim), left: esc(se.remaining), tiebreak: esc(t(se.tiebreak || "differenza reti e gol fatti")) }) + "</p>" +
    '<table class="season-table"><thead><tr><th>' + t("Squadra") + "</th><th>" + t("Pos. media") + "</th>" +
    se.zones.map((z) => "<th>" + esc(zoneLabel(z)) + "</th>").join("") + "</tr></thead><tbody>" +
    se.teams.map((r) => '<tr data-team-row="' + esc(r.team) + '"><td>' + (isFav(ctx, r.team) ? starHtml() : "") + teamLink(ctx, r.team) + "</td><td>" + decimalIt(r.pos_avg) + "</td>" +
      se.zones.map((z) => { const v = r[z.key] || 0; return '<td class="pct"><i style="width:' + Math.round(v * 100) + '%"></i><span>' + seasonPct(r[z.key]) + "</span></td>"; }).join("") + "</tr>").join("") +
    "</tbody></table></div>";
}

/* ---------- Storico ---------- */
export function recapPanel(r) {
  if (!r || !r.n) return "";
  const range = r.from === r.to ? fmtDay(r.from) : fmtDay(r.from) + " – " + fmtDay(r.to);
  const rows = (list, right) => '<div class="team-list">' + list.map((x) => "<div><span>" + esc(x.match) + " · " + esc(x.score) + "</span><b>" + right(x) + "</b></div>").join("") + "</div>";
  return '<div class="panel recap-panel"><h2>' + t("Com’è andata l’ultima giornata") + '</h2><p class="expl">' + esc(range) + " · " + t("esito azzeccato <b>{hit} su {n}</b> ({rate})", { hit: r.hit, n: r.n, rate: pc(r.rate) }) +
    (r.exact ? " · " + (r.exact === 1 ? t("risultato esatto indovinato {n} volta", { n: r.exact }) : t("risultato esatto indovinato {n} volte", { n: r.exact })) : "") + "</p>" +
    (r.surprises && r.surprises.length ? '<h3 class="sub2" style="font-size:16px;margin:12px 0 6px">' + t("Le sorprese") + "</h3>" + rows(r.surprises, (x) => t("esito dato al {p}", { p: pc(x.p_actual) })) : "") +
    (r.best && r.best.length ? '<h3 class="sub2" style="font-size:16px;margin:12px 0 6px">' + t("Le previsioni migliori") + "</h3>" + rows(r.best, (x) => t("{pick} al {p}", { pick: esc(x.pick), p: pc(x.pick_p) }) + " ✓") : "") +
    "</div>";
}
function verdictPanel(h) {
  const n = h.n || 0;
  if (!n) return "";
  const rate = h.hit / n, br = h.base_rates || {};
  const top = ["1", "X", "2"].reduce((a, k) => ((br[k] || 0) > (br[a] || 0) ? k : a), "1");
  const names = { 1: t("la vittoria della squadra di casa"), X: t("il pareggio"), 2: t("la vittoria della squadra in trasferta") };
  let first = t("Su {n} partite il modello ha indovinato l’esito (1, X o 2) nel {rate} dei casi.", { n, rate: pc(rate) });
  if (br[top] != null) first += " " + t("Scegliendo sempre {name} si indovinerebbe circa il {p}.", { name: names[top], p: pc(br[top]) });
  let second = "";
  if (h.brier != null && h.brier_base) {
    const d = 1 - h.brier / h.brier_base;
    second = d > 0.005 ? " " + t("Le sue percentuali sbagliano il {d}% in meno di quelle ricavate dalle sole medie del campionato.", { d: Math.round(d * 100) })
      : d < -0.005 ? " " + t("Per ora le sue percentuali non fanno meglio delle sole medie del campionato.")
        : " " + t("Per ora le sue percentuali valgono quanto le sole medie del campionato.");
  }
  const caveat = n < 30 ? t("Con meno di 30 partite è solo un primo assaggio: i numeri possono cambiare molto.")
    : n < 100 ? t("Con {n} partite il quadro è indicativo; diventa solido verso le 100.", { n })
      : t("Il campione è abbastanza ampio per fidarsi del confronto.");
  return '<div class="verdict"><h2>' + t("In breve") + "</h2><p>" + esc(first + second) + "</p><p>" + esc(caveat) + "</p></div>";
}
/* Fasce della calibrazione ("sotto 45%", "45-55%", "65% o più"). */
const calLabel = (s) => (isEn() ? String(s).replace(/^sotto /, "under ").replace(/ o più$/, " or more") : s);
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
  g += '<text x="' + ((L + W - R) / 2) + '" y="' + (H - 4) + '" text-anchor="middle">' + t("Probabilità dichiarata") + "</text>";
  g += '<text x="12" y="' + ((T + H - B) / 2) + '" text-anchor="middle" transform="rotate(-90 12 ' + ((T + H - B) / 2) + ')">' + t("Successi reali") + "</text>";
  cal.forEach((b) => {
    const r = 4 + Math.min(7, Math.sqrt(b.n || 1));
    g += '<circle class="dot" cx="' + x(b.avg_p) + '" cy="' + y(b.hit) + '" r="' + r.toFixed(1) + '"><title>' + t("{label}: detto {said}, reale {real} su {n} partite", { label: esc(calLabel(b.label)), said: pc(b.avg_p), real: pc(b.hit), n: esc(b.n) }) + "</title></circle>";
    g += '<text class="lbl" x="' + (x(b.avg_p) + r + 3) + '" y="' + (y(b.hit) + 3) + '">' + esc(b.n) + "</text>";
  });
  return '<div class="cal-chart"><svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + t("Calibrazione: probabilità dichiarate contro successi reali") + '">' + g + "</svg></div>";
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
  if (items.length < 2) return '<p style="margin:0">' + t("Servono almeno 2 risultati.") + "</p>";
  const W = 320, H = 110, L = 8, R = 8, T = 8, B = 22, w = W - L - R, hg = H - T - B;
  const pts = items.map((x, i) => ({ x: L + (i / (items.length - 1)) * w, y: T + (x.ok ? 0.18 : 0.82) * hg }));
  const line = '<polyline points="' + pts.map((p) => p.x + "," + p.y).join(" ") + '" fill="none" stroke="#4da7ff" stroke-width="2.5"/>';
  const dots = pts.map((p) => '<circle cx="' + p.x + '" cy="' + p.y + '" r="3.5" fill="' + (p.y < T + hg / 2 ? "#72e2bb" : "#ff7a6b") + '"/>').join("");
  return '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + t("Andamento degli ultimi pronostici") + '">' + line + dots + '<text x="8" y="' + (H - 5) +
    '" class="market-cal-label">' + t("meno recente") + '</text><text x="' + (W - 8) + '" y="' + (H - 5) + '" text-anchor="end" class="market-cal-label">' + t("più recente") + "</text></svg>";
}
function modelScorePanel(h) {
  const r = modelReliability(h);
  if (!r) return '<div class="model-score"><div class="model-score-kicker">' + t("Affidabilità del modello") + '</div><div class="model-score-label">' + t("Campione in costruzione") + '</div><p style="margin-top:5px;color:#8ea5bd;font-size:11px">' + t("Servono risultati reali per calcolare un punteggio affidabile. Nessun correttivo viene applicato.") + "</p></div>";
  const label = r.score >= 75 ? t("Modello affidabile") : r.score >= 55 ? t("Modello da monitorare") : t("Modello in osservazione");
  const trend = (h.performance && h.performance.recent_rate != null) ? h.performance.recent_rate - (h.performance.overall_rate || r.rate) : 0;
  return '<div class="model-score"><div class="model-score-head"><div><div class="model-score-kicker">' + t("Affidabilità globale · {n} partite", { n: r.n }) + '</div><div class="model-score-label">' + label +
    '</div></div><div class="model-score-number">' + r.score + '/100</div></div><div class="model-score-track"><span style="width:' + r.score + '%"></span></div><div class="model-score-grid">' +
    '<div class="model-score-mini"><b>' + pc(r.rate) + "</b><span>" + t("Precisione 1X2") + "</span></div>" +
    '<div class="model-score-mini"><b>' + Math.round(r.calibration) + "/100</b><span>" + t("Calibrazione") + "</span></div>" +
    '<div class="model-score-mini"><b>' + Math.round(r.brier) + "/100</b><span>" + t("Qualità Brier") + "</span></div></div>" +
    '<div class="model-trend"><h3>' + t("Forma recente") + "</h3><p>" + ((trend > 0.04) ? t("Le ultime partite sono sopra la media storica.") : (trend < -0.04) ? t("Le ultime partite sono sotto la media storica.") : t("Le ultime partite sono in linea con la media.")) +
    "</p>" + modelTrendSvg(h) + "</div></div>";
}
function backtestPanel(h) {
  const b = h.backtest;
  if (!b || !b.n) return '<div class="backtest"><div class="backtest-head"><h3>' + t("Laboratorio · retrospettiva") + "</h3><span>" + t("in attesa") + '</span></div><p class="backtest-note">' + t("Servono pronostici storici salvati prima delle partite per confrontare il modello su finestre consecutive.") + "</p></div>";
  const labels = [["10", t("Ultime 10")], ["25", t("Ultime 25")], ["50", t("Ultime 50")]];
  const cards = labels.map((x) => {
    const v = b.windows[x[0]], rate = v.rate == null ? 0 : v.rate;
    return '<div class="bt-card"><b>' + (v.rate == null ? "—" : pc(v.rate)) + "</b><small>" + x[1] + " · " + t("{n} partite", { n: v.n }) + (v.available ? "" : t(" · campione incompleto")) +
      '</small><div class="bt-bar"><span style="width:' + Math.round(rate * 100) + '%"></span></div><small>Brier ' + (v.brier == null ? "—" : d2(v.brier)) + "</small></div>";
  }).join("");
  const markets = Object.keys(b.markets || {}).map((k) => [k, b.markets[k]]).sort((a, c) => (c[1].n || 0) - (a[1].n || 0)).slice(0, 10);
  const rows = markets.map((x) => { const v = x[1]; return '<div class="bt-market-row"><b>' + esc(marketText(x[0])) + "</b><span>" + v.hit + "/" + v.n + "</span><span>" + pc(v.rate) + "</span><span>gap " + (v.gap >= 0 ? "+" : "") + pc(v.gap) + "</span></div>"; }).join("");
  return '<div class="backtest"><div class="backtest-head"><h3>' + t("Laboratorio · retrospettiva") + "</h3><span>" + t("{n} pronostici", { n: b.n }) + '</span></div><p class="backtest-note">' + t("Confronto sui pronostici effettivamente salvati prima dell'esito. Non vengono ricostruite previsioni a posteriori.") + '</p><div class="bt-grid">' +
    cards + "</div>" + (rows ? '<div class="bt-market"><div class="bt-market-row"><b>' + t("Mercato") + "</b><span>Hit</span><span>" + t("Reale") + "</span><span>Gap</span></div>" + rows + "</div>" : "") + "</div>";
}
/* Categorie di mercato dello storico ("1X2", "Gol", "Over/Under", "Combo", "Risultato esatto"). */
const marketGroup = (k) => (k === "Gol" ? (isEn() ? "Both score" : k) : t(k));
function marketPerformancePanel(h) {
  const mp = h.market_performance || {}, order = ["1X2", "Gol", "Over/Under", "Combo", "Risultato esatto"];
  const entries = order.filter((k) => mp[k]);
  if (!entries.length) return '<div class="panel" style="margin-top:14px"><h2>' + t("Affidabilità per mercato") + '</h2><p class="expl">' + t("Stiamo ancora raccogliendo risultati reali: nessun correttivo viene applicato alle scelte del modello.") + "</p></div>";
  const reliability = (v) => { if (!v.ready || (v.matches || 0) < 30) return null; const cal = 1 - Math.min(1, Math.abs(v.calibration_gap || 0)); const bri = 1 - Math.min(1, Math.max(0, v.brier || 0)); return Math.round((cal * 0.7 + bri * 0.3) * 100); };
  const cards = entries.map((k) => {
    const v = mp[k], score = reliability(v), pct = score == null ? 0 : score;
    return '<div class="market-perf-card ' + (score == null ? "warn" : "") + '"><div class="market-perf-top"><span class="market-perf-name">' + esc(marketGroup(k)) + '</span><span class="market-perf-score">' + (score == null ? "—" : score + "/100") +
      '</span></div><div class="market-perf-track"><span style="width:' + pct + '%"></span></div><div class="market-perf-meta"><span>' + t("{hit} su {n} selezioni · {matches} partite", { hit: v.hit, n: v.n, matches: v.matches == null ? "—" : v.matches }) +
      "</span><span>" + t("prev.") + " " + pc(v.avg_p) + "</span><span>" + t("reale") + " " + pc(v.rate) + "</span></div></div>";
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
  const dots = points.map((p) => '<circle class="market-cal-dot" cx="' + p.x + '" cy="' + p.y + '" r="4"/><text x="' + p.x + '" y="' + (p.y - 8) + '" text-anchor="middle" class="market-cal-label">' + esc(marketGroup(p.k)) + "</text>").join("");
  const diag = '<line x1="' + L + '" y1="' + (T + innerH) + '" x2="' + (L + innerW) + '" y2="' + T + '" stroke="rgba(255,255,255,.22)" stroke-dasharray="4 4"/>';
  const chart = ready ? '<div class="market-cal-chart"><h3>' + t("Curva predetto · reale") + "</h3><p>" + t("Ogni punto confronta la probabilità media dichiarata con la frequenza reale. La diagonale tratteggiata indica una calibrazione perfetta.") + '</p><svg viewBox="0 0 ' + W + " " + H +
    '" role="img" aria-label="' + t("Curva di calibrazione del modello") + '">' + grid + diag + curve + dots + "</svg></div>" : "";
  return '<div class="panel" style="margin-top:14px"><h2>' + t("Affidabilità per mercato") + '</h2><p class="expl">' + t("Indicatore 0–100 costruito da calibrazione e Brier score. È un indicatore descrittivo, non una garanzia di rendimento. Le scelte del modello usano lo storico solo quando ci sono almeno 10 osservazioni per categoria.") + '</p><div class="market-perf-grid">' +
    cards + "</div>" + chart + '<div class="panel" style="margin-top:12px;padding:12px"><p class="lead" style="margin:0">' +
    (ready ? t("Calibrazione storica attiva per {n} categorie.", { n: ready }) : t("Campione ancora insufficiente: il sistema continua a raccogliere dati senza modificare le probabilità del modello.")) + "</p></div></div>";
}

/* Tutte le parti della pagina Storico: { lead, verdict, recap, hero, sum, quality, hist }. */
export function storicoParts(h) {
  const out = { lead: t("Ogni pronostico viene salvato prima della partita e confrontato con il risultato."), verdict: "", recap: "", hero: "", sum: "", quality: "", hist: "" };
  if (!h) return out;
  if (h.demo) out.lead = t("Esempio dimostrativo. Con i dati reali qui compaiono i pronostici salvati prima di ogni partita e confrontati con il risultato.");
  if (!h.n) {
    out.hero = '<div class="hist-kicker">' + t("Performance del modello") + '</div><div style="margin-top:8px;font-family:var(--font-display);font-size:30px;font-weight:800">' + t("Nessun dato ancora") + '</div><p class="hist-caption">' + t("Quando saranno disponibili risultati reali, qui vedrai precisione, andamento e qualità delle probabilità.") + "</p>";
    out.sum = '<div class="stat wide"><div class="k">' + t("Ancora vuoto") + '</div><div class="s">' + t("Appena si giocano le partite pronosticate, compare il confronto.") + "</div></div>";
    return out;
  }
  out.verdict = verdictPanel(h);
  out.recap = recapPanel(h.recap);
  const histRate = h.hit / h.n, recent = (h.items || []).slice(0, 12);
  const bars = recent.map((x) => '<i class="' + (x.ok ? "y" : "n") + '" style="height:' + (x.ok ? 78 : 34) + '%"><span>' + (x.ok ? "✓" : "✕") + "</span></i>").join("");
  const perf = h.performance || {};
  const perfLabel = perf.label ? t(perf.label) : (h.n < 30 ? t("Campione in costruzione") : t("Performance"));
  const perfClass = perf.status === "in_forma" ? "ok" : perf.status === "da_monitorare" ? "bad" : "neutral";
  out.hero = '<div class="hist-hero-top"><div><div class="hist-kicker">' + t("Performance del modello") + '</div><div class="hist-rate">' + pc(histRate) + " <small>" + t("1X2 azzeccato") + '</small></div><div class="perf-status ' + perfClass + '">' + esc(perfLabel) +
    '</div><p class="hist-caption">' + t("<b>{hit}</b> pronostici corretti su <b>{n}</b>. Ultime {k}: <b>{rk}</b> corrette.", { hit: h.hit, n: h.n, k: recent.length, rk: (perf.recent_hit != null) ? perf.recent_hit : recent.filter((x) => x.ok).length }) + " " +
    (perf.status === "in_forma" ? t("La forma recente è sopra la media storica.") : perf.status === "da_monitorare" ? t("La forma recente è sotto la media: meglio osservare altri risultati.") : perf.status === "stabile" ? t("La forma recente è in linea con la media.") : t("Servono più partite prima di giudicare la forma.")) +
    '</p></div><div class="hist-ring" style="--rate:' + Math.round(histRate * 100) + '%"><b>' + pc(histRate) + '</b></div></div><div class="hist-bars">' + bars + "</div>";
  out.sum = '<div class="stat"><div class="k">' + t("Esito 1X2 azzeccato") + '</div><div class="v">' + t("{hit} su {n}", { hit: h.hit, n: h.n }) + '</div><div class="s">' + pc(h.hit / h.n) + "</div></div>" +
    '<div class="stat"><div class="k">' + t("Probabilità media dichiarata") + '</div><div class="v">' + pc(h.avg_p) + '</div><div class="s">' + t("se coincide, il modello è calibrato") + "</div></div>";
  if (h.brier != null) {
    const better = h.brier < h.brier_base, diff = Math.abs(1 - h.brier / h.brier_base);
    const cal = (h.calibration || []).map((b) => '<div class="cal"><span>' + esc(calLabel(b.label)) + '</span><span class="decay" style="display:block"><span class="track" style="display:block"><span class="fill" style="width:' + Math.round(b.hit * 100) +
      '%"></span></span></span><span>' + pc(b.avg_p) + "</span><span>" + pc(b.hit) + "</span></div>").join("");
    let cl = "";
    if (h.claude) {
      const c = h.claude, gain = c.brier_stat - c.brier_final;
      cl = '<div class="panel"><h2>' + t("Le notizie aiutano?") + '</h2><p class="expl">' + t("Su {n} partite: con le notizie l'errore è {a}, con la sola statistica {b}.", { n: c.n, a: d2(c.brier_final), b: d2(c.brier_stat) }) + " " +
        (c.n < 30 ? t("Troppo presto per dirlo.") : Math.abs(gain) < 0.003 ? t("Per ora non cambia quasi nulla.") : gain > 0 ? t("Le notizie migliorano le stime.") : t("Le notizie per ora peggiorano le stime.")) +
        " " + t("Esito azzeccato: {a} su {n} con le notizie, {b} su {n} con la sola statistica.", { a: c.hit_final, b: c.hit_stat, n: c.n }) + "</p></div>";
    }
    if (h.versions) {
      const v = h.versions, g2 = v.brier_old - v.brier_new;
      cl += '<div class="panel"><h2>' + t("Modello nuovo o vecchio?") + '</h2><p class="expl">' + t("Su {n} partite, solo statistica: errore {a} per il modello attuale, {b} per la prima versione.", { n: v.n, a: d2(v.brier_new), b: d2(v.brier_old) }) + " " +
        (v.n < 30 ? t("Troppo presto per dirlo.") : Math.abs(g2) < 0.003 ? t("Per ora sono alla pari.") : g2 > 0 ? t("Il modello attuale va meglio.") : t("La prima versione va meglio.")) + "</p></div>";
    }
    const mk = h.markets || {};
    let mkt = "";
    if (mk.ou && mk.ou.n) mkt += '<div class="stat"><div class="k">' + marketText("Over/Under 2,5") + '</div><div class="v">' + t("{hit} su {n}", { hit: mk.ou.hit, n: mk.ou.n }) + '</div><div class="s">' + pc(mk.ou.hit / mk.ou.n) + "</div></div>";
    if (mk.gg && mk.gg.n) mkt += '<div class="stat"><div class="k">' + t("Gol / No Gol") + '</div><div class="v">' + t("{hit} su {n}", { hit: mk.gg.hit, n: mk.gg.n }) + '</div><div class="s">' + pc(mk.gg.hit / mk.gg.n) + "</div></div>";
    out.quality = modelScorePanel(h) + backtestPanel(h) + '<h2 class="sub2">' + t("Qualità del modello") + "</h2>" +
      '<div class="sum"><div class="stat"><div class="k">' + t("Errore del modello") + '</div><div class="v num">' + d2(h.brier) + '</div><div class="s">' + t("più è basso, meglio è") + "</div></div>" +
      '<div class="stat"><div class="k">' + t("Metodo semplice") + '</div><div class="v num">' + d2(h.brier_base) + '</div><div class="s">' + t("solo le medie del campionato") + "</div></div>" + mkt + "</div>" +
      '<div class="panel" style="margin-top:14px"><p class="expl">' + (better
        ? t("Il modello sbaglia il {d}% in meno del metodo semplice.", { d: Math.round(diff * 100) })
        : t("Per ora il modello non fa meglio del metodo semplice ({d}% di errore in più).", { d: Math.round(diff * 100) })) +
      (h.n < 50 ? " " + t("Con {n} partite il dato è ancora ballerino: serve almeno una cinquantina di partite, meglio cento.", { n: h.n }) : "") + "</p></div>" +
      (cal ? '<div class="panel"><h2>' + t("Quando dico 60%, succede?") + "</h2>" + calChart(h.calibration) + '<p class="lead" style="margin:0 0 10px">' + t("Ogni punto è una fascia di pronostici (il numero accanto dice quante partite). Più i punti stanno vicino alla linea tratteggiata, più le percentuali sono affidabili.") + '</p><div class="cal" style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em"><span>' + t("Probabilità") + "</span><span>" + t("Successi") + "</span><span>" + t("Detto") + "</span><span>" + t("Reale") + '</span></div><div style="display:flex;flex-direction:column;gap:8px">' +
        cal + '</div><p class="lead" style="margin:0">' + t("Se \"Detto\" e \"Reale\" sono vicini, le percentuali sono affidabili.") + "</p></div>" : "") + cl;
  }
  out.quality += marketPerformancePanel(h);
  out.hist = (h.items || []).map((x) => "<div><span>" + esc(x.match) + "<small>" + t("{pick} dato al {p} · finale {score}", { pick: esc(x.pick), p: pc(x.p), score: esc(x.score) }) + '</small></span><span class="' + (x.ok ? "ok" : "ko") +
    '" aria-label="' + (x.ok ? t("Azzeccato") : t("Sbagliato")) + '">' + (x.ok ? "✓" : "✕") + "</span></div>").join("");
  return out;
}

/* ---------- Pagina squadra ---------- */
function teamUpcomingPanel(ctx, name, next, rounds) {
  const list = [];
  (rounds || []).forEach((r) => r.matches.forEach((m) => { if (m.home === name || m.away === name) list.push(m); }));
  if (!list.length) return "";
  return '<div class="panel"><h2>' + (next ? t("Le partite dopo") : t("Prossime partite")) + '</h2><div class="nr-panel">' + roundRows(ctx, list, name) + "</div></div>";
}
function teamStatsPanel(name, classifica) {
  const st = classifica && classifica.stats ? classifica.stats[name] : null;
  if (!st) return "";
  const sides = [st.home, st.away];
  if (!(st.home.pg + st.away.pg)) return "";
  const avg = (a, b) => (b ? decimalIt(a / b) : "–");
  const share = (a, b) => (b ? Math.round(a / b * 100) + "%" : "–");
  const row = (label, f) => "<tr><th>" + t(label) + "</th>" + sides.map((s) => "<td>" + f(s) + "</td>").join("") + "</tr>";
  return '<div class="panel"><h2>' + t("Statistiche stagione") + '</h2><table class="team-stats"><thead><tr><th></th><th>' + t("Casa") + "</th><th>" + t("Trasferta") + "</th></tr></thead><tbody>" +
    row("Partite", (s) => s.pg) + row("V · N · P", (s) => s.w + " · " + s.d + " · " + s.l) +
    row("Gol fatti a partita", (s) => avg(s.gf, s.pg)) + row("Gol subiti a partita", (s) => avg(s.ga, s.pg)) +
    row("Senza subire gol", (s) => share(s.clean, s.pg)) + row("Senza segnare", (s) => share(s.blank, s.pg)) +
    row("Almeno 3 gol in partita", (s) => share(s.o25, s.pg)) + row("Segnano entrambe", (s) => share(s.btts, s.pg)) +
    "</tbody></table></div>";
}
const pctArt = (n) => { n = Math.abs(n); return (n === 1 || n === 11 || String(n).charAt(0) === "8") ? "l’" : "il "; };
function vsAverage(v, verb) {
  const d = Math.round((v - 1) * 100);
  if (isEn()) return d === 0 ? "In line with the league average" : (verb === "Segna" ? "Scores " : "Concedes ") + Math.abs(d) + "% " + (d > 0 ? "more" : "less") + " than average";
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
  const tb = (classifica && classifica.table) || [], row = tb.find((r) => r.team === name);
  const rating = classifica && classifica.ratings ? classifica.ratings[name] : null;
  const se = classifica && classifica.season, srow = se && se.teams ? se.teams.find((r) => r.team === name) : null;
  const matches = (turno && turno.matches) || [];
  const next = matches.find((m) => m.home === name || m.away === name);
  const past = ((storico && storico.items) || []).filter((x) => { const parts = String(x.match).split(" – "); return parts[0] === name || parts[1] === name; }).slice(0, 8);
  const on = isFav(ctx, name);
  let html = '<div class="team-head"><div><small>' + esc(leagueByCode(ctx.league).name) + '</small><h2 id="team-title" tabindex="-1">' + esc(name) + "</h2>" +
    (row ? "<small>" + t("{pos} in classifica · {pts} punti in {pg} partite · differenza reti {dr}", { pos: ordinal(row.pos), pts: row.pts, pg: row.pg, dr: (row.gf - row.ga > 0 ? "+" : "") + (row.gf - row.ga) }) + "</small>" : "") +
    '</div><button type="button" class="fav-btn" data-fav="' + esc(name) + '" aria-pressed="' + on + '">' + (on ? t("★ Seguita") : t("☆ Segui")) + "</button></div>";
  if (rating) {
    html += '<div class="team-grid">' +
      '<div class="panel"><div class="k">' + t("Attacco") + '</div><p class="expl" style="margin:4px 0 0">' + vsAverage(rating.att, "Segna") + '</p><div class="team-bar"><i style="width:' + barWidth(rating.att, "high") + '%"></i></div></div>' +
      '<div class="panel"><div class="k">' + t("Difesa") + '</div><p class="expl" style="margin:4px 0 0">' + vsAverage(rating["def"], "Subisce") + '</p><div class="team-bar"><i style="width:' + barWidth(rating["def"], "low") + '%"></i></div></div>' +
      '<div class="panel"><div class="k">' + t("Forma (ultime 5)") + '</div><div style="margin-top:6px">' + chips(rating.form) + "</div></div></div>" +
      '<p class="lead" style="margin:-4px 0 12px">' + t("Forza stimata dal modello tenendo conto degli avversari affrontati: barra più lunga = meglio.") + "</p>";
  }
  if (next) {
    const home = next.home === name, p = next.prob;
    html += '<div class="panel"><h2>' + t("Prossima partita") + '</h2><p class="expl">' + esc(next.home) + " – " + esc(next.away) + " · " + esc(dayOf(next) + " " + when(next)) + "</p>" +
      '<p class="expl">' + t("Vittoria {w} · pareggio {d} · sconfitta {l}", { w: pc(home ? p.p1 : p.p2), d: pc(p.px), l: pc(home ? p.p2 : p.p1) }) + "</p>" +
      '<div class="match-actions"><a class="share-btn ff-btn" href="' + matchUrl(ctx.league, next) + '">' + t("Apri la partita →") + "</a></div></div>";
  }
  html += teamStatsPanel(name, classifica) + teamUpcomingPanel(ctx, name, next, turno && turno.next_rounds);
  if (srow && se.zones && se.zones.length && se.remaining) {
    html += '<div class="panel"><h2>' + t("Come può finire la stagione") + '</h2><div class="team-list">' +
      "<div><span>" + t("Posizione media") + "</span><b>" + t("{avg} (tra {best} e {worst})", { avg: isEn() ? decimalIt(srow.pos_avg) : decimalIt(srow.pos_avg) + "ª", best: ordinal(srow.best), worst: ordinal(srow.worst) }) + "</b></div>" +
      se.zones.map((z) => "<div><span>" + esc(zoneLabel(z)) + "</span><b>" + seasonPct(srow[z.key]) + "</b></div>").join("") +
      '</div><p class="lead" style="margin:8px 0 0">' + t("Su {n} stagioni simulate.", { n: thousandsIt(se.n_sim) }) + "</p></div>";
  }
  if (past.length) {
    html += '<div class="panel"><h2>' + t("Pronostici passati") + '</h2><div class="team-list">' + past.map((x) =>
      "<div><span>" + esc(x.match) + " · " + esc(x.score) + "</span><b>" + t("{pick} al {p}", { pick: esc(x.pick), p: pc(x.p) }) + " " + (x.ok ? "✓" : "✕") + "</b></div>").join("") + "</div></div>";
  }
  if (!row && !rating && !next) html += '<div class="msg">' + t("Dati della squadra non ancora disponibili.") + "</div>";
  return html;
}

/* ---------- Intestazione: etichette sullo stato dei dati ---------- */
export function statusTags(turno, updated) {
  const d = turno || {}, tags = [];
  tags.push(d.demo ? '<span class="tag warn">' + t("Dati di esempio") + "</span>" : '<span class="tag ok">' + t("Dati reali") + "</span>");
  if (d.ai_status === "attiva") tags.push('<span class="tag ok">' + t("Analisi AI attiva") + "</span>");
  else if (d.ai_status === "parziale") tags.push('<span class="tag warn">' + t("AI parzialmente disponibile") + "</span>");
  else if (d.ai_status === "non_disponibile") tags.push('<span class="tag warn">' + t("Solo statistica · AI non disponibile") + "</span>");
  else tags.push('<span class="tag">' + t("Solo statistica") + "</span>");
  if (updated) tags.push('<span class="tag">' + t("Aggiornato") + " " + esc(updated) + "</span>");
  return tags.join("");
}
