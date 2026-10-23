/* Ripubblica i JSON del sito attuale agli stessi indirizzi (/turno.json, /league-PL-turno.json...):
   l'app già installata sui telefoni e chi li usa direttamente continuano a funzionare. */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { dataDir } from "../lib/data.js";

const PUBLISHED = /^(?:league-[A-Z0-9]+-)?(?:turno|storico|classifica)$/;

export function getStaticPaths() {
  return readdirSync(dataDir()).filter((f) => f.endsWith(".json") && PUBLISHED.test(f.slice(0, -5)))
    .map((f) => ({ params: { file: f.slice(0, -5) } }));
}

export function GET({ params }) {
  const body = readFileSync(path.join(dataDir(), params.file + ".json"), "utf-8");
  JSON.parse(body);  // un file corrotto deve far fallire il build, non arrivare agli utenti
  return new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8" } });
}
