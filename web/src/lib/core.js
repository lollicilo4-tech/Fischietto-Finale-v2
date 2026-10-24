/* Configurazione e funzioni di base condivise tra build (Node) e browser.
   Tutto qui è puro: niente DOM, niente fetch. */

export const LEAGUES = [
  { code: "SA", slug: "serie-a", name: "Serie A", country: "Italia", flag: "🇮🇹", liveKey: "serie-a", file: "" },
  { code: "PL", slug: "premier-league", name: "Premier League", country: "Inghilterra", flag: "🏴", liveKey: "premier-league", file: "league-PL-" },
  { code: "PD", slug: "laliga", name: "LaLiga", country: "Spagna", flag: "🇪🇸", liveKey: "laliga", file: "league-PD-" },
  { code: "BL1", slug: "bundesliga", name: "Bundesliga", country: "Germania", flag: "🇩🇪", liveKey: "bundesliga", file: "league-BL1-" },
  { code: "FL1", slug: "ligue-1", name: "Ligue 1", country: "Francia", flag: "🇫🇷", liveKey: "ligue-1", file: "league-FL1-" },
  { code: "CL", slug: "champions-league", name: "Champions League", country: "Europa", flag: "🏆", liveKey: "champions-league", file: "league-CL-" },
  { code: "EL", slug: "europa-league", name: "Europa League", country: "Europa", flag: "🏆", liveKey: "europa-league", file: "league-EL-" },
  { code: "UECL", slug: "conference-league", name: "Conference League", country: "Europa", flag: "🏆", liveKey: "conference-league", file: "league-UECL-" }
];
/* Ordine del menu a tendina nell'intestazione, come nel sito attuale. */
export const SELECT_ORDER = ["SA", "PL", "CL", "BL1", "PD", "FL1", "EL", "UECL"];
export const DEFAULT_LEAGUE = "SA";

export const leagueByCode = (code) => LEAGUES.find((l) => l.code === code) || null;
export const leagueBySlug = (slug) => LEAGUES.find((l) => l.slug === slug) || null;

/* Sezioni di ogni campionato: slug nell'URL, id del pannello (usato dal CSS) ed etichetta. */
export const SECTIONS = {
  home: { path: "", panel: "p-home", label: "Home" },
  partite: { path: "partite/", panel: "p-partite", label: "Partite" },
  sicure: { path: "piu-probabili/", panel: "p-sicure", label: "Più probabili" },
  schedina: { path: "scelte-del-modello/", panel: "p-schedina", label: "Le scelte del modello" },
  classifica: { path: "classifica/", panel: "p-classifica", label: "Classifica" },
  storico: { path: "storico/", panel: "p-storico", label: "Storico" }
};

/* ---------- URL del sito ---------- */
export function slugify(text) {
  return String(text || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss").replace(/ø/g, "o").replace(/æ/g, "ae").replace(/ł/g, "l").replace(/đ/g, "d")
    .toLowerCase().replace(/&/g, " e ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "squadra";
}
export const leagueUrl = (league, section = "home") =>
  league === DEFAULT_LEAGUE && section === "home" ? "/" : "/" + leagueByCode(league).slug + "/" + SECTIONS[section].path;
export const teamUrl = (league, team) => "/" + leagueByCode(league).slug + "/squadra/" + slugify(team) + "/";
export const matchSlug = (m) => String(m.id).replace(/[^0-9A-Za-z_-]/g, "") + "-" + slugify(m.home) + "-" + slugify(m.away);
export const matchUrl = (league, m) => "/" + leagueByCode(league).slug + "/partita/" + matchSlug(m) + "/";
export const liveUrl = (league) => "/live/" + (league ? "?lega=" + leagueByCode(league).slug : "");
export const INFO_URL = "/come-funziona/";
/* Donazioni libere: un link normale (nessuno script di Ko-fi), così la CSP non cambia. */
export const KOFI_URL = "https://ko-fi.com/fischiettofinale";
export const PRIVACY_URL = "/privacy/";
export const CONTACT_EMAIL = "info@fischiettofinale.com";

/* ---------- Formattazione (identica al sito attuale) ---------- */
export const pc = (p) => Math.round(p * 100) + "%";
export const d1 = (x) => x.toFixed(1).replace(".", ",");
export const d2 = (x) => (x == null ? "–" : x.toFixed(2).replace(".", ","));
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
/* Link e immagini da dati esterni: solo indirizzi http(s), mai javascript: o simili. */
export const safeUrl = (u) => { const v = String(u || "").trim(); return /^https?:\/\//i.test(v) ? v : ""; };

/* ---------- Date: sempre nel fuso italiano ----------
   Il sito vecchio usava il fuso del browser. Ora le pagine sono generate su un server in UTC,
   quindi giorno e ora si calcolano esplicitamente in Europe/Rome: risultato uguale per chi è in Italia. */
export const TIME_ZONE = "Europe/Rome";
export const DAYS = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];
export const DAYN = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"];
export const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const SHORT = { Dom: "Domenica", Lun: "Lunedì", Mar: "Martedì", Mer: "Mercoledì", Gio: "Giovedì", Ven: "Venerdì", Sab: "Sabato" };
const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
let romeFormat = null;
/* {wd, day, month (0-11), year, hh, mm} nel fuso italiano, oppure null se la data non è valida. */
export function romeParts(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d)) return null;
  romeFormat = romeFormat || new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE, weekday: "short", day: "numeric", month: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  });
  const p = {};
  romeFormat.formatToParts(d).forEach((x) => { p[x.type] = x.value; });
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
  if (r) return DAYN[r.wd] + " " + r.day + " " + MONTHS[r.month];
  return m.label ? (SHORT[m.label.split(" ")[0]] || m.label.split(" ")[0]) : "Da programmare";
}
export function shortDay(iso) {  // "Dom 19/10" per le partite già giocate
  const r = iso && romeParts(iso);
  return r ? DAYS[r.wd] + " " + pad2(r.day) + "/" + pad2(r.month + 1) : "";
}
export function roundDay(iso) {  // "Lun 27 ott 18:30" per le prossime giornate
  const r = iso && romeParts(iso);
  return r ? DAYN[r.wd].slice(0, 3) + " " + r.day + " " + MONTHS[r.month].slice(0, 3) + " " + r.hh + ":" + r.mm : "";
}
export function updatedAt(iso) {  // "23/10 19:01" per l'etichetta "Aggiornato"
  const r = iso && romeParts(iso);
  return r ? pad2(r.day) + "/" + pad2(r.month + 1) + " " + r.hh + ":" + r.mm : "";
}
export function fmtDay(iso) {  // "19 ottobre" per il riepilogo della giornata
  const r = romeParts(iso + "T12:00:00Z");
  return r ? r.day + " " + MONTHS[r.month] : String(iso);
}
export const decimalIt = (v) => v.toFixed(1).replace(".", ",");
/* Come toLocaleString("it-IT"): in italiano il punto delle migliaia compare da 10.000 in su ("5000", "10.000"). */
export const thousandsIt = (n) => { const s = String(Math.round(n)); return s.length < 5 ? s : s.replace(/\B(?=(\d{3})+(?!\d))/g, "."); };
