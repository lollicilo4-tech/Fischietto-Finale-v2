/* Capocannonieri nella Classifica e nella pagina squadra, in italiano e in inglese. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scorersPanel, teamPage } from "../src/lib/render.js";
import { setLang } from "../src/lib/i18n.js";

const scorers = [
  { player: "Ademola Lookman", team: "Atalanta", goals: 8, assists: 4, penalties: null, played: 8 },
  { player: "Lautaro Martínez", team: "Inter", goals: 8, assists: 2, penalties: 1, played: 9 },
  { player: "<b>Kean</b>", team: "Fiorentina", goals: 6, assists: null, penalties: 2, played: 9 }
];

test("tabella dei capocannonieri con pari merito, rigori e dati sicuri", () => {
  setLang("it");
  const html = scorersPanel({ league: "SA", favs: ["Inter"] }, scorers);
  assert.match(html, /<h2>Capocannonieri<\/h2>/);
  const pos = [...html.matchAll(/<tr><td>(\d+)<\/td>/g)].map((m) => m[1]);
  assert.deepEqual(pos, ["1", "1", "3"], "a parità di gol stessa posizione");
  assert.match(html, /\(1 rig\.\)/);
  assert.match(html, /href="\/serie-a\/squadra\/inter\/"/);
  assert.match(html, /fav-star/, "squadra seguita con la stella");
  assert.ok(html.includes("&lt;b&gt;Kean&lt;/b&gt;") && !html.includes("<b>Kean"), "nomi sempre con esc()");
  assert.ok(!/undefined|NaN|null/.test(html));
  assert.equal(scorersPanel({ league: "SA", favs: [] }, []), "");
  assert.equal(scorersPanel({ league: "SA", favs: [] }, undefined), "");
  setLang("en");
  const en = scorersPanel({ league: "SA", favs: [] }, scorers);
  assert.match(en, /Top scorers/);
  assert.match(en, /\(1 pen\.\)/);
  assert.match(en, /href="\/en\/serie-a\/team\/inter\/"/);
  setLang("it");
});

test("marcatori nella pagina della squadra", () => {
  setLang("it");
  const classifica = { table: [{ pos: 1, team: "Inter", pg: 9, w: 7, d: 1, l: 1, gf: 20, ga: 6, pts: 22 }], scorers };
  const html = teamPage({ league: "SA", favs: [] }, "Inter", { turno: null, storico: null, classifica });
  assert.match(html, /Tra i capocannonieri<\/h2>.*Lautaro Martínez<\/span><b>8 gol<\/b>/s);
  assert.ok(!teamPage({ league: "SA", favs: [] }, "Roma", { turno: null, storico: null, classifica }).includes("capocannonieri"));
  setLang("en");
  assert.match(teamPage({ league: "SA", favs: [] }, "Inter", { turno: null, storico: null, classifica }), /Among the top scorers.*8 goals/s);
  setLang("it");
});
