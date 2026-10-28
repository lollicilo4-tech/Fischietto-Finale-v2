/* resvg (WebAssembly) si può inizializzare una sola volta per processo: lo condividono le immagini del
   fantacalcio (src/lib/fantacard.js) e gli stemmi delle squadre (src/pages/stemmi/). Solo durante il build. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { initWasm } from "@resvg/resvg-wasm";

export const nodeModule = (...p) => path.resolve(process.cwd(), "node_modules", ...p);
let ready = null;
export function resvgReady() {
  if (!ready) ready = initWasm(readFileSync(nodeModule("@resvg", "resvg-wasm", "index_bg.wasm")));
  return ready;
}
