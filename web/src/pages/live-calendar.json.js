/* Calendario delle partite dei nostri campionati per il Worker del momentum (workers/momentum).
   Piccolo e senza analisi: il Worker lo legge ogni minuto con pochi millisecondi di CPU. */
import { LEAGUES } from "../lib/core.js";
import { liveCalendar, leagueData } from "../lib/data.js";

/* updated: l'aggiornamento dei pronostici più recente tra i campionati. Il Worker avvisa se è fermo da
   più di 6 ore (workflow "Aggiorna pronostici" o build del sito che non partono). */
function lastUpdate() {
  const times = LEAGUES.map((l) => { const t = leagueData(l.code).turno; return t && Date.parse(t.generated_at); }).filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

export function GET() {
  return new Response(JSON.stringify({ updated: lastUpdate(), matches: liveCalendar() }), { headers: { "Content-Type": "application/json; charset=utf-8" } });
}
