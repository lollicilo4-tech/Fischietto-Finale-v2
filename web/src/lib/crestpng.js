/* Stemmi trasformati in PNG da resvg (solo durante il build). Li usano le immagini /stemmi/<id>.png
   delle pagine e le immagini disegnate con satori (anteprime delle partite, immagini per i social).
   I file originali di football-data.org (docs/crests/, PNG o SVG, vedi app/crests.py) passano sempre da
   resvg: un SVG non viene mai pubblicato così com'è e resvg non esegue script né carica risorse esterne. */
import { readFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-wasm";
import { resvgReady } from "./resvg.js";
import { crestPath, crestIndex } from "./data.js";

/* Un PNG dentro un SVG quadrato: resvg lo ridimensiona mantenendo le proporzioni (e toglie i metadati). */
function pngAsSvg(buf, size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<image href="data:image/png;base64,${buf.toString("base64")}" x="0" y="0" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/></svg>`;
}

/* PNG quadrato (lato `size`) dello stemma `file` di docs/crests/. Lancia un errore se non si converte. */
export async function crestPng(file, size = 64) {
  await resvgReady();
  const buf = readFileSync(crestPath(file));
  if (file.endsWith(".png")) return new Resvg(pngAsSvg(buf, size)).render().asPng();
  const svg = buf.toString("utf-8"), probe = new Resvg(svg);
  const fit = probe.width >= probe.height ? { mode: "width", value: size } : { mode: "height", value: size };
  /* Un SVG non quadrato diventa un PNG rettangolare: lo rimettiamo al centro di un quadrato. */
  const png = Buffer.from(new Resvg(svg, { fitTo: fit }).render().asPng());
  if (png.readUInt32BE(16) === size && png.readUInt32BE(20) === size) return png;
  return new Resvg(pngAsSvg(png, size)).render().asPng();
}

/* Stemma come data URI PNG per satori, oppure "" se la squadra non ne ha uno o non si converte.
   Una sola conversione per stemma e misura in tutto il build. */
const cache = new Map();
export async function crestDataUri(league, team, size = 128) {
  const index = crestIndex();
  const file = index[league] && index[league][team];
  if (!file || !/^[0-9a-f]{16}\.(png|svg)$/.test(file)) return "";
  const key = file + ":" + size;
  if (!cache.has(key)) {
    cache.set(key, crestPng(file, size).then((png) => "data:image/png;base64," + Buffer.from(png).toString("base64"))
      .catch((e) => { console.error("[stemmi] " + file + ": " + (e && e.message)); return ""; }));
  }
  return cache.get(key);
}
