/* Isola "Più sicure": numero di selezioni e tipo (nette o tutte), ricalcolati nel browser. */
import { computePicks } from "../lib/model.js";
import { comboHtml } from "../lib/render.js";

const data = document.getElementById("ff-matches");
const matches = data ? JSON.parse(data.textContent) : [];
let n = 3, nodc = true, picks = computePicks(matches, nodc);

function render() {
  const out = comboHtml(picks, n);
  document.getElementById("combo").innerHTML = out.combo;
  document.getElementById("decay").innerHTML = out.decay;
  document.querySelectorAll("#seg button").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.n === n)));
  document.querySelectorAll("#seg2 button").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.dc === "true") === nodc)));
}
document.getElementById("seg").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-n]"); if (!b) return;
  n = +b.dataset.n; render();
});
document.getElementById("seg2").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-dc]"); if (!b) return;
  nodc = b.dataset.dc === "true"; picks = computePicks(matches, nodc); render();
});
