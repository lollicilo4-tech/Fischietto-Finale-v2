/* Calendario .ics della squadra: formato iCalendar valido, partite del turno e delle prossime giornate. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { teamCalendar, teamFixtures, icsText, fold } from "../src/lib/ics.js";
import { calendarUrl } from "../src/lib/core.js";
import { teamPage } from "../src/lib/render.js";
import { setLang } from "../src/lib/i18n.js";

const SITE = "https://fischiettofinale.com";
const turno = {
  generated_at: "2026-10-27T20:00+00:00",
  matches: [
    { id: 1, home: "Inter", away: "Milan", kickoff: "2026-10-28T19:45:00Z", prob: { p1: 0.5, px: 0.3, p2: 0.2 }, top_scores: [[1, 0, 0.1]] },
    { id: 2, home: "Roma", away: "Lazio", kickoff: "2026-10-29T17:00:00Z", prob: { p1: 0.4, px: 0.3, p2: 0.3 }, top_scores: [[1, 1, 0.1]] }
  ],
  next_rounds: [{ matchday: 10, matches: [{ id: 3, home: "Como 1907", away: "Inter", kickoff: "2026-11-02T14:00:00Z", prob: { p1: 0.3, px: 0.3, p2: 0.4 }, top: [1, 2] }] }]
};

test("partite della squadra in ordine, turno e prossime giornate", () => {
  assert.deepEqual(teamFixtures("Inter", turno).map((x) => [x.m.id, x.page]), [[1, true], [3, false]]);
  assert.deepEqual(teamFixtures("Juventus", turno), []);
});

test("formato iCalendar: CRLF, testo protetto, righe piegate", () => {
  setLang("it");
  const ics = teamCalendar({ site: SITE, league: "SA", team: "Inter", turno });
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.ok(!/[^\r]\n/.test(ics), "solo fine riga CRLF");
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.match(ics, /DTSTART:20261028T194500Z/);
  assert.match(ics, /DTSTAMP:20261027T200000Z/);
  assert.match(ics, /UID:sa-1@fischiettofinale\.com/);
  assert.match(ics, /URL:https:\/\/fischiettofinale\.com\/serie-a\/partita\/1-inter-milan\//);
  assert.match(ics, /URL:https:\/\/fischiettofinale\.com\/serie-a\/squadra\/inter\//, "senza pagina della partita: la scheda della squadra");
  assert.ok(ics.split("\r\n").every((line) => new TextEncoder().encode(line).length <= 75), "righe al massimo di 75 byte");
  const unfolded = ics.replace(/\r\n /g, "");
  assert.match(unfolded, /DESCRIPTION:Serie A\. Modello: 1 Inter 50% · X 30% · 2 Milan 20%\\, risultato probabile 1-0\. Stime statistiche\\, non un invito a scommettere\./);
  assert.equal(icsText("a,b;c\\d\ne"), "a\\,b\;c\\\\d\\ne");
  assert.equal(fold("x".repeat(80)), "x".repeat(75) + "\r\n " + "x".repeat(5));
  setLang("en");
  const en = teamCalendar({ site: SITE, league: "SA", team: "Inter", turno }).replace(/\r\n /g, "");
  assert.match(en, /URL:https:\/\/fischiettofinale\.com\/en\/serie-a\/match\/1-inter-milan\//);
  assert.match(en, /Model: 1 Inter 50%/);
  assert.match(en, /Team calendar\/\/EN/);
  setLang("it");
});

test("pulsante nella pagina squadra", () => {
  setLang("it");
  assert.equal(calendarUrl("SA", "Como 1907"), "/calendario/serie-a/como-1907.ics");
  const html = teamPage({ league: "SA", favs: [], site: SITE }, "Inter", { turno, storico: null, classifica: null });
  assert.match(html, /href="webcal:\/\/fischiettofinale\.com\/calendario\/serie-a\/inter\.ics"/);
  assert.match(html, /href="\/calendario\/serie-a\/inter\.ics" download/);
  assert.ok(!teamPage({ league: "SA", favs: [] }, "Inter", { turno, storico: null, classifica: null }).includes("webcal"), "senza indirizzo del sito niente pulsante");
  setLang("en");
  assert.match(teamPage({ league: "SA", favs: [], site: SITE }, "Inter", { turno, storico: null, classifica: null }), /webcal:\/\/fischiettofinale\.com\/en\/calendar\/serie-a\/inter\.ics/);
  setLang("it");
});
