#!/usr/bin/env node
/* Copia gli stili di static/index.html in src/styles/legacy.css, nello stesso ordine.
   Finché il sito su GitHub Pages resta attivo, chi cambia la grafica lì può rieseguire:
     npm run import:css
   Adattamenti automatici, perché nel sito Astro la navigazione usa link veri invece di pulsanti:
   - ogni selettore "button" vale anche per "a.ff-btn" (link con l'aspetto di un pulsante),
     e le regole generiche sui link ("a", ".srcs a"...) non toccano i link-pulsante;
   - [aria-selected="true"] vale anche per [aria-current="page"] (voce attiva della barra in basso).
   La specificità resta quella originale: :where() non conta, quindi ":is(button,a:where(.ff-btn))"
   pesa come "button" e "a:not(:where(.ff-btn))" pesa come "a". Le dichiarazioni non vengono toccate. */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, "../../static/index.html");
const target = path.resolve(here, "../src/styles/legacy.css");

export function adaptSelector(sel) {
  return sel
    .replace(/(^|[\s>+~(,])a(?![-\w.#[])/g, "$1a:not(:where(.ff-btn))")
    .replace(/(^|[\s>+~(,])button(?![-\w])/g, "$1:is(button,a:where(.ff-btn))")
    .replace(/\[aria-selected=("true"|true)\]/g, ':is([aria-selected="true"],[aria-current="page"])');
}

/* Applica adaptSelector solo ai selettori, saltando commenti, @-regole e dichiarazioni. */
export function adaptCss(css) {
  let out = "", i = 0, depth = 0;
  const stack = [];  // true se il blocco aperto contiene regole (selettori), false se contiene dichiarazioni
  let inRules = true;
  while (i < css.length) {
    if (css.startsWith("/*", i)) { const end = css.indexOf("*/", i + 2); const stop = end < 0 ? css.length : end + 2; out += css.slice(i, stop); i = stop; continue; }
    if (inRules) {
      // prelude fino a "{" (o ";" per @import/@charset), oppure "}" che chiude un @media
      let j = i;
      while (j < css.length && css[j] !== "{" && css[j] !== "}" && css[j] !== ";" && !css.startsWith("/*", j)) j++;
      if (css.startsWith("/*", j)) { out += css.slice(i, j); i = j; continue; }
      const prelude = css.slice(i, j);
      if (css[j] === "{") {
        const isAt = prelude.trim().startsWith("@");
        const nested = isAt && /^@(media|supports|container|layer|document)\b/.test(prelude.trim());
        out += isAt ? prelude : adaptSelector(prelude);
        out += "{"; stack.push(inRules); inRules = nested; depth++; i = j + 1;
      } else if (css[j] === "}") {
        out += prelude + "}"; inRules = stack.pop() ?? true; depth--; i = j + 1;
      } else { out += prelude + (j < css.length ? ";" : ""); i = j + 1; }
    } else {
      // dentro un blocco di dichiarazioni: copia fino alla "}" che lo chiude
      const end = css.indexOf("}", i);
      const stop = end < 0 ? css.length : end;
      out += css.slice(i, stop);
      if (end >= 0) { out += "}"; inRules = stack.pop() ?? true; depth--; i = end + 1; } else i = stop;
    }
  }
  return out;
}

export function extractStyles(html) {
  const blocks = [];
  const re = /<style([^>]*)>([\s\S]*?)<\/style>/g;
  let m;
  while ((m = re.exec(html))) {
    const id = /id="([^"]+)"/.exec(m[1]);
    blocks.push("/* ===== " + (id ? id[1] : "base") + " ===== */\n" + m[2].trim() + "\n");
  }
  return blocks;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const blocks = extractStyles(readFileSync(source, "utf-8"));
  const header = "/* GENERATO da scripts/import-legacy-css.mjs a partire da static/index.html: non modificare a mano.\n" +
    "   Le regole nuove del sito Astro stanno in site.css. */\n\n";
  writeFileSync(target, header + adaptCss(blocks.join("\n")));
  console.log("Copiati " + blocks.length + " blocchi di stile in " + path.relative(process.cwd(), target));
}
