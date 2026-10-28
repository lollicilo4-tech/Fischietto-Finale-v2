/* Immagini verticali per storie, Reels e TikTok (1080×1920), rigenerate a ogni build:
   - /social/oggi.png: le partite principali del giorno (al massimo 8, prima i campionati più seguiti);
   - /social/<campionato>.png: le partite del giorno di un campionato (al massimo 10).
   Il giorno è il primo, in ora italiana, con partite non ancora iniziate al momento del build: la sera,
   quando le partite di oggi sono finite, le immagini passano a domani. Sempre in italiano.
   Dati: gli stessi di "Oggi in campo" (src/lib/today.js). */
import { C, h, text, brand, frame, badge, clip, renderPng, pngFrom, STORY, SITE } from "./cardkit.js";
import { crestDataUri } from "./crestpng.js";
import { LEAGUES, SELECT_ORDER, leagueByCode, romeParts, DAYN, MONTHS } from "./core.js";
import { leagueData } from "./data.js";
import { todayItems } from "./today.js";
import { setLang } from "./i18n.js";

export { STORY };
export const SOCIAL_URL = "/social/";
export const MAX_MIXED = 8, MAX_LEAGUE = 10;
/* Un solo "adesso" per tutto il build: la pagina /social/ e le immagini scelgono lo stesso giorno. */
export const BUILD_NOW = Date.now();

const dayKey = (value) => { const r = romeParts(value); return r ? r.year + "-" + String(r.month + 1).padStart(2, "0") + "-" + String(r.day).padStart(2, "0") : ""; };
/* "MERCOLEDÌ 28 OTTOBRE" */
export const dayTitle = (value) => { const r = romeParts(value); return r ? (DAYN[r.wd] + " " + r.day + " " + MONTHS[r.month]).toUpperCase() : ""; };

/* Il giorno delle immagini: { key, title, items } con le partite non ancora iniziate di quel giorno. */
export function socialDay(items, now = BUILD_NOW) {
  const future = (items || []).filter((x) => Date.parse(x.kickoff) > now).sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  if (!future.length) return null;
  const key = dayKey(future[0].kickoff);
  return { key, title: dayTitle(future[0].kickoff), items: future.filter((x) => dayKey(x.kickoff) === key) };
}

const rank = (code) => { const i = SELECT_ORDER.indexOf(code); return i < 0 ? 99 : i; };
/* Le partite principali: prima i campionati più seguiti (ordine del menu), poi in ordine di orario. */
export function topMatches(items, n = MAX_MIXED) {
  return items.slice().sort((a, b) => rank(a.league) - rank(b.league) || a.kickoff.localeCompare(b.kickoff)).slice(0, n)
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff) || rank(a.league) - rank(b.league));
}

/* Le immagini del giorno: [{ slug, file, title, mixed, items, total }]. */
export function socialSets(items, now = BUILD_NOW) {
  const day = socialDay(items, now);
  if (!day) return { day: null, sets: [] };
  const sets = [{ slug: "oggi", title: "PARTITE DEL GIORNO", label: "Partite principali di tutti i campionati", mixed: true, items: topMatches(day.items), total: day.items.length }];
  SELECT_ORDER.forEach((code) => {
    const list = day.items.filter((x) => x.league === code);
    if (list.length) sets.push({ slug: leagueByCode(code).slug, title: leagueByCode(code).name.toUpperCase(), label: leagueByCode(code).name, mixed: false, items: list.slice(0, MAX_LEAGUE), total: list.length });
  });
  sets.forEach((s) => { s.file = SOCIAL_URL + s.slug + ".png"; });
  return { day, sets };
}

/* Tutte le partite in programma, dai JSON pubblicati (in italiano). */
export function allItems() {
  setLang("it");
  return todayItems(Object.fromEntries(LEAGUES.map((l) => [l.code, leagueData(l.code).turno])));
}
export const buildSets = () => socialSets(allItems(), BUILD_NOW);

/* ---------- Disegno ---------- */
const pct = (p) => Math.round(p * 100) + "%";
const time = (k) => { const r = romeParts(k); return r ? r.hh + ":" + r.mm : ""; };

function row(x, s, mixed) {
  const team = (name, crest) => h({ alignItems: "center", gap: 14 }, badge(crest, name, s.crest),
    text({ fontFamily: "Barlow", fontWeight: 700, fontSize: s.name, color: C.fg, textTransform: "uppercase", lineHeight: 1 }, clip(name, 19)));
  const cell = (code, p) => {
    const hot = x.pick[0] === code;
    return h({ flexDirection: "column", alignItems: "center", justifyContent: "center", width: s.cell, height: s.cellH, borderRadius: 16,
      backgroundColor: hot ? C.gold : "#0c1520", border: "2px solid " + (hot ? C.gold : C.line) },
      text({ fontFamily: "Barlow", fontWeight: 700, fontSize: Math.round(s.name * 0.55), color: hot ? C.bg : C.muted, lineHeight: 1 }, code),
      text({ fontFamily: "Barlow", fontWeight: 800, fontSize: Math.round(s.name * 0.95), color: hot ? C.bg : C.fg, lineHeight: 1, marginTop: 2 }, pct(x[code === "1" ? "p1" : code === "X" ? "px" : "p2"])));
  };
  return h({ alignItems: "center", height: s.row, backgroundColor: C.panel, border: "2px solid " + C.line, borderRadius: 24, padding: "0 20px", gap: 18 },
    h({ flexDirection: "column", width: 118, flexShrink: 0 },
      text({ fontFamily: "Barlow", fontWeight: 800, fontSize: s.time, color: C.fg, lineHeight: 1 }, time(x.kickoff)),
      mixed ? text({ fontFamily: "Plex", fontWeight: 600, fontSize: 17, color: C.blue, marginTop: 6 }, clip(x.name, 14)) : null),
    h({ flexDirection: "column", flexGrow: 1, flexShrink: 1, minWidth: 0, gap: s.gap }, team(x.home, x.crests[0]), team(x.away, x.crests[1])),
    h({ gap: 8, flexShrink: 0 }, cell("1", x.p1), cell("X", x.px), cell("2", x.p2)));
}

/* Misure delle righe secondo quante sono (8 o 10 righe devono stare nell'immagine). */
export function rowSizes(n) {
  const area = 1300, gap = 14, rowH = Math.min(176, Math.floor((area - gap * (Math.max(n, 1) - 1)) / Math.max(n, 1)));
  const k = rowH / 176;
  return { row: rowH, crest: Math.round(54 * k), name: Math.round(40 * k), time: Math.round(44 * k), cell: Math.round(96 * k), cellH: Math.round(120 * k), gap: Math.round(14 * k), listGap: gap };
}

export function storyTree(set, day) {
  const s = rowSizes(set.items.length);
  const more = set.total - set.items.length;
  return frame(STORY, { x: 50, top: 70, bottom: 56 }, "80% 0%", [
    h({ justifyContent: "space-between", alignItems: "center" }, brand(40), text({ fontFamily: "Barlow", fontWeight: 700, fontSize: 30, color: C.muted, letterSpacing: 2 }, set.mixed ? "TUTTI I CAMPIONATI" : "PRONOSTICI")),
    h({ flexDirection: "column", marginTop: 34, marginBottom: 30 },
      text({ fontFamily: "Barlow", fontWeight: 800, fontSize: set.title.length > 18 ? 76 : 92, lineHeight: 0.95, color: C.fg }, set.title),
      text({ fontFamily: "Barlow", fontWeight: 800, fontSize: 60, color: C.gold, marginTop: 10 }, day.title),
      text({ fontFamily: "Plex", fontSize: 26, color: C.muted, marginTop: 8 }, "Probabilità 1 X 2 del modello · ora italiana")),
    h({ flexDirection: "column", gap: s.listGap, flexGrow: 1 }, set.items.map((x) => row(x, s, set.mixed))),
    more > 0 ? text({ fontFamily: "Plex", fontWeight: 600, fontSize: 24, color: C.muted, marginTop: 14 }, "+ altre " + more + " partite sul sito") : null,
    h({ justifyContent: "space-between", alignItems: "flex-end", marginTop: 22 },
      h({ flexDirection: "column" },
        text({ fontFamily: "Plex", fontSize: 22, color: C.muted }, "Stime statistiche, non certezze."),
        text({ fontFamily: "Plex", fontSize: 22, color: C.muted }, "Nessun invito a scommettere.")),
      text({ fontFamily: "Barlow", fontWeight: 700, fontSize: 38, color: C.blue }, SITE))]);
}

export async function storyPng(set, day) {
  const items = await Promise.all(set.items.map(async (x) => ({ ...x, crests: await Promise.all([crestDataUri(x.league, x.home, 112), crestDataUri(x.league, x.away, 112)]) })));
  return renderPng(storyTree({ ...set, items }, day), STORY);
}
export const storyResponse = (set, day) => pngFrom("social " + set.slug, () => storyPng(set, day));
