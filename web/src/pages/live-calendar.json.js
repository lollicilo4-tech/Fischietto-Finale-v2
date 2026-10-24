/* Calendario delle partite dei nostri campionati per il Worker del momentum (workers/momentum).
   Piccolo e senza analisi: il Worker lo legge ogni minuto con pochi millisecondi di CPU. */
import { liveCalendar } from "../lib/data.js";

export function GET() {
  return new Response(JSON.stringify({ matches: liveCalendar() }), { headers: { "Content-Type": "application/json; charset=utf-8" } });
}
