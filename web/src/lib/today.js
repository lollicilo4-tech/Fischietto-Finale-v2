/* "Oggi in campo": le partite del giorno di tutti i campionati in una pagina sola, in ordine di orario.
   La pagina arriva già pronta dal build; nel browser scripts/today.js la ricostruisce con l'ora vera,
   così dopo mezzanotte "Oggi" e "Domani" restano giusti anche prima del prossimo aggiornamento.
   Funzioni pure, provate in Node. */
import { LEAGUES, esc, pc, romeParts, dayOf, matchUrl } from "./core.js";
import { finalOutcome } from "./model.js";
import { t } from "./i18n.js";
import { crestSrc, crestImgSrc } from "./crests.js";

const DAY_MS = 24 * 3600 * 1000;
/* Una partita resta in pagina fino a due ore dopo l'inizio, poi è finita (o quasi). */
const KEEP_AFTER_MS = 2 * 3600 * 1000;
export const TODAY_DAYS = 3;  // oggi, domani e dopodomani

/* Dati minimi di ogni partita in programma: [{ league, flag, name, id, home, away, kickoff, p1, px, p2, conf, pick, score, url }]. */
export function todayItems(turni) {
  const out = [];
  LEAGUES.forEach((l) => {
    const turno = turni[l.code];
    ((turno && turno.matches) || []).forEach((m) => {
      if (!m || !m.kickoff || !m.prob || !Number.isFinite(Date.parse(m.kickoff))) return;
      const fo = finalOutcome(m), s = m.top_scores && m.top_scores[0];
      out.push({
        league: l.code, flag: l.flag, name: l.name, id: String(m.id), home: m.home, away: m.away, kickoff: m.kickoff,
        p1: m.prob.p1, px: m.prob.px, p2: m.prob.p2, conf: m.conf, pick: [fo[0], fo[1], fo[2]],
        score: s ? s[0] + "-" + s[1] : "", url: matchUrl(l.code, m),
        ch: crestSrc(l.code, m.home), ca: crestSrc(l.code, m.away)
      });
    });
  });
  return out.sort((a, b) => a.kickoff.localeCompare(b.kickoff) || a.home.localeCompare(b.home));
}

const dayKey = (value) => { const r = romeParts(value); return r ? r.year + "-" + r.month + "-" + r.day : ""; };

/* Gruppi per giorno, dal giorno di `now` per TODAY_DAYS giorni: [{ key, label, items }]. */
export function todayGroups(items, now = Date.now()) {
  const keys = [0, 1, 2].slice(0, TODAY_DAYS).map((d) => dayKey(new Date(now + d * DAY_MS)));
  const groups = keys.map((key, i) => ({ key, label: i === 0 ? t("Oggi") : i === 1 ? t("Domani") : dayOf({ kickoff: new Date(now + i * DAY_MS).toISOString() }), items: [] }));
  (items || []).forEach((x) => {
    const at = Date.parse(x.kickoff);
    if (!Number.isFinite(at) || at < now - KEEP_AFTER_MS) return;
    const g = groups[keys.indexOf(dayKey(x.kickoff))];
    if (g) g.items.push(x);
  });
  return groups;
}

function row(x, now) {
  const started = Date.parse(x.kickoff) <= now;
  const r = romeParts(x.kickoff), time = r ? r.hh + ":" + r.mm : "";
  const cell = (code, p) => "<i" + (x.pick[0] === code ? ' class="hot"' : "") + "><small>" + code + "</small>" + pc(p) + "</i>";
  return '<a class="today-row ff-btn" href="' + esc(x.url) + '">' +
    '<span class="today-time">' + (started ? '<b class="today-started">' + t("Iniziata") + "</b>" : esc(time)) + "</span>" +
    '<span class="today-main"><small>' + esc(x.flag + " " + x.name) + "</small><b>" + crestImgSrc(x.ch, 16, "crest-inline") + esc(x.home) + " – " + crestImgSrc(x.ca, 16, "crest-inline") + esc(x.away) + "</b>" +
    "<small>" + t("Modello: {pick} · probabile {score}", { pick: esc(x.pick[0] + " · " + x.pick[1]) + " " + pc(x.pick[2]), score: esc(x.score) }) + "</small></span>" +
    '<span class="today-p">' + cell("1", x.p1) + cell("X", x.px) + cell("2", x.p2) + "</span></a>";
}

export function todayHtml(items, now = Date.now()) {
  const groups = todayGroups(items, now), total = groups.reduce((n, g) => n + g.items.length, 0);
  if (!total) return '<div class="msg">' + t("Nei prossimi giorni non ci sono partite in programma nei nostri campionati.") + "</div>";
  let html = "";
  if (!groups[0].items.length) html += '<p class="lead">' + t("Oggi non ci sono partite nei nostri campionati: ecco le prossime.") + "</p>";
  groups.filter((g) => g.items.length).forEach((g) => {
    html += '<section class="panel today-day"><div class="today-head"><h2>' + esc(g.label) + "</h2><span>" + t("{n} partite", { n: g.items.length }) + '</span></div><div class="today-list">' +
      g.items.map((x) => row(x, now)).join("") + "</div></section>";
  });
  return html;
}
