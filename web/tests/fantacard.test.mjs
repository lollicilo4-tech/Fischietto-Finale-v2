/* Immagini dei consigli fantacalcio: dati, PNG della misura giusta, casi senza dati, nessuna parola da scommesse. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setLang } from "../src/lib/i18n.js";
import * as K from "../src/lib/fantacard.js";

const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs");
const turno = existsSync(path.join(docs, "turno.json")) ? JSON.parse(readFileSync(path.join(docs, "turno.json"), "utf-8")) : null;
const BETTING_WORDS = /\b(quot[ae]|schedin[ae]|bomba|più sicur[ae]|scommett\w*)\b/i;
const size = (data) => { const png = Buffer.from(data); return ({ png: png.readUInt32BE(0) === 0x89504e47, width: png.readUInt32BE(16), height: png.readUInt32BE(20) }); };
const M = (id, home, away, xg, kickoff = "2026-11-01T14:00:00Z") => ({ id, home, away, xg, kickoff, prob: { p1: 0.4, px: 0.3, p2: 0.3 } });

test("dati dell'immagine: giornata, prima partita e tre squadre per lista", () => {
  setLang("it");
  const d = K.cardData({ matchday: 9, matches: [M(1, "Inter", "Lecce", [2.1, 0.6], "2026-10-31T17:00:00Z"), M(2, "Roma", "Genoa", [1.5, 0.9]), M(3, "Como 1907", "Pisa", [1.2, 1.4])] });
  assert.equal(d.day, "GIORNATA 9");
  assert.equal(d.deadline, "Prima partita: Sab 31 ott 18:00");
  assert.deepEqual(d.attack.map((x) => x.team), ["Inter", "Roma", "Pisa"]);
  assert.equal(d.attack[0].sub, "in casa con Lecce");
  assert.equal(d.attack[0].value, "2,10");
  assert.equal(d.defence[0].team, "Inter");
  assert.match(d.defence[0].value, /^\d+%$/);
  assert.equal(d.avoid[0].team, "Lecce");
  setLang("en");
  const again = K.cardData({ matchday: 9, matches: [M(1, "Inter", "Lecce", [2.1, 0.6], "2026-10-31T17:00:00Z")] });
  assert.equal(again.deadline, "Prima partita: Sab 31 ott 18:00", "in italiano anche dopo una pagina inglese");
  assert.equal(again.attack[0].value, "2,10");
  const empty = K.cardData(null);
  assert.equal(empty.day, "PROSSIMA GIORNATA");
  assert.deepEqual([empty.attack, empty.defence, empty.avoid, empty.deadline], [[], [], [], ""]);
});

test("PNG della misura giusta, con e senza dati", async () => {
  for (const t of [turno, null, { matchday: 3, matches: [M(1, "Hellas Verona", "Internazionale Milano", [0.4, 3.1])] }]) {
    const d = K.cardData(t);
    assert.deepEqual(size(await K.renderPng(K.socialTree(d), K.SOCIAL)), { png: true, ...K.SOCIAL });
    assert.deepEqual(size(await K.renderPng(K.previewTree(d), K.PREVIEW)), { png: true, ...K.PREVIEW });
  }
});

test("la risposta degli endpoint è un PNG anche se i dati sono rovinati", async () => {
  const res = await K.pngResponse("social", { matchday: 1, matches: [{ home: "A", away: "B", xg: "rotto" }] });
  assert.equal(res.headers.get("Content-Type"), "image/png");
  assert.deepEqual(size(Buffer.from(await res.arrayBuffer())), { png: true, ...K.SOCIAL });
});

test("nessuna parola da scommesse nei testi dell'immagine", () => {
  const words = [];
  const walk = (n) => { if (typeof n === "string") words.push(n); else if (n && n.props) [].concat(n.props.children || []).forEach(walk); };
  walk(K.socialTree(K.cardData(turno)));
  walk(K.previewTree(K.cardData(turno)));
  const all = words.join(" ");
  assert.ok(all.includes(K.SITE_LABEL));
  assert.ok(!BETTING_WORDS.test(all), "contiene «" + (all.match(BETTING_WORDS) || [])[0] + "»");
});
