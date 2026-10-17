import test from "node:test";
import assert from "node:assert/strict";
import worker, { LEAGUE_IDS, leagueIdFor, isLiveStatus, normalizeFixture, normalizeEvent } from "../src/index.js";

test("mappa le sei competizioni supportate", () => {
  assert.deepEqual(LEAGUE_IDS, { SA: 135, PL: 39, CL: 2, BL1: 78, PD: 140, FL1: 61 });
  assert.equal(leagueIdFor("SA"), 135);
  assert.equal(leagueIdFor("NOPE"), null);
});

test("riconosce gli stati live e rifiuta le partite non iniziate", () => {
  for (const status of ["1H", "HT", "2H", "ET", "BT", "P", "SUSP", "INT", "LIVE"]) {
    assert.equal(isLiveStatus(status), true, status);
  }
  for (const status of ["NS", "FT", "PST", "CANC"]) {
    assert.equal(isLiveStatus(status), false, status);
  }
});

test("normalizza punteggio, squadre e minuto senza inventare valori", () => {
  const match = normalizeFixture({
    fixture: { id: 123, date: "2026-10-17T19:00:00+00:00", status: { short: "2H", long: "Second Half", elapsed: 67, extra: null }, venue: { name: "Stadio" } },
    league: { id: 135, name: "Serie A", country: "Italy" },
    teams: { home: { id: 1, name: "Inter" }, away: { id: 2, name: "Roma" } },
    goals: { home: 2, away: 1 }
  });
  assert.equal(match.id, "123");
  assert.equal(match.home.name, "Inter");
  assert.equal(match.goals.home, 2);
  assert.equal(match.goals.away, 1);
  assert.equal(match.status.elapsed, 67);
  assert.deepEqual(match.events, []);
  assert.equal(normalizeFixture({}).goals.home, null);
});

test("normalizza eventi e genera identificativi stabili", () => {
  const raw = { time: { elapsed: 42, extra: 1 }, team: { id: 1, name: "Inter" }, player: { id: 9, name: "Player" }, assist: { name: "Assist" }, type: "Goal", detail: "Own Goal", comments: null };
  const first = normalizeEvent(raw, "123");
  const second = normalizeEvent(raw, "123");
  assert.equal(first.id, second.id);
  assert.equal(first.minute, 42);
  assert.equal(first.extra, 1);
  assert.equal(first.detail, "Own Goal");
  assert.equal(first.team, "Inter");
});

test("l'endpoint live segnala in modo chiaro il secret mancante", async () => {
  const req = new Request("https://worker.example/api/live?league=SA", { headers: { Origin: "https://lollicilo4-tech.github.io" } });
  const res = await worker.fetch(req, {});
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /API_FOOTBALL_KEY/);
});

test("l'endpoint rifiuta codici campionato sconosciuti", async () => {
  const req = new Request("https://worker.example/api/live?league=UNKNOWN", { headers: { Origin: "https://lollicilo4-tech.github.io" } });
  const res = await worker.fetch(req, { API_FOOTBALL_KEY: "test-only" });
  assert.equal(res.status, 400);
});
