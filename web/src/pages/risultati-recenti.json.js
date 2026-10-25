/* Risultati recenti delle partite dei nostri campionati, per "I miei pronostici" (src/lib/mypicks.js):
   il browser li scarica solo se ha pronostici in attesa di risultato. */
import { recentResults } from "../lib/data.js";

export function GET() {
  return new Response(JSON.stringify({ results: recentResults() }), { headers: { "Content-Type": "application/json; charset=utf-8" } });
}
