/* Calcoli del sito sulle probabilità già pubblicate dal modello Python.
   Copiati senza cambiare la logica da static/index.html: nessun numero nuovo viene inventato qui.
   Le etichette passano da t() (src/lib/i18n.js): in italiano restano identiche. */
import { t, isEn } from "./i18n.js";

/* Nome di un mercato nella lingua corrente ("Over 2,5", "Gol + Over 2,5" → "Over 2.5", "Both score + Over 2.5"). */
export function marketText(s) {
  if (!isEn()) return s;
  return String(s).replace(/Ris\. esatto/g, "Exact score").replace(/\bNo Gol\b/g, "Not both score").replace(/\bGol\b/g, "Both score").replace(/(\d),(\d)/g, "$1.$2");
}
/* Etichette "codice · descrizione" dei mercati, come le scrive il modello Python. */
const LABELS = {
  "1": "1 · Vince {home}", X: "X · Pareggio", "2": "2 · Vince {away}",
  "1X": "1X · {home} non perde", X2: "X2 · {away} non perde",
  "Over 1,5": "Over 1,5 · almeno 2 gol", "Over 2,5": "Over 2,5 · almeno 3 gol",
  "Under 2,5": "Under 2,5 · massimo 2 gol", "Under 3,5": "Under 3,5 · massimo 3 gol",
  Gol: "Gol · entrambe segnano", "No Gol": "No Gol · almeno una resta a 0",
  score: "Risultato esatto · {score}", "Ris. esatto": "Risultato esatto · {score}"
};
const marketLabel = (code, m, score) => t(LABELS[code], { home: m.home, away: m.away, score });
/* Etichetta di una selezione già pronta (anche quelle scritte in italiano dal modello Python, es.
   recommendation.best): in inglese si ricostruisce dal codice. */
export function recLabel(x, m) {
  if (!isEn() || !x) return x && x.label;
  if (LABELS[x.code] && m) {
    const z = /(\d+-\d+)\s*$/.exec(x.label || "");
    return marketLabel(x.code, m, z ? z[1] : "");
  }
  return marketText(x.label);
}

/* Esito 1X2 più probabile: [codice, nome, probabilità]. */
export function finalOutcome(m) {
  const p = m.prob;
  return p.p1 >= p.px && p.p1 >= p.p2 ? ["1", m.home, p.p1]
    : (p.px >= p.p1 && p.px >= p.p2 ? ["X", t("Pareggio"), p.px] : ["2", m.away, p.p2]);
}
/* Variante usata dalla Home (a parità tra X e 2 preferisce X): mantenuta per avere lo stesso risultato. */
export function homeOutcome(m) {
  const p = m.prob;
  return p.p1 >= p.px && p.p1 >= p.p2 ? ["1", m.home, p.p1] : p.px >= p.p2 ? ["X", t("Pareggio"), p.px] : ["2", m.away, p.p2];
}
export function prudentChoice(m) {
  const p = m.prob;
  return p.p1 + p.px >= p.px + p.p2 ? ["1X", p.p1 + p.px] : ["X2", p.px + p.p2];
}
/* Risultato previsto mostrato dal sito: [casa, trasferta, probabilità].
   Dal 29/10/2026 è il punteggio più probabile tra quelli in linea con l'esito 1X2 più probabile
   (pick_score, app/model.py): il singolo punteggio più probabile era quasi sempre 1-1, anche con una
   squadra nettamente favorita. Se pick_score manca (dati vecchi) o non torna con l'esito, resta top_scores[0]. */
const outcomeOf = (z) => (z[0] > z[1] ? "1" : z[0] === z[1] ? "X" : "2");
export function mainScore(m) {
  const z = m && m.pick_score, top = m && m.top_scores && m.top_scores[0];
  const ok = Array.isArray(z) && z.length >= 3 && [z[0], z[1], z[2]].every(Number.isFinite) && m.prob && outcomeOf(z) === finalOutcome(m)[0];
  return ok ? z : top || null;
}
/* Gli altri punteggi più probabili (al massimo 3), senza quello mostrato: l'1-1 resta visibile qui. */
export const otherScores = (m) => {
  const s = mainScore(m);
  return ((m && m.top_scores) || []).filter((x) => !s || x[0] !== s[0] || x[1] !== s[1]).slice(0, 3);
};
export const strength = (m) => Math.max(m.prob.p1, m.prob.px, m.prob.p2);
export const byStrength = (matches) => matches.slice().sort((a, b) => strength(b) - strength(a));

/* Selezione più probabile di una partita per "Più probabili". nodc: esclude doppia chance, Over 1,5 e Under 3,5. */
export function best(m, nodc) {
  const p = m.prob;
  const o = [
    ["1", t("Vince {team}", { team: m.home }), p.p1], ["2", t("Vince {team}", { team: m.away }), p.p2],
    ["1X", t("{team} non perde", { team: m.home }), p.p1 + p.px], ["X2", t("{team} non perde", { team: m.away }), p.p2 + p.px],
    ["Over 1,5", t("Almeno 2 gol"), p.o15], ["Under 3,5", t("Al massimo 3 gol"), p.u35],
    ["Over 2,5", t("Almeno 3 gol"), p.o25], ["Under 2,5", t("Al massimo 2 gol"), p.u25],
    ["Gol", t("Segnano entrambe"), p.gg], ["No Gol", t("Non segnano entrambe"), p.ng]
  ].filter((x) => !(nodc && (x[0] === "1X" || x[0] === "X2" || x[0] === "Over 1,5" || x[0] === "Under 3,5")))
    .sort((a, b) => b[2] - a[2])[0];
  return { m: m.home + " – " + m.away, code: o[0], label: o[1], p: o[2] };
}
export const computePicks = (matches, nodc) => matches.map((m) => best(m, nodc)).sort((a, b) => b.p - a.p);

export function deriveSlipMarkets(xg) {
  if (!xg || xg.length < 2) return {};
  const lh = Number(xg[0]) || 0, la = Number(xg[1]) || 0, cells = [];
  let total = 0;
  const pois = (l, k) => { let v = Math.exp(-l); for (let z = 1; z <= k; z++) v *= l / z; return v; };
  for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) {
    let p = pois(lh, i) * pois(la, j);
    if (i === j && i <= 1) p *= 1.08; else if (i + j === 1) p *= 0.94;
    cells.push([i, j, p]); total += p;
  }
  const q = { "1x_o15": 0, "x2_o15": 0, "1_o15": 0, "2_o15": 0, "1x_u35": 0, "x2_u35": 0, "gg_o25": 0, "ng_u35": 0 };
  cells.forEach(([i, j, raw]) => {
    const p = raw / total;
    if (i >= j && i + j >= 2) q["1x_o15"] += p;
    if (j >= i && i + j >= 2) q["x2_o15"] += p;
    if (i > j && i + j >= 2) q["1_o15"] += p;
    if (j > i && i + j >= 2) q["2_o15"] += p;
    if (i >= j && i + j <= 3) q["1x_u35"] += p;
    if (j >= i && i + j <= 3) q["x2_u35"] += p;
    if (i > 0 && j > 0 && i + j >= 3) q["gg_o25"] += p;
    if ((i === 0 || j === 0) && i + j <= 3) q["ng_u35"] += p;
  });
  return q;
}
const marketsOf = (m) => (m.markets && Object.keys(m.markets).length ? m.markets : deriveSlipMarkets(m.xg));

export function deriveRecommendation(m) {
  if (m.recommendation && m.recommendation.best) return m.recommendation;
  const p = m.prob || {}, q = marketsOf(m), z = mainScore(m);
  let a = [
    { code: "1", label: marketLabel("1", m), p: p.p1, kind: "esito" },
    { code: "X", label: marketLabel("X", m), p: p.px, kind: "esito" },
    { code: "2", label: marketLabel("2", m), p: p.p2, kind: "esito" },
    { code: "1X", label: marketLabel("1X", m), p: p.p1 + p.px, kind: "doppia" },
    { code: "X2", label: marketLabel("X2", m), p: p.p2 + p.px, kind: "doppia" },
    { code: "Over 2,5", label: marketLabel("Over 2,5", m), p: p.o25, kind: "gol" },
    { code: "Under 3,5", label: marketLabel("Under 3,5", m), p: p.u35, kind: "gol" },
    { code: "Gol", label: marketLabel("Gol", m), p: p.gg, kind: "gol" },
    { code: "No Gol", label: marketLabel("No Gol", m), p: p.ng, kind: "gol" },
    { code: "1_o15", label: marketText("1 + Over 1,5"), p: q["1_o15"], kind: "combo" },
    { code: "2_o15", label: marketText("2 + Over 1,5"), p: q["2_o15"], kind: "combo" },
    { code: "1x_o15", label: marketText("1X + Over 1,5"), p: q["1x_o15"], kind: "combo" },
    { code: "x2_o15", label: marketText("X2 + Over 1,5"), p: q["x2_o15"], kind: "combo" },
    { code: "gg_o25", label: marketText("Gol + Over 2,5"), p: q["gg_o25"], kind: "combo" }
  ];
  if (z) a.push({ code: "score", label: marketLabel("score", m, z[0] + "-" + z[1]), p: Number(z[2] || 0), kind: "score" });
  a = a.filter((x) => x.p > 0);
  const w = { esito: 1, doppia: 0.99, gol: 1.015, combo: 1.035, score: 0.9 };
  a.sort((x, y) => y.p * w[y.kind] - x.p * w[x.kind]);
  const simple = a.filter((x) => x.kind === "esito" || x.kind === "doppia").sort((x, y) => y.p - x.p)[0] || a[0];
  let top = a[0] || simple;
  if ((top.kind === "combo" || top.kind === "gol") && top.p < 0.55) top = simple;
  if (top.kind === "score" || top.p < 0.5) top = simple;
  return { best: top, alternatives: a.slice(0, 6) };
}

/* ---------- Le scelte del modello (Facile · Media · Difficile) ---------- */
export function slipReason(x) {
  const m = x.match || {}, xg = m.xg || [], total = (Number(xg[0]) || 0) + (Number(xg[1]) || 0);
  const code = x.code || "";
  const sum = total.toFixed(2);
  if (code === "Gol") return t("xG combinati {xg} · entrambe le squadre hanno una probabilità favorevole di segnare.", { xg: sum });
  if (code === "No Gol") return t("Il modello vede una buona probabilità che almeno una delle due squadre resti a 0.");
  if (code.indexOf("Over") === 0) return t("Produzione offensiva stimata favorevole: xG combinati {xg}.", { xg: sum });
  if (code.indexOf("Under") === 0) return t("Il modello stima un volume di gol contenuto: xG combinati {xg}.", { xg: sum });
  if (code.indexOf("+") >= 0) return t("Combo coerente con la distribuzione dei punteggi del modello e con le probabilità dei mercati coinvolti.");
  if (code === "Ris. esatto") return t("È il risultato esatto con la maggiore probabilità nella matrice dei punteggi.");
  if (code === "1X" || code === "X2") return t("La doppia chance raccoglie due esiti e offre una copertura più ampia rispetto al segno singolo.");
  if (code === "1" || code === "2" || code === "X") return t("È l'esito con maggiore forza nella stima 1X2 del modello.");
  return t("Selezione derivata dalla probabilità complessiva e dalla raccomandazione multi-mercato del modello.");
}

export function marketReliability(x, marketPerformance, backtestMarkets) {
  const exact = backtestMarkets[x.code];
  const type = x.kind === "score" ? "Risultato esatto" : x.kind === "combo" ? "Combo" : x.kind === "gol" ? "Gol" : "1X2";
  const perf = exact && exact.n >= 30 ? exact : marketPerformance[type] || null;
  if (!perf || !perf.n) return { score: null, n: 0, ready: false, source: "in attesa" };
  const gap = Math.abs(perf.gap != null ? perf.gap : (perf.calibration_gap || 0));
  const score = Math.round(Math.max(0, Math.min(100, (1 - gap) * 70 + (1 - Math.min(1, perf.brier || 0)) * 30)));
  const exactReady = !!(exact && exact.n >= 30), matches = exactReady ? exact.n : (perf.matches || 0);
  return { score, n: perf.n, matches, ready: matches >= 30, source: exactReady ? "mercato" : "categoria" };
}

function historicalMarketBoost(x, marketPerformance) {
  const type = x.kind === "score" ? "Risultato esatto" : x.kind === "combo" ? "Combo" : x.kind === "gol" ? "Gol"
    : x.kind === "doppia" || x.kind === "base" || x.kind === "esito" ? "1X2" : "";
  const perf = marketPerformance[type];
  if (!perf || !perf.ready || (perf.matches || 0) < 30) return 1;
  const gap = Math.max(-0.08, Math.min(0.08, (perf.calibration_gap || 0)));
  return 1 + gap * 0.6;
}

/* Sceglie le selezioni delle "scelte del modello". mode: facile | media | difficile; n: numero di selezioni. */
export function modelSlipPicks(matches, mode, n, marketPerformance = {}) {
  const all = [], used = {}, picks = [];
  matches.forEach((m) => {
    const rec = deriveRecommendation(m), p = m.prob || {}, q = marketsOf(m);
    const a = [
      ["1X", marketLabel("1X", m), p.p1 + p.px, "base"],
      ["X2", marketLabel("X2", m), p.p2 + p.px, "base"],
      ["1", marketLabel("1", m), p.p1, "base"],
      ["X", marketLabel("X", m), p.px, "base"],
      ["2", marketLabel("2", m), p.p2, "base"],
      ["Over 1,5", marketLabel("Over 1,5", m), p.o15, "gol"],
      ["Over 2,5", marketLabel("Over 2,5", m), p.o25, "gol"],
      ["Under 2,5", marketLabel("Under 2,5", m), p.u25, "gol"],
      ["Under 3,5", marketLabel("Under 3,5", m), p.u35, "gol"],
      ["Gol", marketLabel("Gol", m), p.gg, "gol"],
      ["No Gol", marketLabel("No Gol", m), p.ng, "gol"],
      ["1 + Over 1,5", "1 + Over 1,5", q["1_o15"], "combo"],
      ["2 + Over 1,5", "2 + Over 1,5", q["2_o15"], "combo"],
      ["1X + Over 1,5", "1X + Over 1,5", q["1x_o15"], "combo"],
      ["X2 + Over 1,5", "X2 + Over 1,5", q["x2_o15"], "combo"],
      ["1X + Under 3,5", "1X + Under 3,5", q["1x_u35"], "combo"],
      ["X2 + Under 3,5", "X2 + Under 3,5", q["x2_u35"], "combo"],
      ["Gol + Over 2,5", "Gol + Over 2,5", q["gg_o25"], "combo"],
      ["No Gol + Under 3,5", "No Gol + Under 3,5", q["ng_u35"], "combo"]
    ];
    if (mainScore(m)) {
      const z = mainScore(m);
      a.push(["Ris. esatto", marketLabel("Ris. esatto", m, z[0] + "-" + z[1]), Number(z[2] || 0), "score"]);
    }
    a.forEach((x) => { if (x[2] > 0) all.push({ match: m, m: m.home + " – " + m.away, code: x[0], label: x[1].indexOf(" + ") >= 0 ? marketText(x[1]) : x[1], p: Number(x[2]), kind: x[3] }); });
    if (rec.best) all.push({ match: m, m: m.home + " – " + m.away, code: rec.best.code, label: recLabel(rec.best, m), p: Number(rec.best.p), kind: rec.best.kind, recommended: true });
  });
  const cfg = mode === "facile" ? { min: 0.62, max: 1.01, score: false } : mode === "media" ? { min: 0.43, max: 0.82, score: false } : { min: 0.12, max: 0.62, score: true };
  const rank = { score: 0, combo: 1, gol: 2, doppia: 3, esito: 4, base: 4 };
  const score = (x) => {
    const boost = x.recommended ? (mode === "facile" ? 1.12 : mode === "media" ? 1.07 : 1.03) : 1;
    const kindBoost = mode === "facile" ? (x.kind === "doppia" ? 1.02 : x.kind === "gol" ? 1.01 : 1)
      : mode === "difficile" ? (x.kind === "score" ? 1.1 : x.kind === "combo" ? 1.06 : 1) : 1;
    return x.p * boost * kindBoost * historicalMarketBoost(x, marketPerformance);
  };
  const take = (x) => { if (picks.length < n && !used[x.match.id]) { picks.push(x); used[x.match.id] = true; } };
  all.filter((x) => x.p >= cfg.min && x.p <= cfg.max && (cfg.score || x.kind !== "score"))
    .sort((a, b) => { const d = score(b) - score(a); return Math.abs(d) > 1e-9 ? d : (rank[a.kind] || 9) - (rank[b.kind] || 9); })
    .forEach(take);
  if (picks.length < n) all.filter((x) => cfg.score || x.kind !== "score").sort((a, b) => score(b) - score(a)).forEach(take);
  if (picks.length < n && mode === "difficile") all.filter((x) => x.kind === "score").sort((a, b) => b.p - a.p).forEach(take);
  return picks;
}

