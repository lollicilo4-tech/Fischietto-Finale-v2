/* Stemmi delle squadre: piccoli PNG serviti dal sito (/stemmi/<id>.png, generati al build da
   src/pages/stemmi/[file].png.js a partire da docs/crests/, vedi app/crests.py).
   L'elenco squadra -> stemma lo carica src/lib/data.js durante il build; nel browser è vuoto e le
   funzioni non aggiungono nulla (le isole che ridisegnano la pagina portano gli indirizzi nei loro dati). */
import { esc } from "./core.js";

let MAP = {};
export function setCrests(teams) { MAP = teams && typeof teams === "object" ? teams : {}; }
const stem = (file) => String(file).replace(/\.(png|svg)$/, "");
/* "/stemmi/<id>.png" oppure "" se la squadra non ha uno stemma. */
export function crestSrc(league, team) {
  const file = MAP[league] && MAP[league][team];
  return file && /^[0-9a-f]{16}\.(png|svg)$/.test(file) ? "/stemmi/" + stem(file) + ".png" : "";
}
/* <img> decorativo (alt vuoto: il nome della squadra è già scritto accanto). size: dimensione in px. */
export function crestImgSrc(src, size = 20, cls = "") {
  return src ? '<img class="crest' + (cls ? " " + cls : "") + '" src="' + esc(src) + '" alt="" width="' + size + '" height="' + size + '" loading="lazy" decoding="async">' : "";
}
export const crestImg = (league, team, size, cls) => crestImgSrc(crestSrc(league, team), size, cls);
