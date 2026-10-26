/* "La mia rosa" nella pagina Fantacalcio: legge la rosa salvata nel browser, mostra i consigli della
   giornata e gestisce aggiunta e rimozione dei giocatori. "Svuota rosa" chiede conferma con un secondo
   tocco (niente finestre di dialogo). Dati della giornata: <script id="ff-fanta"> nella pagina. */
import { ROSA_KEY, parseRosa, emptyRosa, addPlayer, removePlayer, rosaHtml } from "../lib/rosa.js";

const root = document.getElementById("rosa");
const form = document.getElementById("rosa-form");
const note = document.getElementById("rosa-msg");
let data = { rows: [], teams: [] };
try { data = JSON.parse(document.getElementById("ff-fanta").textContent); } catch (e) { /* pagina senza dati */ }

const read = () => { try { return parseRosa(localStorage.getItem(ROSA_KEY)); } catch (e) { return emptyRosa(); } };
const write = (rosa) => { try { localStorage.setItem(ROSA_KEY, JSON.stringify(rosa)); return true; } catch (e) { return false; } };

function render() {
  root.innerHTML = rosaHtml(read(), data.rows);
}
function say(text, err) {
  note.textContent = text;
  note.classList.toggle("err", !!err);
}

if (root && form) {
  render();
  form.hidden = false;
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const f = new FormData(form);
    const { rosa, error } = addPlayer(read(), { role: f.get("role"), team: f.get("team"), name: f.get("name") }, data.teams);
    if (error) { say(error, true); return; }
    if (!write(rosa)) { say("Questo browser non permette di salvare la rosa (navigazione privata?).", true); return; }
    form.elements.name.value = "";
    form.elements.name.focus();
    say("Aggiunto.", false);
    render();
  });
  root.addEventListener("click", (ev) => {
    const remove = ev.target.closest(".rosa-remove");
    if (remove) { write(removePlayer(read(), remove.dataset.id)); say("", false); render(); return; }
    const clear = ev.target.closest("#rosa-clear");
    if (clear) {
      if (clear.dataset.confirm !== "1") { clear.dataset.confirm = "1"; clear.textContent = "Tocca di nuovo per svuotare"; return; }
      write(emptyRosa());
      render();
    }
  });
}
