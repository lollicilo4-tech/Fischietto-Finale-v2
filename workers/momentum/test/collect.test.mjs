import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collect, ourMatches, sampleFromPayload, storeSamples, MAX_DETAILS, RETENTION_MS } from "../src/collect.js";
import worker from "../src/index.js";
import { fakeD1 } from "./fake-d1.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(path.resolve(here, "../../../tests/fixtures/sportscore_match.json"), "utf-8"));
const T0 = Date.parse("2026-10-23T20:30:00Z");

/* Partita del fixture (Zira-Sumgayit) spostata in Serie A, così rientra nei nostri campionati. */
function liveRow(slug, league = "Serie A", extra = {}) {
  return { ...fixture.match, slug, url: undefined, competition: league, ...extra };
}
function detail(minute, attacks, shots) {
  const m = JSON.parse(JSON.stringify(fixture.match));
  m.live_minute = String(minute);
  m.stats = [{ name: "Dangerous Attacks", home: attacks[0], away: attacks[1] }, { name: "Shots on Target", home: shots[0], away: shots[1] }];
  return { match: m };
}
function fakeFetch(routes, calls = []) {
  return async (url, init) => {
    calls.push({ url, ua: init && init.headers && init.headers["User-Agent"] });
    for (const [part, body] of routes) if (url.includes(part)) {
      if (body instanceof Error) return new Response("errore", { status: 503 });
      return Response.json(typeof body === "function" ? body(url) : body);
    }
    return new Response("non trovato", { status: 404 });
  };
}

test("registra un campione al minuto per le partite dei nostri campionati", async () => {
  const db = fakeD1(), calls = [];
  const routes = [
    ["/api/v1/fixtures/", { fixtures: [liveRow("inter-vs-milan"), liveRow("zira-vs-sumgayit", "Azerbaijan Cup"), liveRow("arsenal-vs-chelsea", "Premier League")] }],
    ["slug=inter-vs-milan", detail(30, [20, 10], [3, 1])],
    ["slug=arsenal-vs-chelsea", detail(12, [5, 6], [0, 2])]
  ];
  const report = await collect({ fetch: fakeFetch(routes, calls), db, now: T0 });
  assert.deepEqual({ live: report.live, ours: report.ours, saved: report.saved, error: report.error }, { live: 3, ours: 2, saved: 2, error: null });
  assert.equal(calls.filter((c) => c.url.includes("sportscore.com")).length, 3, "una lista e due dettagli: la coppa azera non si scarica");
  assert.ok(calls.every((c) => /FischiettoFinale/.test(c.ua)), "il servizio sa chi lo interroga");
  const rows = db.raw.prepare("SELECT slug, minute, h, a FROM samples ORDER BY slug").all();
  assert.deepEqual(rows.map((r) => ({ ...r })), [
    { slug: "arsenal-vs-chelsea", minute: 12, h: 5, a: 14 },
    { slug: "inter-vs-milan", minute: 30, h: 32, a: 14 }
  ], "pressione = attacchi pericolosi + 4 × tiri in porta, come nel Live Center");
  const meta = JSON.parse(db.raw.prepare("SELECT value FROM meta WHERE key = 'last_run'").get().value);
  assert.equal(meta.saved, 2);
});

test("il recupero del 1° tempo e il 46' finiscono nello stesso campione", async () => {
  const db = fakeD1();
  const info = { slug: "a-vs-b", home: "A", away: "B", league: "Serie A", status: "" };
  await storeSamples(db, [{ ...info, minute: 47, h: 30, a: 10 }], T0);
  await storeSamples(db, [{ ...info, minute: 46, h: 33, a: 12 }], T0 + 60000);
  await storeSamples(db, [{ ...info, minute: 48, h: 36, a: 12 }], T0 + 120000);
  const rows = db.raw.prepare("SELECT minute, h, a FROM samples ORDER BY minute").all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [{ minute: 47, h: 33, a: 12 }, { minute: 48, h: 36, a: 12 }]);
});

test("se manca il minuto o mancano le statistiche non salva niente", () => {
  const info = { slug: "x", home: "A", away: "B", league: "Serie A", status: "" };
  const noStats = JSON.parse(JSON.stringify(fixture)); noStats.match.stats = [];
  assert.equal(sampleFromPayload(info, noStats), null);
  const noMinute = JSON.parse(JSON.stringify(fixture)); delete noMinute.match.live_minute; noMinute.match.status_text = ""; noMinute.match.incidents = [];
  assert.equal(sampleFromPayload(info, noMinute), null);
});

test("lista principale vuota: usa le fonti di riserva, ma solo le partite davvero live", async () => {
  const db = fakeD1(), calls = [];
  const routes = [
    ["/api/v1/fixtures/", { fixtures: [] }],
    ["/api/v1/matches/", { matches: [liveRow("lazio-vs-roma", "Serie A", { status: "finished", status_text: "FT" }), liveRow("juve-vs-toro")] }],
    ["/api/widget/matches/", new Error("giù")],
    ["slug=juve-vs-toro", detail(70, [40, 30], [5, 4])]
  ];
  const report = await collect({ fetch: fakeFetch(routes, calls), db, now: T0 });
  assert.equal(report.ours, 1, "la partita finita non si registra");
  assert.equal(report.saved, 1);
});

test("feed non raggiungibile: nessun errore lanciato, il problema finisce in /health", async () => {
  const db = fakeD1();
  const report = await collect({ fetch: fakeFetch([["sportscore.com", new Error("giù")]]), db, now: T0 });
  assert.match(report.error, /All SportScore live endpoints failed/);
  const res = await worker.fetch(new Request("https://w.example/health"), { DB: db });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).ok, false);
});

test("un dettaglio che fallisce non blocca gli altri", async () => {
  const db = fakeD1();
  const routes = [
    ["/api/v1/fixtures/", { fixtures: [liveRow("a-vs-b"), liveRow("c-vs-d")] }],
    ["slug=a-vs-b", new Error("giù")],
    ["slug=c-vs-d", detail(10, [2, 1], [0, 0])]
  ];
  const report = await collect({ fetch: fakeFetch(routes), db, now: T0 });
  assert.deepEqual([report.saved, report.failed], [1, 1]);
});

test("al massimo MAX_DETAILS partite, slug strani scartati", () => {
  const live = Array.from({ length: 60 }, (_, i) => liveRow("m" + i + "-vs-x"));
  live.push(liveRow("../../etc"), liveRow("ok-vs-ok"));
  const out = ourMatches(live);
  assert.equal(out.length, MAX_DETAILS);
  assert.ok(out.every((m) => /^[a-z0-9-]+$/.test(m.slug)));
  assert.ok(MAX_DETAILS + 3 <= 50, "dentro il limite di 50 richieste esterne del piano gratuito");
});

test("pulizia oraria dei dati più vecchi di 12 ore", async () => {
  const db = fakeD1();
  const info = { slug: "vecchia", home: "A", away: "B", league: "Serie A", status: "" };
  await storeSamples(db, [{ ...info, minute: 10, h: 1, a: 1 }], T0 - RETENTION_MS - 1000);
  const onTheHour = Date.parse("2026-10-23T21:00:00Z");
  await collect({ fetch: fakeFetch([["/api/v1/fixtures/", { fixtures: [] }], ["/api/v1/matches/", { matches: [] }], ["/api/widget/matches/", { matches: [] }]]), db, now: onTheHour });
  assert.equal(db.raw.prepare("SELECT count(*) AS n FROM samples").get().n, 0);
  assert.equal(db.raw.prepare("SELECT count(*) AS n FROM matches").get().n, 0);
});

test("/health ok quando l'ultima esecuzione è recente, 404 altrove", async () => {
  const db = fakeD1();
  await collect({ fetch: fakeFetch([["/api/v1/fixtures/", { fixtures: [] }], ["/api/v1/matches/", { matches: [] }], ["/api/widget/matches/", { matches: [] }]]), db, now: Date.now() });
  const res = await worker.fetch(new Request("https://w.example/health"), { DB: db });
  assert.equal(res.status, 200);
  assert.equal((await worker.fetch(new Request("https://w.example/"), { DB: db })).status, 404);
});

test("il cron passa al runtime la raccolta da attendere", async () => {
  const db = fakeD1(), waits = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch([["sportscore.com", { fixtures: [] }]]);
  try {
    await worker.scheduled({ scheduledTime: T0 }, { DB: db }, { waitUntil: (p) => waits.push(p) });
    assert.equal(waits.length, 1);
    await waits[0];
  } finally { globalThis.fetch = realFetch; }
  assert.ok(db.raw.prepare("SELECT value FROM meta").get());
});

test("non registra campionati con nomi simili ai nostri e annota i nomi visti", async () => {
  const db = fakeD1();
  const routes = [
    ["/api/v1/fixtures/", { fixtures: [liveRow("idv-vs-catolica", "LigaPro Serie A"), liveRow("zira-vs-sumgayit", "Azerbaijan Premier League"), liveRow("inter-vs-milan", "Serie A")] }],
    ["slug=inter-vs-milan", detail(30, [20, 10], [3, 1])]
  ];
  const report = await collect({ fetch: fakeFetch(routes), db, now: T0 });
  assert.equal(report.ours, 1);
  assert.deepEqual(report.ourLeagues, ["Serie A"]);
  assert.deepEqual(report.leagues, ["LigaPro Serie A", "Azerbaijan Premier League", "Serie A"]);
});
