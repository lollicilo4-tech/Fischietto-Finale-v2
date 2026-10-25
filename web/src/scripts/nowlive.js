/* Isola "In corso adesso" (pagina Partite): chiede a /api/live le partite in corso di questo
   campionato, le mostra con minuto e punteggio, le aggiorna ogni minuto e fa avanzare il minuto.
   Se non ce ne sono, o il servizio non risponde, il riquadro resta nascosto. */
import { rowsOfLeague, nowLiveHtml } from "../lib/nowlive.js";
import { minuteLabel } from "../lib/livefeed.js";

const box = document.getElementById("now-live");
if (box) {
  const key = box.getAttribute("data-live-key"), url = box.getAttribute("data-live-url") || "/live/";
  const load = async () => {
    try {
      const r = await fetch("/api/live");
      if (!r.ok) throw new Error("HTTP " + r.status);
      const data = await r.json();
      const html = nowLiveHtml(rowsOfLeague(data && data.matches, key), url);
      box.innerHTML = html;
      box.hidden = !html;
    } catch (e) { /* senza dati il riquadro resta com'era */ }
  };
  const tick = () => {
    const now = Date.now();
    box.querySelectorAll(".live-minute[data-minute]").forEach((el) => {
      const phase = el.getAttribute("data-phase");
      if (phase !== "1H" && phase !== "2H" && phase !== "ET") return;
      const text = minuteLabel(+el.getAttribute("data-minute") + Math.floor((now - +el.getAttribute("data-minute-at")) / 60000), phase);
      if (el.textContent !== text) el.textContent = text;
    });
  };
  load();
  setInterval(() => { if (!document.hidden) load(); }, 60000);
  setInterval(() => { if (!document.hidden) tick(); }, 15000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
}
