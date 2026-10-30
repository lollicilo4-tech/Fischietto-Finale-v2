/* Pagine indicizzabili: strumenti fuori, classifiche senza tabella e storici vuoti fuori, squadre solo di coppa fuori. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sectionIndexable, teamIndexable, MIN_HISTORY } from "../src/lib/indexing.js";

const full = { classifica: { table: [{ team: "Inter" }, { team: "Milan" }] }, storico: { n: 40 } };
test("sezioni", () => {
  for (const s of ["home", "partite", "classifica", "storico"]) assert.equal(sectionIndexable(s, full), true, s);
  for (const s of ["sicure", "schedina"]) assert.equal(sectionIndexable(s, full), false, s);
  assert.equal(sectionIndexable("classifica", { classifica: { table: [] } }), false, "coppa a eliminazione diretta");
  assert.equal(sectionIndexable("storico", { storico: { n: MIN_HISTORY - 1 } }), false);
  assert.equal(sectionIndexable("storico", { storico: null }), false);
  assert.equal(sectionIndexable("storico", { storico: { n: MIN_HISTORY } }), true);
});
test("squadre", () => {
  assert.equal(teamIndexable("Inter", full), true);
  assert.equal(teamIndexable("Alavés", { classifica: { table: [] } }), false);
  assert.equal(teamIndexable("Inter", {}), false);
});
