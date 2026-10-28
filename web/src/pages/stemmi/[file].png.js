/* Stemmi delle squadre come PNG 64×64 serviti dal sito (/stemmi/<id>.png), convertiti da src/lib/crestpng.js.
   Se uno stemma non si converte, al suo posto va un PNG trasparente (e l'errore resta nel log del build). */
import { Resvg } from "@resvg/resvg-wasm";
import { resvgReady } from "../../lib/resvg.js";
import { crestFiles } from "../../lib/data.js";
import { crestPng } from "../../lib/crestpng.js";

const SIZE = 64;
const EMPTY = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}"/>`;
export const getStaticPaths = () => crestFiles().map((x) => ({ params: { file: x.stem }, props: { file: x.file } }));

export const render = (file) => crestPng(file, SIZE);
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
