/* Avvisi via email al proprietario quando qualcosa non va, così non serve accorgersene dal Live.
   Cloudflare manda gratis le email agli indirizzi verificati in Email Routing (binding "EMAIL" in
   wrangler.jsonc). L'indirizzo NON è nel repository: è il secret ALERT_TO del Worker (deve essere un
   indirizzo verificato). Senza ALERT_TO gli avvisi restano spenti e lo stato si legge solo da /health.

   Quando si avvisa (un'email per problema, non più di una ogni 6 ore per lo stesso problema; per la lista vuota di SportScore una al giorno):
   - SportScore non risponde da almeno 10 minuti (tutte le fonti della lista live falliscono), oppure la
     sua lista live risponde vuota da almeno un'ora (il Live mostra solo i nostri campionati);
   - una partita dei nostri campionati in corso non viene trovata da almeno 20 minuti;
   - il calendario del sito non si legge da almeno 15 minuti;
   - i pronostici non si aggiornano da più di 6 ore (workflow "Aggiorna pronostici" o build del sito fermi).
   In tutto al massimo MAX_PER_DAY email al giorno. La prima volta che ALERT_TO c'è arriva un'email
   di prova ("Avvisi attivi"). */
export const SENDER = { email: "avvisi@fischiettofinale.com", name: "Fischietto finale" };
export const REPEAT_MS = 6 * 3600 * 1000;
export const MAX_PER_DAY = 6;
const MIN = 60 * 1000;
export const FEED_DOWN_MS = 10 * MIN;
export const UNRESOLVED_MS = 20 * MIN;
export const CALENDAR_DOWN_MS = 15 * MIN;
export const FEED_EMPTY_MS = 60 * MIN;
export const STALE_DATA_MS = 6 * 3600 * 1000;
const HEALTH = "/health del Worker fischietto-momentum, oppure la riga last_run della tabella meta in D1";

const since = (prev, active, now) => (active ? prev || now : null);

/* Funzione pura: dallo stato precedente e dal riepilogo dell'ultima esecuzione calcola gli avvisi da
   mandare e il nuovo stato. state: { feedDownSince, calendarDownSince, unresolvedSince: {nome: ms},
   sent: {chiave: ms}, day: "AAAA-MM-GG", dayCount, welcomeSent }. */
export function evaluateAlerts(report, state = {}, now = Date.now(), { configured = true } = {}) {
  const s = { unresolvedSince: {}, sent: {}, ...state };
  const alerts = [];
  const feedDown = /All SportScore live endpoints failed/.test(String(report.error || ""));
  s.feedDownSince = since(s.feedDownSince, feedDown, now);
  s.calendarDownSince = since(s.calendarDownSince, !!report.calendarError, now);
  const fixtures = (report.sources || []).find((x) => /fixtures/.test(x.url || ""));
  s.feedEmptySince = since(s.feedEmptySince, !feedDown && !!fixtures && fixtures.rows === 0, now);
  const unresolved = {};
  (report.unresolved || []).forEach((name) => { unresolved[name] = (s.unresolvedSince || {})[name] || now; });
  s.unresolvedSince = unresolved;

  if (configured && !s.welcomeSent) {
    alerts.push({ key: "welcome", subject: "Avvisi attivi", lines: [
      "Da ora il Worker del momentum ti scrive qui quando qualcosa non va: SportScore che non risponde,",
      "partite dei nostri campionati non trovate, calendario non leggibile, pronostici fermi da più di 6 ore.",
      "Al massimo un'email ogni 6 ore per lo stesso problema e " + MAX_PER_DAY + " al giorno in tutto."] });
  }
  if (s.feedDownSince && now - s.feedDownSince >= FEED_DOWN_MS) {
    alerts.push({ key: "feed", subject: "SportScore non risponde", lines: [
      "Da " + Math.round((now - s.feedDownSince) / MIN) + " minuti nessuna fonte della lista live di SportScore risponde.",
      "Il Live del sito mostra solo le partite dei nostri campionati già trovate (o niente).",
      "Ultimo errore: " + report.error, "Stato: " + HEALTH] });
  }
  if (s.feedEmptySince && now - s.feedEmptySince >= FEED_EMPTY_MS) {
    alerts.push({ key: "feed-empty", subject: "La lista live di SportScore è vuota", lines: [
      "Da " + Math.round((now - s.feedEmptySince) / MIN) + " minuti la lista delle partite in corso di SportScore risponde senza partite.",
      "Il Live del sito mostra solo le partite dei nostri campionati (trovate dal calendario): le altre leghe mancano.",
      "Non dipende dal sito: di solito si risolve da sola quando SportScore sistema la lista."] });
  }
  if (s.calendarDownSince && now - s.calendarDownSince >= CALENDAR_DOWN_MS) {
    alerts.push({ key: "calendar", subject: "Calendario del sito non leggibile", lines: [
      "Da " + Math.round((now - s.calendarDownSince) / MIN) + " minuti il Worker non riesce a leggere https://fischiettofinale.com/live-calendar.json.",
      "Senza calendario il Live non trova le partite che SportScore non elenca.",
      "Errore: " + report.calendarError] });
  }
  Object.entries(unresolved).forEach(([name, from]) => {
    if (now - from < UNRESOLVED_MS) return;
    alerts.push({ key: "unresolved:" + name, subject: "Partita non trovata: " + name, lines: [
      "Da " + Math.round((now - from) / MIN) + " minuti il Worker non trova su SportScore la partita in corso " + name + ".",
      "Nel Live del sito non compare. Di solito il nome breve di una squadra è diverso da quello di SportScore:",
      "si aggiunge a SEARCH_ALIASES in workers/momentum/src/calendar.js (team_slugs in D1 mostra cosa ha trovato la ricerca)."] });
  });
  const updated = Date.parse(report.calendarUpdated || "");
  if (Number.isFinite(updated) && now - updated > STALE_DATA_MS) {
    alerts.push({ key: "stale", subject: "Pronostici fermi da " + Math.floor((now - updated) / 3600000) + " ore", lines: [
      "L'ultimo aggiornamento dei pronostici pubblicato sul sito è del " + new Date(updated).toISOString().replace("T", " ").slice(0, 16) + " UTC.",
      "Controlla su GitHub il workflow \"Aggiorna pronostici\" e su Cloudflare le pubblicazioni del progetto Pages."] });
  }

  // Ripetizioni e tetto giornaliero.
  const day = new Date(now).toISOString().slice(0, 10);
  if (s.day !== day) { s.day = day; s.dayCount = 0; }
  const out = [];
  for (const a of alerts) {
    if (!configured) break;
    const repeat = a.key === "feed-empty" ? 4 * REPEAT_MS : REPEAT_MS;  // problema di SportScore: una volta al giorno
    if (a.key !== "welcome" && s.sent[a.key] && now - s.sent[a.key] < repeat) continue;
    if ((s.dayCount || 0) >= MAX_PER_DAY) break;
    out.push(a); s.sent[a.key] = now; s.dayCount = (s.dayCount || 0) + 1;
    if (a.key === "welcome") s.welcomeSent = true;
  }
  // Le chiavi vecchie non servono più: lo stato resta piccolo.
  Object.keys(s.sent).forEach((k) => { if (now - s.sent[k] > 5 * REPEAT_MS && k !== "welcome") delete s.sent[k]; });
  return { alerts: out, state: s };
}

/* Manda gli avvisi; ritorna le chiavi non inviate e l'ultimo errore. */
export async function sendAlerts(email, to, alerts) {
  const failed = [];
  let error = null;
  for (const a of alerts) {
    try {
      await email.send({ to, from: SENDER, subject: "Fischietto finale · " + a.subject, text: a.lines.join("\n") + "\n\n— Worker fischietto-momentum" });
    } catch (e) { failed.push(a.key); error = String((e && e.message) || e).slice(0, 160); }
  }
  return { failed, error };
}

/* Un giro completo: legge lo stato da D1, decide, manda, salva. Non lancia mai errori. */
export async function runAlerts(env, report, now = Date.now()) {
  try {
    const configured = !!(env.EMAIL && env.ALERT_TO);
    const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'alert_state'").first();
    let state = {};
    try { state = row ? JSON.parse(row.value) : {}; } catch (e) { state = {}; }
    const { alerts, state: next } = evaluateAlerts(report, state, now, { configured });
    let sent = 0;
    if (configured && alerts.length) {
      const { failed, error } = await sendAlerts(env.EMAIL, env.ALERT_TO, alerts);
      sent = alerts.length - failed.length;
      // Un avviso non partito (indirizzo non verificato, servizio giù…) si riprova al giro successivo.
      failed.forEach((k) => { delete next.sent[k]; next.dayCount = Math.max(0, (next.dayCount || 1) - 1); if (k === "welcome") next.welcomeSent = false; });
      next.lastError = error;
    }
    next.configured = configured;
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('alert_state', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(JSON.stringify(next)).run();
    return { configured, sent, pending: alerts.map((a) => a.key) };
  } catch (e) {
    return { configured: false, sent: 0, error: String((e && e.message) || e).slice(0, 120) };
  }
}
