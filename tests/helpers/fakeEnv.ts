// A tiny D1 and KV stand-in over node:sqlite, loaded with the real migrations, so route tests exercise the real SQL.
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Env } from "../../worker/env";

type Bind = (string | number | null)[];

class Stmt {
  constructor(private db: DatabaseSync, readonly sql: string, private args: Bind = []) {}
  bind(...args: Bind) {
    return new Stmt(this.db, this.sql, args);
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

export function fakeEnv(extra: Partial<Env> = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const dir = join(__dirname, "../../db/migrations");
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) sqlite.exec(readFileSync(join(dir, f), "utf8"));
  const kv = new Map<string, string>();
  const DB = {
    prepare: (sql: string) => new Stmt(sqlite, sql),
    batch: async (stmts: Stmt[]) => {
      for (const s of stmts) await s.run();
      return [];
    },
  };
  const SESSIONS = { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => void kv.set(k, v) };
  const env = { DB, SESSIONS, ...extra } as unknown as Env;
  return { env, sqlite, kv };
}
