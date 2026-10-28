/* Equivalenza con il sito attuale: esegue lo script di static/index.html (tests/render_page.js,
   lo stesso harness dei test Python) sui JSON di docs/ e confronta l'HTML con quello generato
   dalla libreria del sito Astro, per ogni campionato.
   Le sole differenze ammesse sono quelle volute dalla migrazione, rimosse da normalize():
   link veri al posto dei pulsanti che cambiavano pannello, attributi data-* usati dagli script
   del browser, il link "Pagina della partita", la nota "orario trascorso" (ora aggiunta nel browser) e le
   "quote eque" (1 diviso la probabilità), tolte dal sito nuovo perché sembrano quote da scommessa. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LEAGUES } from "../src/lib/core.js";
import { grouped, storicoParts, seasonPanel, nextRoundsPanel, recapPanel, teamPage } from "../src/lib/render.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const docs = path.join(repo, "docs");
const read = (f) => (existsSync(path.join(docs, f)) ? JSON.parse(readFileSync(path.join(docs, f), "utf-8")) : null);

function legacyRender(code) {
  const out = mkdtempSync(path.join(tmpdir(), "ff-parity-"));
  // Il sito attuale usa il fuso del browser: lo si fissa all'Italia, come fa ora il sito Astro.
  execFileSync(process.execPath, [path.join(repo, "tests/render_page.js"), repo, code, out], { env: { ...process.env, TZ: "Europe/Rome" }, stdio: "pipe" });
  return JSON.parse(readFileSync(path.join(out, "render-" + code + ".json"), "utf-8"));
}

/* Nomi cambiati nel sito nuovo ("Schedina" → "Le scelte del modello"): si applicano al testo vecchio. */
const renamed = (html) => String(html)
  .replace("La Schedina usa lo storico", "Le scelte del modello usano lo storico")
  .replace("nessun correttivo viene applicato alla Schedina.", "nessun correttivo viene applicato alle scelte del modello.");

/* Riporta l'HTML nuovo alla forma del sito attuale (e toglie dal vecchio ciò che ora fa il browser). */
function normalize(html) {
  return String(html)
    .replace(/<a class="team-link ff-btn" href="[^"]*" data-team="([^"]*)">/g, '<button type="button" class="team-link" data-team="$1">')
    .replace(/(<button type="button" class="team-link" data-team="[^"]*">[^<]*)<\/a>/g, "$1</button>")
    .replace(/ data-(home|away|kickoff|share-text|share-url|team-row)="[^"]*"/g, "")
    .replace(/<a class="share-btn ff-btn" href="[^"]*">Pagina della partita →<\/a>/g, "")
    .replace(/<a class="share-btn ff-btn" href="[^"]*">Apri la partita →<\/a>/g, "")
    .replace(/<button type="button" class="share-btn" data-goto-match="[^"]*">Apri la partita →<\/button>/g, "")
    .replace(/<div class="match-stale-note">[^<]*<\/div>/g, "")
    .replace(/<div class="stat wide"><div class="k">Quote eque 1 · X · 2<\/div><div class="v num">[^<]*<\/div><\/div>/g, "")
    .replace(/quota equa [^<·]* · /g, "")
    // Riquadri nuovi della pagina squadra, che il sito attuale non ha: marcatori (#134).
    .replace(/<div class="panel"><h2>Tra i capocannonieri<\/h2><div class="team-list">(?:<div><span>[^<]*<\/span><b>[^<]*<\/b><\/div>)*<\/div><\/div>/g, "");
}

/* Campionati che esistevano nel sito vecchio: la Copa del Rey c'è solo nel sito nuovo. */
const LEGACY = new Set(["SA", "PL", "CL", "BL1", "PD", "FL1", "EL", "UECL"]);
for (const L of LEAGUES.filter((l) => LEGACY.has(l.code))) {
  const prefix = L.file;
  const turno = read(prefix + "turno.json"), storico = read(prefix + "storico.json"), classifica = read(prefix + "classifica.json");
  test("stesso HTML del sito attuale · " + L.name, { skip: !turno && "dati non pubblicati" }, () => {
    const old = legacyRender(L.code);
    assert.deepEqual(old.errors, [], "il sito attuale non deve avere errori su questi dati");
    assert.ok(old.matches.length > 1000 && old.matches.includes('class="match'), "l'harness deve aver prodotto le partite");
    const ctx = { league: L.code, favs: [] };
    assert.equal(normalize(grouped(ctx, turno.matches)), normalize(old.matches), "Partite");
    assert.equal(normalize(nextRoundsPanel(ctx, turno.next_rounds)), normalize(old.nextRounds), "Prossime giornate");
    const s = storicoParts(storico);
    assert.equal(s.verdict, renamed(old.verdict), "Storico: in breve");
    assert.equal(s.quality, renamed(old.quality), "Storico: qualità del modello");
    assert.equal(recapPanel(storico && storico.recap), old.recap, "Storico: ultima giornata");
    assert.equal(normalize(seasonPanel(ctx, classifica && classifica.season)), normalize(old.season), "Classifica: fine stagione");
    if (old.teamName && old.team) {
      const name = old.teamName.replace(/&amp;/g, "&").replace(/&#39;/g, "'");
      assert.equal(normalize(teamPage(ctx, name, { turno, storico, classifica })), normalize(old.team), "Pagina squadra " + name);
    }
  });
}
