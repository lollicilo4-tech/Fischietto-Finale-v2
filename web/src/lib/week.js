/* Riepilogo della settimana: com'è andato il modello negli ultimi 7 giorni, in tutti i campionati insieme.
   Dati: "week" dello storico di ogni campionato (app/store.py week_items), cioè solo pronostici salvati
   prima della partita e confrontati con il risultato finale. Funzioni pure, provate in Node. */
import { LEAGUES, SELECT_ORDER, leagueUrl, esc, pc, romeParts, fmtDay } from "./core.js";
import { t } from "./i18n.js";

export const WEEK_DAYS = 7;
const DAY_MS = 24 * 3600 * 1000;
export const MAX_LIST = 5;

const isoDay = (value) => { const r = romeParts(value); return r ? r.year + "-" + String(r.month + 1).padStart(2, "0") + "-" + String(r.day).padStart(2, "0") : ""; };
const valid = (x) => x && x.home && x.away && Number.isFinite(Date.parse(x.kickoff || "")) && ["1", "X", "2"].includes(x.pick) &&
  Number.isFinite(x.pick_p) && Number.isFinite(x.hg) && Number.isFinite(x.ag) && typeof x.ok === "boolean";

/* Le partite concluse negli ultimi WEEK_DAYS giorni prima di `now`, con il campionato: { [codice]: storico }. */
export function weekItems(storici, now = Date.now()) {
  const out = [], seen = new Set();
  LEAGUES.forEach((l) => {
    const week = storici && storici[l.code] && Array.isArray(storici[l.code].week) ? storici[l.code].week : [];
    week.forEach((x) => {
      const at = valid(x) ? Date.parse(x.kickoff) : NaN;
      const key = l.code + ":" + (x && x.id);
      if (!Number.isFinite(at) || at > now || at < now - WEEK_DAYS * DAY_MS || seen.has(key)) return;
      seen.add(key);
      out.push({ ...x, league: l.code, name: l.name, flag: l.flag });
    });
  });
  return out.sort((a, b) => b.kickoff.localeCompare(a.kickoff) || a.home.localeCompare(b.home));
}

const rank = (code) => { const i = SELECT_ORDER.indexOf(code); return i < 0 ? 99 : i; };

/* Numeri del riepilogo. expected = esiti che il modello si aspettava di azzeccare (somma delle probabilità). */
export function weekSummary(items) {
  const n = items.length, hit = items.filter((x) => x.ok).length;
  const days = items.map((x) => isoDay(x.kickoff)).filter(Boolean).sort();
  const by = new Map();
  items.forEach((x) => {
    if (!by.has(x.league)) by.set(x.league, { code: x.league, name: x.name, flag: x.flag, n: 0, hit: 0 });
    const r = by.get(x.league); r.n++; if (x.ok) r.hit++;
  });
  const leagues = [...by.values()].map((r) => ({ ...r, rate: r.hit / r.n })).sort((a, b) => rank(a.code) - rank(b.code));
  return {
    n, hit, rate: n ? hit / n : 0, exact: items.filter((x) => x.exact).length,
    expected: items.reduce((s, x) => s + x.pick_p, 0),
    from: days[0] || "", to: days[days.length - 1] || "", leagues,
    /* Colpi migliori: prima i risultati esatti, poi gli esiti azzeccati nelle partite più incerte. */
    best: items.filter((x) => x.ok).sort((a, b) => (b.exact - a.exact) || a.pick_p - b.pick_p || a.kickoff.localeCompare(b.kickoff)).slice(0, MAX_LIST),
    /* Flop: gli errori in cui il modello era più convinto. */
    flops: items.filter((x) => !x.ok).sort((a, b) => b.pick_p - a.pick_p || a.kickoff.localeCompare(b.kickoff)).slice(0, MAX_LIST)
  };
}

/* "21 – 27 ottobre", "29 ottobre – 4 novembre", "27 ottobre". */
export function rangeLabel(s) {
  if (!s.from) return "";
  if (s.from === s.to) return fmtDay(s.from);
  const a = fmtDay(s.from), b = fmtDay(s.to);
  return s.from.slice(0, 7) === s.to.slice(0, 7) ? a.split(" ")[0] + " – " + b : a + " – " + b;
}
export const pickName = (x) => (x.pick === "1" ? x.home : x.pick === "2" ? x.away : t("Pareggio"));

/* ---------- HTML ---------- */
function listHtml(list, ok) {
  return '<div class="team-list week-list">' + list.map((x) =>
    "<div><span><small>" + esc(x.flag + " " + x.name) + "</small><b>" + esc(x.home + " – " + x.away) + "</b><small>" +
    t("Modello: {pick} al {p}", { pick: esc(pickName(x)), p: pc(x.pick_p) }) + (x.exact ? " · " + t("risultato esatto") : "") + "</small></span>" +
    '<b class="' + (ok ? "ok" : "ko") + '">' + x.hg + "-" + x.ag + " " + (ok ? "✓" : "✗") + "</b></div>").join("") + "</div>";
}

export function weekHtml(s) {
  if (!s.n) return '<div class="msg">' + t("Negli ultimi 7 giorni non ci sono partite concluse con un pronostico salvato. Il riepilogo torna con le prossime partite.") + "</div>";
  const diff = s.hit - Math.round(s.expected);
  const verdict = diff >= 2 ? t("meglio di quanto si aspettava") : diff <= -2 ? t("peggio di quanto si aspettava") : t("in linea con quanto si aspettava");
  return '<div class="panel week-hero"><p class="week-range">' + esc(rangeLabel(s)) + '</p><p class="week-big"><b>' + s.hit + "</b> " + t("su {n}", { n: s.n }) + " <small>(" + pc(s.rate) + ")</small></p>" +
    '<p class="expl">' + t("esiti azzeccati in tutti i campionati.") + " " + t("Il modello se ne aspettava circa {e}: {verdict}.", { e: Math.round(s.expected), verdict }) +
    (s.exact ? " " + (s.exact === 1 ? t("Risultato esatto indovinato {n} volta.", { n: s.exact }) : t("Risultato esatto indovinato {n} volte.", { n: s.exact })) : "") + "</p></div>" +
    '<div class="panel"><h2>' + t("Campionato per campionato") + '</h2><div class="team-list week-leagues">' +
    s.leagues.map((r) => '<div><span><a href="' + esc(leagueUrl(r.code, "storico")) + '">' + esc(r.flag + " " + r.name) + "</a></span><b>" + t("{hit} su {n}", { hit: r.hit, n: r.n }) + " · " + pc(r.rate) + "</b></div>").join("") + "</div></div>" +
    (s.best.length ? '<div class="panel"><h2>' + t("I colpi migliori") + '</h2><p class="expl">' + t("Risultati esatti ed esiti azzeccati nelle partite più incerte.") + "</p>" + listHtml(s.best, true) + "</div>" : "") +
    (s.flops.length ? '<div class="panel"><h2>' + t("I flop") + '</h2><p class="expl">' + t("Le partite in cui il modello era più convinto e ha sbagliato.") + "</p>" + listHtml(s.flops, false) + "</div>" : "");
}
