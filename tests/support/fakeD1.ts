// A small D1 stand-in over node:sqlite, so tests run the real migrations and the real SQL.
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Val = string | number | null;

class Stmt {
  args: Val[] = [];
  constructor(
    private db: DatabaseSync,
    readonly sql: string,
  ) {}
  bind(...a: Val[]) {
    this.args = a;
    return this;
  }
  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.args) as T | undefined) ?? null;
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.args) as T[] };
  }
  async run() {
    this.db.prepare(this.sql).run(...this.args);
    return { success: true };
  }
}

export function fakeDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const dir = join(__dirname, "..", "..", "db", "migrations");
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) sqlite.exec(readFileSync(join(dir, f), "utf8"));
  const db = {
    prepare: (sql: string) => new Stmt(sqlite, sql),
    batch: async (stmts: Stmt[]) => {
      sqlite.exec("BEGIN");
      try {
        for (const s of stmts) await s.run();
        sqlite.exec("COMMIT");
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
      return [];
    },
  };
  return { sqlite, db: db as unknown as D1Database };
}
