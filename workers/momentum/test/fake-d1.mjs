/* D1 per i test: SQLite vero (node:sqlite) con la stessa interfaccia usata dal Worker e dalla
   Pages Function: prepare().bind().all()/first()/run() e batch(). Lo schema è quello di schema.sql. */
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const schema = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../schema.sql"), "utf-8");

class Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new Statement(this.db, this.sql, params); }
  async all() { return { results: this.db.prepare(this.sql).all(...this.params), success: true }; }
  async first() { return this.db.prepare(this.sql).get(...this.params) || null; }
  async run() { this.db.prepare(this.sql).run(...this.params); return { success: true }; }
}

export function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(schema);
  return {
    raw: db,
    prepare: (sql) => new Statement(db, sql),
    async batch(stmts) {
      db.exec("BEGIN");
      try { const out = []; for (const s of stmts) out.push(await s.run()); db.exec("COMMIT"); return out; }
      catch (e) { db.exec("ROLLBACK"); throw e; }
    }
  };
}
