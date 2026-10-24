/* Calendario per il Worker del momentum: comprende le partite già iniziate (rimaste solo in next_rounds). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

test("le partite iniziate restano nel calendario, senza doppioni", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ff-cal-"));
  const m = (id, home, away, kickoff) => ({ id, home, away, kickoff });
  writeFileSync(path.join(dir, "turno.json"), JSON.stringify({
    matches: [m("3", "Lazio", "Parma", "2026-10-24T18:45:00Z")],
    next_rounds: [
      { matchday: 8, matches: [m("2", "Napoli", "Roma", "2026-10-24T16:00:00Z"), m("3", "Lazio", "Parma", "2026-10-24T18:45:00Z")] },
      { matchday: 9, matches: [m("9", "Roma", "Lecce", "2026-11-01T14:00:00Z")] }
    ]
  }));
  process.env.FF_DATA_DIR = dir;
  const { liveCalendar } = await import("../src/lib/data.js");
  const cal = liveCalendar();
  assert.deepEqual(cal.map((x) => x.home + "-" + x.away), ["Napoli-Roma", "Lazio-Parma", "Roma-Lecce"]);
  assert.deepEqual(cal[0], { league: "SA", liveKey: "serie-a", id: "2", home: "Napoli", away: "Roma", kickoff: "2026-10-24T16:00:00Z" });
  delete process.env.FF_DATA_DIR;
});
