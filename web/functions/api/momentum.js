/* Pages Function: GET /api/momentum?slug=a&slug=b (al massimo 20 partite).
   Restituisce i campioni di momentum registrati dal Worker "fischietto-momentum" nel database D1:
   { samples: { "<slug>": [{ m, h, a }, ...] }, available: true }.
   Sta sullo stesso dominio del sito, quindi non servono CORS né modifiche alla CSP.
   Risposte in cache per 30 secondi: il Worker aggiunge un campione al minuto. */
const MAX_SLUGS = 20;
const SLUG = /^[a-z0-9][a-z0-9-]{0,150}$/i;

const json = (body, status, cache) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cache, "X-Content-Type-Options": "nosniff" }
});

export function parseSlugs(url) {
  const all = url.searchParams.getAll("slug").flatMap((s) => s.split(","));
  return [...new Set(all.map((s) => s.trim()).filter((s) => SLUG.test(s)))].slice(0, MAX_SLUGS).sort();
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const slugs = parseSlugs(url);
  if (!slugs.length) return json({ error: "Indica almeno una partita con ?slug=" }, 400, "no-store");
  if (!env.DB) return json({ samples: {}, available: false }, 200, "no-store");

  const cache = typeof caches !== "undefined" ? caches.default : null;
  const key = new Request(url.origin + "/api/momentum?slug=" + slugs.join(","));
  if (cache) { const hit = await cache.match(key); if (hit) return hit; }

  const { results } = await env.DB.prepare(
    "SELECT slug, minute AS m, h, a FROM samples WHERE slug IN (" + slugs.map(() => "?").join(",") + ") ORDER BY slug, minute"
  ).bind(...slugs).all();
  const samples = {};
  for (const r of results || []) (samples[r.slug] = samples[r.slug] || []).push({ m: r.m, h: r.h, a: r.a });
  const res = json({ samples, available: true }, 200, "public, max-age=30");
  if (cache && context.waitUntil) context.waitUntil(cache.put(key, res.clone()));
  return res;
}
