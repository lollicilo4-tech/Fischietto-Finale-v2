/* Stemmi delle squadre come PNG 64×64 serviti dal sito (/stemmi/<id>.png). I file originali di
   football-data.org (docs/crests/, PNG o SVG, vedi app/crests.py) passano sempre da resvg: un SVG non
   viene mai pubblicato così com'è e resvg non esegue script né carica risorse esterne.
   Se uno stemma non si converte, al suo posto va un PNG trasparente (e l'errore resta nel log del build). */
import { readFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-wasm";
import { resvgReady } from "../../lib/resvg.js";
import { crestFiles, crestPath } from "../../lib/data.js";

const SIZE = 64;
const EMPTY = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}"/>`;
export const getStaticPaths = () => crestFiles().map((x) => ({ params: { file: x.stem }, props: { file: x.file } }));

/* Un PNG dentro un SVG quadrato: resvg lo ridimensiona mantenendo le proporzioni (e toglie i metadati). */
function pngAsSvg(buf) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
    `<image href="data:image/png;base64,${buf.toString("base64")}" x="0" y="0" width="${SIZE}" height="${SIZE}" preserveAspectRatio="xMidYMid meet"/></svg>`;
}
export async function render(file) {
  await resvgReady();
  const buf = readFileSync(crestPath(file));
  if (file.endsWith(".png")) return new Resvg(pngAsSvg(buf)).render().asPng();
  const svg = buf.toString("utf-8"), probe = new Resvg(svg);
  const fit = probe.width >= probe.height ? { mode: "width", value: SIZE } : { mode: "height", value: SIZE };
  return new Resvg(svg, { fitTo: fit }).render().asPng();
}
export async function GET({ props }) {
  let body;
  try { body = await render(props.file); }
  catch (e) {
    console.error("[stemmi] " + props.file + ": " + (e && e.message));
    await resvgReady();
    body = new Resvg(EMPTY).render().asPng();
  }
  return new Response(body, { headers: { "Content-Type": "image/png" } });
}
