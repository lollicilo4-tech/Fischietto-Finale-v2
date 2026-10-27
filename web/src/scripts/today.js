/* Isola "Oggi in campo": rifà la pagina con l'ora del browser (dopo mezzanotte "Oggi" cambia giorno)
   e la riaggiorna ogni 5 minuti, così le partite iniziate da più di due ore escono dall'elenco. */
import { todayHtml } from "../lib/today.js";

const box = document.getElementById("today"), data = document.getElementById("ff-today");
if (box && data) {
  let items = [];
  try { items = JSON.parse(data.textContent) || []; } catch (e) { items = []; }
  const render = () => { const html = todayHtml(items); if (box.innerHTML !== html) box.innerHTML = html; };
  render();
  setInterval(() => { if (!document.hidden) render(); }, 5 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });
}
