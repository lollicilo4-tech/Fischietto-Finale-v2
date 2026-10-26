/* Pagina "I miei pronostici": legge i pronostici salvati nel browser, completa i risultati e mostra la
   sfida con il modello. "Cancella" chiede conferma con un secondo tocco (niente finestre di dialogo). */
import { myPageHtml, emptyStore } from "../lib/mypicks.js";
import { readStore, writeStore, completeResults } from "./mypicks.js";
import { t } from "../lib/i18n.js";

const root = document.getElementById("my-picks");
async function render() {
  const store = await completeResults(readStore());
  root.innerHTML = myPageHtml(store);
  const clear = document.getElementById("my-clear");
  if (clear) clear.addEventListener("click", () => {
    if (clear.dataset.confirm !== "1") { clear.dataset.confirm = "1"; clear.textContent = t("Tocca di nuovo per cancellare tutto"); return; }
    writeStore(emptyStore());
    render();
  });
}
if (root) render();
