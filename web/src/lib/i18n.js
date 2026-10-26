/* Lingua del sito: italiano (originale) e inglese (pagine sotto /en/).
   Il testo nel codice resta in italiano e passa da t(): in inglese si cerca la traduzione in EN
   (src/lib/i18n-en.js), in italiano esce identico. I segnaposto {nome} si riempiono con vars:
   t("Ultime di {team}", { team }) → "Ultime di Lazio" · "Last games of Lazio".
   La lingua è una sola alla volta: nel browser si legge da <html lang>, durante il build ogni pagina
   la imposta con setLang() (Astro genera le pagine una alla volta). */
import { EN } from "./i18n-en.js";

export const LANGS = ["it", "en"];
let LANG = typeof document !== "undefined" && document.documentElement && document.documentElement.lang === "en" ? "en" : "it";

export const lang = () => LANG;
export const isEn = () => LANG === "en";
export function setLang(value) { LANG = value === "en" ? "en" : "it"; return LANG; }
/* Lingua di un indirizzo del sito: tutto ciò che sta sotto /en/ è in inglese. */
export const langOfPath = (pathname) => (/^\/en(\/|$)/.test(String(pathname || "")) ? "en" : "it");

/* Testi senza traduzione chiesti in inglese: i test controllano che resti vuoto. */
const missing = new Set();
export const missingTranslations = () => [...missing].sort();
export const resetMissing = () => missing.clear();

const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (all, k) => (vars[k] != null ? String(vars[k]) : all)) : s);

export function t(it, vars) {
  if (LANG !== "en") return fill(it, vars);
  const en = EN[it];
  if (en == null) { missing.add(it); return fill(it, vars); }
  return fill(en, vars);
}
/* Campo di un dato pubblicato in due lingue (es. text e text_en): in inglese, se c'è, la versione inglese. */
export const loc = (obj, key) => (obj ? (LANG === "en" && obj[key + "_en"] != null ? obj[key + "_en"] : obj[key]) : obj);
