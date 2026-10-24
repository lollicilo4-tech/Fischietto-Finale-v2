/* Partite del calendario cercate per nome quando la lista live di SportScore non le elenca. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collect, REQUEST_LIMIT } from "../src/collect.js";
import { teamCandidates, teamsInSearch, dueMatches, slugPairs, isSameMatch, MAX_SEARCHES } from "../src/calendar.js";
import { onRequestGet as liveApi } from "../../../web/functions/api/live.js";
import { fakeD1 } from "./fake-d1.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(path.resolve(here, "../../../tests/fixtures/sportscore_match.json"), "utf-8"));
const T0 = Date.parse("2026-10-24T13:30:00Z");
const CAL = "https://site.test/live-calendar.json";
const cal = (home, away, kickoff = "2026-10-24T13:00:00Z", league = "SA", liveKey = "serie-a", id = home + away) => ({ league, liveKey, id, home, away, kickoff });
const team = (name, slug) => ({ name, slug, url: "/football/team/" + slug + "/x1/" });
function detail(home, away, competition, extra = {}) {
  const m = JSON.parse(JSON.stringify(fixture.match));
  Object.assign(m, { home, away, competition, time: "2026-10-24T13:00:00+00:00", live_minute: "30", status: "live", status_text: "1st half",
    url: "/football/match/" + away.toLowerCase() + "-vs-" + home.toLowerCase() + "/abc123/", ...extra });
  m.stats = [{ name: "Dangerous Attacks", home: 20, away: 10 }, { name: "Shots on Target", home: 3, away: 1 }];
  return { match: m };
}
function fakeFetch(routes, calls) {
  return async (url) => {
    calls.push(url);
    for (const [part, body] of routes) if (url.includes(part)) {
      if (body instanceof Error) return new Response("errore", { status: 503 });
      return Response.json(typeof body === "function" ? body(url) : body);
    }
    return new Response("non trovato", { status: 404 });
  };
}
const emptyList = [["/api/v1/fixtures/", { fixtures: [] }], ["/api/v1/matches/", { matches: [] }], ["/api/widget/matches/", { matches: [] }]];

test("trova per nome la partita che la lista live non elenca e la passa al Live", async () => {
  const db = fakeD1(), calls = [];
  const routes = [
    ["live-calendar.json", { matches: [cal("Cagliari", "Bologna"), cal("Lazio", "Roma", "2026-10-24T18:45:00Z")] }],
    ["q=Cagliari", { teams: [team("Cagliari U19", "cagliari-u19"), team("Cagliari", "cagliari")] }],
    ["q=Bologna", { results: { teams: [team("Bologna", "bologna"), team("Bologna Women", "bologna-women")] } }],
    ["slug=cagliari-vs-bologna", detail("Cagliari", "Bologna", "Italian Serie A")],
    ...emptyList
  ];
  const r1 = await collect({ fetch: fakeFetch(routes, calls), db, now: T0, calendarUrl: CAL });
  assert.equal(r1.error, null);
  assert.deepEqual([r1.calendar, r1.searches, r1.guesses, r1.saved, r1.rows], [1, 2, 1, 1, 1], "Lazio-Roma non è ancora iniziata");
  assert.deepEqual(r1.unresolved, []);
  const slug = db.raw.prepare("SELECT slug FROM match_slugs").get().slug;
  assert.equal(slug, "bologna-vs-cagliari", "si salva lo slug vero, dall'indirizzo della partita");
  assert.deepEqual(JSON.parse(db.raw.prepare("SELECT slugs FROM team_slugs WHERE name = 'Cagliari'").get().slugs), ["cagliari"], "niente giovanili");

  // Minuto dopo: niente ricerche, si chiede direttamente il dettaglio con lo slug salvato.
  const calls2 = [];
  const routes2 = [["slug=bologna-vs-cagliari", detail("Cagliari", "Bologna", "Italian Serie A", { live_minute: "31" })], ...routes];
  const r2 = await collect({ fetch: fakeFetch(routes2, calls2), db, now: T0 + 60000, calendarUrl: CAL });
  assert.deepEqual([r2.searches, r2.guesses, r2.saved], [0, 0, 1]);
  assert.ok(!calls2.some((u) => u.includes("search")));
  assert.deepEqual(db.raw.prepare("SELECT minute FROM samples ORDER BY minute").all().map((x) => x.minute), [30, 31]);

  // Il sito legge la riga da /api/live.
  const res = await liveApi({ request: new Request("https://fischiettofinale.com/api/live"), env: { DB: db }, waitUntil() {}, now: T0 + 60000 });
  const body = await res.json();
  assert.equal(body.available, true);
  assert.equal(body.matches.length, 1);
  assert.deepEqual([body.matches[0].home, body.matches[0].competition, body.matches[0].live_minute], ["Cagliari", "Italian Serie A", "31"]);
  assert.equal(body.matches[0].stats, undefined, "niente statistiche nella lista");
});

test("un dettaglio di un altro campionato o di un altro giorno non viene accettato", async () => {
  const db = fakeD1(), calls = [];
  const routes = [
    ["live-calendar.json", { matches: [cal("Inter", "Milan")] }],
    ["q=Inter", { teams: [team("Inter Milan", "inter-milan"), team("Inter Miami", "inter-miami")] }],
    ["q=Milan", { teams: [team("AC Milan", "ac-milan")] }],
    ["slug=inter-milan-vs-ac-milan", detail("Inter", "Milan", "Italian Serie A", { time: "2026-11-30T19:45:00+00:00" })],
    ["slug=inter-miami-vs-ac-milan", detail("Inter Miami", "AC Milan", "MLS")],
    ...emptyList
  ];
  const report = await collect({ fetch: fakeFetch(routes, calls), db, now: T0, calendarUrl: CAL });
  assert.deepEqual(report.unresolved, ["Inter - Milan"]);
  assert.equal(report.saved, 0);
  assert.ok(calls.some((u) => u.includes("q=Inter%20Milan")), "i nomi brevi si cercano per esteso");
  assert.equal(db.raw.prepare("SELECT tries FROM match_slugs").get().tries, 2);
});

test("con tante partite in corso non supera mai il limite di richieste", async () => {
  const db = fakeD1(), calls = [];
  const many = Array.from({ length: 30 }, (_, i) => cal("Casa" + i, "Ospite" + i, "2026-10-24T13:00:00Z", "BL1", "bundesliga", String(i)));
  const listRows = Array.from({ length: 40 }, (_, i) => ({ ...fixture.match, home: "L" + i, url: "/football/match/l" + i + "-vs-x/1/", competition: "Serie A" }));
  const routes = [
    ["live-calendar.json", { matches: many }],
    ["/api/v1/fixtures/", { fixtures: listRows }],
    ["search", (u) => { const q = decodeURIComponent(u.split("q=")[1]); return { teams: [team(q, q.toLowerCase())] }; }],
    ["slug=casa", (u) => { const i = u.match(/casa(\d+)/)[1]; return detail("Casa" + i, "Ospite" + i, "Bundesliga"); }],
    ["slug=", detail("A", "B", "Serie A")]
  ];
  // Metà delle partite ha già lo slug salvato da un minuto precedente.
  many.slice(15).forEach((m) => db.raw.prepare("INSERT INTO match_slugs (match_key, slug, tries, updated_at) VALUES (?, ?, 1, ?)").run("BL1:" + m.id, "casa" + m.id + "-vs-ospite" + m.id, T0));
  const report = await collect({ fetch: fakeFetch(routes, calls), db, now: T0, calendarUrl: CAL });
  assert.ok(calls.length <= REQUEST_LIMIT, calls.length + " richieste");
  assert.equal(report.searches, MAX_SEARCHES);
  assert.ok(report.skipped > 0, "le partite in più si registrano nei minuti successivi");
});

test("candidati: prima squadra, nome identico per primo, al massimo 3", () => {
  const results = teamsInSearch({ teams: [team("Cagliari Beach", "cagliari-beach"), team("Ferrini Cagliari", "ferrini-cagliari"),
    team("Cagliari U20", "cagliari-u20"), team("Cagliari", "cagliari"), team("Cagliari Women", "cagliari-women")] });
  assert.deepEqual(teamCandidates("Cagliari", results), ["cagliari", "ferrini-cagliari"]);
  assert.deepEqual(teamCandidates("Man City", [team("Manchester City U21", "x"), team("Manchester City", "manchester-city")]), ["manchester-city"]);
  assert.deepEqual(slugPairs(["a", "b"], ["c"]), ["a-vs-c", "b-vs-c"]);
});

test("finestra: da 5 minuti prima a 2 ore e mezza dopo il calcio d'inizio", () => {
  const list = [cal("A", "B", "2026-10-24T13:34:00Z"), cal("C", "D", "2026-10-24T13:40:00Z"), cal("E", "F", "2026-10-24T11:01:00Z"), cal("G", "H", "2026-10-24T10:59:00Z")];
  assert.deepEqual(dueMatches(list, T0).map((m) => m.home), ["A", "E"]);
  assert.equal(isSameMatch(cal("A", "B"), detail("A", "B", "Spanish La Liga")), false);
  assert.equal(isSameMatch(cal("A", "B"), detail("A", "B", "Italian Serie A")), true);
});

test("/api/live senza database o con righe vecchie: lista vuota", async () => {
  const none = await liveApi({ request: new Request("https://x.test/api/live"), env: {}, waitUntil() {} });
  assert.deepEqual(await none.json(), { matches: [], available: false });
  const db = fakeD1();
  db.raw.prepare("INSERT INTO live_rows (slug, league, row, live, updated_at) VALUES ('a-vs-b', 'serie-a', '{\"home\":\"A\"}', 1, ?)").run(T0 - 10 * 60000);
  db.raw.prepare("INSERT INTO live_rows (slug, league, row, live, updated_at) VALUES ('c-vs-d', 'serie-a', '{\"home\":\"C\"}', 0, ?)").run(T0);
  const res = await liveApi({ request: new Request("https://x.test/api/live"), env: { DB: db }, waitUntil() {}, now: T0 });
  assert.deepEqual((await res.json()).matches, [], "righe di più di 3 minuti fa o partite finite non si mostrano");
});
