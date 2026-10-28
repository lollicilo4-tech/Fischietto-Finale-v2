/* Strumenti comuni delle immagini generate durante il build (mai nel browser): consigli fantacalcio,
   anteprime delle partite, immagini per i social, riepilogo della settimana.
   Il disegno è fatto con satori (layout e testo diventano tracciati SVG, con i caratteri del sito già
   installati da Fontsource) e trasformato in PNG da resvg (WebAssembly): niente servizi esterni,
   niente programmi da installare. Gli stemmi entrano come data URI PNG (src/lib/crestpng.js). */
import { readFileSync } from "node:fs";
import path from "node:path";
import satori from "satori";
import { Resvg } from "@resvg/resvg-wasm";
import { resvgReady } from "./resvg.js";

export const C = { bg: "#0a1018", panel: "#111b27", line: "#22344a", fg: "#eaf1f8", muted: "#8fa3b8", gold: "#f2b01e", blue: "#3d9bff", good: "#3fd29b", bad: "#ff7a6b", mid: "#e9c46a" };
export const SITE = "fischiettofinale.com";
/* Formati: anteprima dei link (og:image), post 4:5, storia/Reel/TikTok 9:16. */
export const PREVIEW = { width: 1200, height: 630 };
export const SOCIAL = { width: 1080, height: 1350 };
export const STORY = { width: 1080, height: 1920 };

/* Albero per satori: { type, props: { style, children } }. Ogni nodo è flex (satori lo richiede). */
export const h = (style, ...children) => ({ type: "div", props: { style: { display: "flex", ...style }, children: children.flat().filter((c) => c !== null && c !== "" && c !== undefined && c !== false) } });
export const text = (style, value) => h(style, String(value));
export const img = (src, size, style = {}) => ({ type: "img", props: { src, width: size, height: size, style: { width: size, height: size, ...style } } });

export const brand = (size) => h({ alignItems: "baseline", gap: size * 0.3, fontFamily: "Barlow", fontWeight: 800, fontSize: size, letterSpacing: 1 },
  text({ color: C.fg }, "FISCHIETTO"), text({ color: C.blue }, "FINALE"));

/* Stemma, oppure (squadra senza stemma) un cerchio con le iniziali. */
export function badge(src, name, size) {
  if (src) return img(src, size, { objectFit: "contain" });
  const initials = String(name || "?").split(/\s+/).filter((w) => /[A-Za-zÀ-ÿ]/.test(w)).slice(0, 2).map((w) => w.replace(/[^A-Za-zÀ-ÿ]/g, "")[0] || "").join("").toUpperCase() || "?";
  return h({ width: size, height: size, borderRadius: size, backgroundColor: C.line, alignItems: "center", justifyContent: "center", flexShrink: 0 },
    text({ fontFamily: "Barlow", fontWeight: 800, fontSize: Math.round(size * 0.42), color: C.fg }, initials));
}

/* Satori non conta il padding nella larghezza: lo sfondo prende tutta l'immagine e il contenuto sta in
   un riquadro interno di misura esatta. */
export const frame = (size, pad, bgPos, inner) => h({ width: size.width, height: size.height, backgroundColor: C.bg, overflow: "hidden",
  backgroundImage: "radial-gradient(circle at " + bgPos + ", #1b3a5e 0%, " + C.bg + " 58%)" },
  h({ flexDirection: "column", width: size.width - 2 * pad.x, height: size.height - pad.top - pad.bottom, marginLeft: pad.x, marginTop: pad.top, color: C.fg }, inner));

/* Testo accorciato con i puntini se supera `max` caratteri (satori non ha text-overflow su una riga). */
export const clip = (s, max) => { const v = String(s || ""); return v.length > max ? v.slice(0, max - 1).trimEnd() + "…" : v; };

/* ---------- PNG ---------- */
const nm = (...p) => path.resolve(process.cwd(), "node_modules", ...p);
let ready = null;
function setup() {
  if (!ready) {
    const font = (pkg, file) => readFileSync(nm("@fontsource", pkg, "files", file));
    ready = resvgReady().then(() => [
      { name: "Barlow", data: font("barlow-condensed", "barlow-condensed-latin-700-normal.woff"), weight: 700, style: "normal" },
      { name: "Barlow", data: font("barlow-condensed", "barlow-condensed-latin-800-normal.woff"), weight: 800, style: "normal" },
      { name: "Plex", data: font("ibm-plex-sans", "ibm-plex-sans-latin-400-normal.woff"), weight: 400, style: "normal" },
      { name: "Plex", data: font("ibm-plex-sans", "ibm-plex-sans-latin-600-normal.woff"), weight: 600, style: "normal" }
    ]);
  }
  return ready;
}

export async function renderPng(tree, { width, height }) {
  const fonts = await setup();
  const svg = await satori(tree, { width, height, fonts });
  return new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
}

/* Risposta per gli endpoint di Astro. Se il disegno fallisce il sito si pubblica lo stesso:
   al posto dell'immagine va l'icona del sito (e l'errore resta nel log del build). */
export async function pngFrom(label, draw) {
  let body;
  try { body = await draw(); }
  catch (e) {
    console.error("Immagine non generata (" + label + "): " + (e && e.message));
    body = readFileSync(path.resolve(process.cwd(), "public", "icon-512.png"));
  }
  return new Response(body, { headers: { "Content-Type": "image/png" } });
}
