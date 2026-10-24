/* Pages Function: GET /api/live.
   Le partite dei nostri campionati in corso, registrate dal Worker "fischietto-momentum" in D1 (tabella
   live_rows): { matches: [ {home, away, home_score, ..., url, live_minute} ], available: true }.
   Servono perché la lista "live" di SportScore spesso non elenca Serie A, LaLiga, Premier League…:
   il Live Center le aggiunge alla lista di SportScore. Stesso dominio: niente CORS né modifiche alla CSP.
   Righe aggiornate negli ultimi 3 minuti e partite ancora in corso; risposte in cache per 30 secondi. */
const FRESH_MS = 3 * 60 * 1000;
const MAX_ROWS = 40;

const json = (body, cache) => new Response(JSON.stringify(body), {
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cache, "X-Content-Type-Options": "nosniff" }
});

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.DB) return json({ matches: [], available: false }, "no-store");
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const key = new Request(new URL(request.url).origin + "/api/live");
  if (cache) { const hit = await cache.match(key); if (hit) return hit; }

  const now = context.now || Date.now();
  const { results } = await env.DB.prepare(
    "SELECT row FROM live_rows WHERE live = 1 AND updated_at >= ?1 ORDER BY league, slug LIMIT ?2"
  ).bind(now - FRESH_MS, MAX_ROWS).all();
  const matches = [];
  for (const r of results || []) { try { const m = JSON.parse(r.row); if (m && m.home && m.away) matches.push(m); } catch (e) { /* riga rovinata */ } }
  const res = json({ matches, available: true }, "public, max-age=30");
  if (cache && context.waitUntil) context.waitUntil(cache.put(key, res.clone()));
  return res;
}
