/* /api/momentum (Pages Function) e uso dei campioni del server nel Live Center. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequestGet, parseSlugs } from "../functions/api/momentum.js";
import { pickMomentum, liveChartsHtml } from "../src/lib/livecharts.js";
import { fakeD1 } from "../../workers/momentum/test/fake-d1.mjs";
import { storeSamples } from "../../workers/momentum/src/collect.js";

const call = (qs, env) => onRequestGet({ request: new Request("https://fischiettofinale.com/api/momentum" + qs), env, waitUntil() {} });

test("restituisce i campioni salvati dal Worker, partita per partita", async () => {
  const db = fakeD1(), info = { home: "A", away: "B", league: "Serie A", status: "" };
  await storeSamples(db, [{ ...info, slug: "a-vs-b", minute: 10, h: 5, a: 2 }, { ...info, slug: "c-vs-d", minute: 3, h: 1, a: 1 }], 1);
  await storeSamples(db, [{ ...info, slug: "a-vs-b", minute: 11, h: 9, a: 2 }], 2);
  const res = await call("?slug=a-vs-b&slug=x-vs-y", { DB: db });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Cache-Control"), /max-age=30/);
  assert.deepEqual(await res.json(), { samples: { "a-vs-b": [{ m: 10, h: 5, a: 2 }, { m: 11, h: 9, a: 2 }] }, available: true });
});

test("richieste non valide e database non collegato", async () => {
  assert.equal((await call("", { DB: fakeD1() })).status, 400);
  assert.equal((await call("?slug=../etc;drop", { DB: fakeD1() })).status, 400, "slug con caratteri strani scartati");
  const noDb = await call("?slug=a-vs-b", {});
  assert.deepEqual(await noDb.json(), { samples: {}, available: false });
  const many = parseSlugs(new URL("https://x/?slug=" + Array.from({ length: 30 }, (_, i) => "m" + i).join(",")));
  assert.equal(many.length, 20, "al massimo 20 partite per richiesta");
});

test("il Live usa la serie del server solo se ha almeno due campioni", () => {
  const local = [{ m: 70, h: 1, a: 1 }];
  assert.deepEqual(pickMomentum([{ m: 1, h: 0, a: 0 }, { m: 2, h: 3, a: 1 }], local).source, "server");
  assert.deepEqual(pickMomentum([{ m: 1, h: 0, a: 0 }], local), { samples: local, source: "local" });
  assert.deepEqual(pickMomentum(null, local).source, "local");
  assert.deepEqual(pickMomentum([{ m: "x" }, { m: 2, h: 3, a: 1 }], local).source, "local", "campioni malformati ignorati");
});

test("il testo del grafico dice chi ha registrato i dati", () => {
  const momentum = [{ m: 5, h: 0, a: 0 }, { m: 6, h: 4, a: 1 }, { m: 7, h: 6, a: 5 }];
  const base = { home: "A", away: "B", homeScore: 0, awayScore: 0, status: "7", events: [], stats: [], momentum, priors: [] };
  assert.match(liveChartsHtml({ ...base, momentumSource: "server" }), /Registrato dal nostro server ogni minuto dal minuto 5/);
  assert.match(liveChartsHtml(base), /Registrato da quando hai aperto la partita/);
});
