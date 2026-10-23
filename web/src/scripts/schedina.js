/* Isola "Schedina": tipo (Sicura · Media · Bomba) e numero di selezioni, ricalcolati nel browser. */
import { modelSlipPicks } from "../lib/model.js";
import { slipHtml } from "../lib/render.js";

const read = (id, fallback) => { const el = document.getElementById(id); try { return el ? JSON.parse(el.textContent) : fallback; } catch (e) { return fallback; } };
const matches = read("ff-matches", []);
const extra = read("ff-slip-extra", {});
const mp = extra.market_performance || {}, bm = extra.backtest_markets || {};
let mode = "sicura", n = 3;

function render() {
  document.getElementById("slip").innerHTML = matches.length
    ? slipHtml(modelSlipPicks(matches, mode, n, mp), mode, matches, mp, bm)
    : '<div class="msg">Nessuna selezione disponibile.</div>';
  document.querySelectorAll("#slip-toggle button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
  document.querySelectorAll("#slip-count button").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.count === n)));
}
document.getElementById("slip-toggle").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-mode]"); if (!b) return;
  mode = b.dataset.mode; render();
});
document.getElementById("slip-count").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-count]"); if (!b) return;
  n = +b.dataset.count; render();
});
