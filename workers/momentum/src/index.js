/* Worker "fischietto-momentum": ogni minuto registra il momentum delle partite live dei nostri
   campionati (src/collect.js) nel database D1 condiviso con il sito.
   Il sito legge i dati da /api/momentum (web/functions/api/momentum.js), sullo stesso dominio.
   Qui c'è solo /health, per controllare che il cron stia girando. */
import { collect } from "./collect.js";
import { runAlerts } from "./alerts.js";

const STALE_MS = 5 * 60 * 1000;

export default {
  async scheduled(event, env, ctx) {
    const now = event.scheduledTime || Date.now();
    ctx.waitUntil(collect({ fetch, db: env.DB, now }).then((report) => runAlerts(env, report, now)));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== "/health") return new Response("Not found", { status: 404 });
    const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'last_run'").first();
    const last = row ? JSON.parse(row.value) : null;
    const ok = !!last && !last.error && Date.now() - Date.parse(last.at) < STALE_MS;
    // Stato degli avvisi senza l'indirizzo email: solo se sono attivi e l'ultimo errore di invio.
    const alertRow = await env.DB.prepare("SELECT value FROM meta WHERE key = 'alert_state'").first();
    let alerts = null;
    try { const a = alertRow ? JSON.parse(alertRow.value) : null; alerts = a && { configured: !!a.configured, welcomeSent: !!a.welcomeSent, lastError: a.lastError || null, sentToday: a.dayCount || 0 }; } catch (e) { alerts = null; }
    return Response.json({ ok, last_run: last, alerts }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  }
};
