/* Configurazione e funzioni di base condivise tra build (Node) e browser.
   Tutto qui è puro: niente DOM, niente fetch. Indirizzi, numeri e date seguono la lingua
   corrente (src/lib/i18n.js): in italiano restano identici a prima. */
import { isEn, t } from "./i18n.js";

export const LEAGUES = [
  { code: "SA", slug: "serie-a", name: "Serie A", country: "Italia", flag: "🇮🇹", liveKey: "serie-a", file: "" },
  { code: "PL", slug: "premier-league", name: "Premier League", country: "Inghilterra", flag: "🏴", liveKey: "premier-league", file: "league-PL-" },
  { code: "PD", slug: "laliga", name: "LaLiga", country: "Spagna", flag: "🇪🇸", liveKey: "laliga", file: "league-PD-" },
  { code: "BL1", slug: "bundesliga", name: "Bundesliga", country: "Germania", flag: "🇩🇪", liveKey: "bundesliga", file: "league-BL1-" },
  { code: "FL1", slug: "ligue-1", name: "Ligue 1", country: "Francia", flag: "🇫🇷", liveKey: "ligue-1", file: "league-FL1-" },
  { code: "CL", slug: "champions-league", name: "Champions League", country: "Europa", flag: "🏆", liveKey: "champions-league", file: "league-CL-" },
  { code: "EL", slug: "europa-league", name: "Europa League", country: "Europa", flag: "🏆", liveKey: "europa-league", file: "league-EL-" },
  { code: "UECL", slug: "conference-league", name: "Conference League", country: "Europa", flag: "🏆", liveKey: "conference-league", file: "league-UECL-" },
  /* Coppa a eliminazione diretta: turni invece di giornate, nessuna classifica. */
  { code: "CDR", slug: "copa-del-rey", name: "Copa del Rey", country: "Spagna", flag: "🏆", liveKey: "copa-del-rey", file: "league-CDR-", knockout: true },
  /* Aggiunti il 26/10/2026 (piano gratuito di football-data.org). momentum: false = il Worker del
     momentum non li segue (le sue richieste per minuto restano ai campionati principali); nel Live
     compaiono comunque dalla lista di SportScore. */
  { code: "ELC", slug: "championship", name: "Championship", country: "Inghilterra", flag: "🏴", liveKey: "championship", file: "league-ELC-", momentum: false },
  { code: "DED", slug: "eredivisie", name: "Eredivisie", country: "Paesi Bassi", flag: "🇳🇱", liveKey: "eredivisie", file: "league-DED-", momentum: false },
  { code: "PPL", slug: "liga-portugal", name: "Liga Portugal", country: "Portogallo", flag: "🇵🇹", liveKey: "liga-portugal", file: "league-PPL-", momentum: false },
  { code: "BSA", slug: "brasileirao", name: "Brasileirão", country: "Brasile", flag: "🇧🇷", liveKey: "brasileirao", file: "league-BSA-", momentum: false }
];
/* Campionati seguiti dal Worker del momentum (calendario e registrazione minuto per minuto). */
export const MOMENTUM_LEAGUES = LEAGUES.filter((l) => l.momentum !== false);
/* Ordine del menu a tendina nell'intestazione, come nel sito attuale. */
export const SELECT_ORDER = ["SA", "PL", "CL", "BL1", "PD", "FL1", "EL", "UECL", "CDR", "ELC", "DED", "PPL", "BSA"];
export const DEFAULT_LEAGUE = "SA";
/* In inglese la Home del sito (/en/) è la Premier League. */
export const DEFAULT_LEAGUE_EN = "PL";
export const defaultLeague = () => (isEn() ? DEFAULT_LEAGUE_EN : DEFAULT_LEAGUE);

export const leagueByCode = (code) => LEAGUES.find((l) => l.code === code) || null;
export const leagueBySlug = (slug) => LEAGUES.find((l) => l.slug === slug) || null;
/* "giornata" nei campionati e nella fase a girone delle coppe europee, "turno" nelle coppe a eliminazione diretta. */
export const roundWord = (code) => t(leagueByCode(code) && leagueByCode(code).knockout ? "turno" : "giornata");

/* Sezioni di ogni campionato: slug nell'URL (italiano e inglese), id del pannello (usato dal CSS) ed etichetta. */
export const SECTIONS = {
  home: { path: "", en: "", panel: "p-home", label: "Home" },
  partite: { path: "partite/", en: "matches/", panel: "p-partite", label: "Partite" },
  sicure: { path: "piu-probabili/", en: "most-likely/", panel: "p-sicure", label: "Più probabili" },
  schedina: { path: "scelte-del-modello/", en: "model-picks/", panel: "p-schedina", label: "Le scelte del modello" },
  classifica: { path: "classifica/", en: "table/", panel: "p-classifica", label: "Classifica" },
  storico: { path: "storico/", en: "history/", panel: "p-storico", label: "Storico" }
};
/* Parti fisse degli indirizzi: pagina squadra e pagina partita. */
const PART = { squadra: { it: "squadra", en: "team" }, partita: { it: "partita", en: "match" } };

/* ---------- URL del sito ---------- */
export function slugify(text) {
  return String(text || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss").replace(/ø/g, "o").replace(/æ/g, "ae").replace(/ł/g, "l").replace(/đ/g, "d")
    .toLowerCase().replace(/&/g, " e ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "squadra";
}
const prefix = () => (isEn() ? "/en" : "");
const sectionPath = (section) => (isEn() ? SECTIONS[section].en : SECTIONS[section].path);
export const leagueUrl = (league, section = "home") =>
  league === defaultLeague() && section === "home" ? prefix() + "/" : prefix() + "/" + leagueByCode(league).slug + "/" + sectionPath(section);
export const teamUrl = (league, team) => prefix() + "/" + leagueByCode(league).slug + "/" + PART.squadra[isEn() ? "en" : "it"] + "/" + slugify(team) + "/";
export const matchSlug = (m) => String(m.id).replace(/[^0-9A-Za-z_-]/g, "") + "-" + slugify(m.home) + "-" + slugify(m.away);
export const matchUrl = (league, m) => prefix() + "/" + leagueByCode(league).slug + "/" + PART.partita[isEn() ? "en" : "it"] + "/" + matchSlug(m) + "/";
export const liveUrl = (league) => prefix() + "/live/" + (league ? "?lega=" + leagueByCode(league).slug : "");
export const INFO_URL = "/come-funziona/";
export const PRIVACY_URL = "/privacy/";
export const MYPICKS_URL = "/i-miei-pronostici/";
/* Pagine fisse nella lingua corrente. */
export const infoUrl = () => (isEn() ? "/en/how-it-works/" : INFO_URL);
export const privacyUrl = () => (isEn() ? "/en/privacy/" : PRIVACY_URL);
export const myPicksUrl = () => (isEn() ? "/en/my-predictions/" : MYPICKS_URL);
export const homeUrl = () => prefix() + "/";
/* Donazioni libere: un link normale (nessuno script di Ko-fi), così la CSP non cambia. */
export const KOFI_URL = "https://ko-fi.com/fischiettofinale";
export const CONTACT_EMAIL = "info@fischiettofinale.com";

/* Stessa pagina nell'altra lingua, per il selettore di lingua e i link hreflang.
   La Home italiana (/) è la Serie A, quella inglese (/en/) la Premier League. */
const PAGES = [["/come-funziona/", "/en/how-it-works/"], ["/privacy/", "/en/privacy/"], ["/i-miei-pronostici/", "/en/my-predictions/"], ["/live/", "/en/live/"]];
export function altPath(pathname, to) {
  const p = String(pathname || "/");
  const from = to === "en" ? 0 : 1, dest = to === "en" ? 1 : 0;
  const fixed = PAGES.find((x) => x[from] === p);
  if (fixed) return fixed[dest];
  const parts = (from === 1 ? p.replace(/^\/en(?=\/)/, "") : p).split("/").filter(Boolean);
  const home = { it: DEFAULT_LEAGUE, en: DEFAULT_LEAGUE_EN };
  const fromLang = from === 0 ? "it" : "en", toLang = to === "en" ? "en" : "it";
  const pre = toLang === "en" ? "/en" : "";
  const leagueHome = (code) => (code === home[toLang] ? pre + "/" : pre + "/" + leagueByCode(code).slug + "/");
  if (!parts.length) return leagueHome(home[fromLang]);
  const L = leagueBySlug(parts[0]);
  if (!L) return pre + "/";
  if (parts.length === 1) return leagueHome(L.code);
  const key = fromLang === "en" ? "en" : "path";
  const section = Object.keys(SECTIONS).find((k) => k !== "home" && SECTIONS[k][key] === parts[1] + "/");
  if (section) return pre + "/" + L.slug + "/" + SECTIONS[section][toLang === "en" ? "en" : "path"];
  const part = Object.keys(PART).find((k) => PART[k][fromLang] === parts[1]);
  if (part && parts[2]) return pre + "/" + L.slug + "/" + PART[part][toLang] + "/" + parts[2] + "/";
  return leagueHome(L.code);
}

/* ---------- Formattazione (in italiano identica al sito attuale) ---------- */
export const pc = (p) => Math.round(p * 100) + "%";
const dec = (s) => (isEn() ? s : s.replace(".", ","));
export const d1 = (x) => dec(x.toFixed(1));
export const d2 = (x) => (x == null ? "–" : dec(x.toFixed(2)));
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
/* Link e immagini da dati esterni: solo indirizzi http(s), mai javascript: o simili. */
export const safeUrl = (u) => { const v = String(u || "").trim(); return /^https?:\/\//i.test(v) ? v : ""; };

/* ---------- Date: sempre nel fuso italiano (in inglese in quello del Regno Unito) ----------
   Il sito vecchio usava il fuso del browser. Ora le pagine sono generate su un server in UTC,
   quindi giorno e ora si calcolano esplicitamente in Europe/Rome: risultato uguale per chi è in Italia.
   Le pagine inglesi usano Europe/London, l'ora di chi segue la Premier League. */
export const TIME_ZONE = "Europe/Rome";
export const TIME_ZONE_EN = "Europe/London";
export const timeZone = () => (isEn() ? TIME_ZONE_EN : TIME_ZONE);
export const DAYS = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];
export const DAYN = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"];
export const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const DAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYN_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const days = () => (isEn() ? DAYS_EN : DAYS), dayNames = () => (isEn() ? DAYN_EN : DAYN), months = () => (isEn() ? MONTHS_EN : MONTHS);
const SHORT = { Dom: "Domenica", Lun: "Lunedì", Mar: "Martedì", Mer: "Mercoledì", Gio: "Giovedì", Ven: "Venerdì", Sab: "Sabato" };
const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formats = {};
/* {wd, day, month (0-11), year, hh, mm} nel fuso della lingua corrente, oppure null se la data non è valida. */
export function romeParts(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d)) return null;
  const tz = timeZone();
  const fmt = formats[tz] || (formats[tz] = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", day: "numeric", month: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }));
  const p = {};
  fmt.formatToParts(d).forEach((x) => { p[x.type] = x.value; });
  return { wd: WEEKDAY_INDEX[p.weekday], day: +p.day, month: +p.month - 1, year: +p.year, hh: p.hour.padStart(2, "0"), mm: p.minute.padStart(2, "0") };
}
const pad2 = (n) => String(n).padStart(2, "0");

export function when(m) {  // solo l'orario: il giorno sta nell'intestazione del gruppo
  if (m.label) return m.label.split(" ").slice(1).join(" ");
  const r = m.kickoff && romeParts(m.kickoff);
  return r ? r.hh + ":" + r.mm : "";
}
export function dayOf(m) {
  const r = m.kickoff && romeParts(m.kickoff);
  if (r) return dayNames()[r.wd] + " " + r.day + " " + months()[r.month];
  if (!m.label) return t("Da programmare");
  const first = m.label.split(" ")[0], i = DAYS.indexOf(first);
  return isEn() ? (i >= 0 ? DAYN_EN[i] : first) : (SHORT[first] || first);
}
export function shortDay(iso) {  // "Dom 19/10" per le partite già giocate ("Sun 19/10")
  const r = iso && romeParts(iso);
  return r ? days()[r.wd] + " " + pad2(r.day) + "/" + pad2(r.month + 1) : "";
}
export function roundDay(iso) {  // "Lun 27 ott 18:30" per le prossime giornate ("Mon 27 Oct 18:30")
  const r = iso && romeParts(iso);
  return r ? dayNames()[r.wd].slice(0, 3) + " " + r.day + " " + months()[r.month].slice(0, 3) + " " + r.hh + ":" + r.mm : "";
}
export function updatedAt(iso) {  // "23/10 19:01" per l'etichetta "Aggiornato"
  const r = iso && romeParts(iso);
  return r ? pad2(r.day) + "/" + pad2(r.month + 1) + " " + r.hh + ":" + r.mm : "";
}
export function fmtDay(iso) {  // "19 ottobre" per il riepilogo della giornata ("19 October")
  const r = romeParts(iso + "T12:00:00Z");
  return r ? r.day + " " + months()[r.month] : String(iso);
}
export const decimalIt = (v) => dec(v.toFixed(1));
/* Come toLocaleString("it-IT"): in italiano il punto delle migliaia compare da 10.000 in su ("5000", "10.000").
   In inglese la virgola compare da 1,000 in su. */
export const thousandsIt = (n) => {
  const s = String(Math.round(n));
  if (isEn()) return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return s.length < 5 ? s : s.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};
