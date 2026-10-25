/* "I miei pronostici" nelle schede delle partite (Partite e pagina della partita): pulsanti 1 · X · 2 nel
   dettaglio e, nell'intestazione, il pronostico scelto. Salvato solo in questo browser. Se ci sono
   pronostici di partite già finite senza risultato, scarica /risultati-recenti.json e li completa. */
import { PICKS_KEY, parseStore, setPick, withResults, pickerHtml, pickKey, isOpen } from "../lib/mypicks.js";

export function readStore() { try { return parseStore(localStorage.getItem(PICKS_KEY)); } catch (e) { return parseStore(""); } }
export function writeStore(store) { try { localStorage.setItem(PICKS_KEY, JSON.stringify(store)); } catch (e) { /* storage non disponibile */ } }

const RESULT_AFTER_MS = 100 * 60 * 1000;  // una partita ha un risultato almeno 100 minuti dopo l'inizio
export async function completeResults(store, now = Date.now()) {
  const waiting = Object.values(store.picks).some((p) => !p.result && p.kickoff && now - Date.parse(p.kickoff) > RESULT_AFTER_MS);
  if (!waiting) return store;
  try {
    const r = await fetch("/risultati-recenti.json");
    if (!r.ok) return store;
    const { store: next, changed } = withResults(store, (await r.json()).results);
    if (changed) writeStore(next);
    return next;
  } catch (e) { return store; }
}

function matchOf(card, league) {
  const id = (card.id || "").replace(/^m-/, "");
  return id ? { league, id, home: card.dataset.home, away: card.dataset.away, kickoff: card.dataset.kickoff || null } : null;
}

function decorate(store) {
  const league = document.body.dataset.league;
  if (!league) return;
  document.querySelectorAll("details.match[data-home]").forEach((card) => {
    const m = matchOf(card, league);
    if (!m) return;
    const current = store.picks[pickKey(league, m.id)];
    // Nell'intestazione: "Tu: 1".
    const head = card.querySelector(".mhead");
    let badge = head && head.querySelector(".my-pick-badge");
    if (head && current && !badge) { badge = document.createElement("span"); badge.className = "my-pick-badge"; head.appendChild(badge); }
    if (badge) { if (current) badge.textContent = "Tu: " + current.pick; else badge.remove(); }
    // Nel dettaglio: i pulsanti (solo se la partita non è iniziata o c'è già un pronostico).
    const detail = card.querySelector(".detail");
    if (!detail) return;
    const box = detail.querySelector(".my-pick");
    if (!isOpen(m.kickoff) && !current) { if (box) box.remove(); return; }
    const holder = document.createElement("div");
    holder.innerHTML = pickerHtml(m, store);
    if (box) box.replaceWith(holder.firstElementChild);
    else detail.insertBefore(holder.firstElementChild, detail.querySelector(".match-actions"));
  });
}

let store = readStore();
decorate(store);
completeResults(store).then((s) => { store = s; });
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".my-pick button[data-my-pick]");
  if (!btn) return;
  const card = btn.closest("details.match[data-home]"), league = document.body.dataset.league;
  const m = card && matchOf(card, league);
  if (!m) return;
  store = setPick(readStore(), m, btn.getAttribute("data-my-pick"));
  writeStore(store);
  decorate(store);
});
