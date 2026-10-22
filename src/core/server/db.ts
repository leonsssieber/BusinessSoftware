import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";

export type Param = SQLInputValue | boolean | undefined | Date;

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

function toSql(value: Param): SQLInputValue {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  return value;
}

/** Thin wrapper over node:sqlite with statement caching, transactions and migrations. */
export class Db {
  readonly raw: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();
  private txDepth = 0;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.raw = new DatabaseSync(path);
    this.raw.exec("PRAGMA foreign_keys = ON;");
    this.raw.exec("PRAGMA busy_timeout = 5000;");
    if (path !== ":memory:") this.raw.exec("PRAGMA journal_mode = WAL;");
  }

  private stmt(sql: string): StatementSync {
    let s = this.statements.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.statements.set(sql, s);
    }
    return s;
  }

  run(sql: string, ...params: Param[]): { changes: number; lastInsertRowid: number } {
    const r = this.stmt(sql).run(...params.map(toSql));
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  get<T>(sql: string, ...params: Param[]): T | undefined {
    return this.stmt(sql).get(...params.map(toSql)) as T | undefined;
  }

  all<T>(sql: string, ...params: Param[]): T[] {
    return this.stmt(sql).all(...params.map(toSql)) as T[];
  }

  /** Runs `fn` in a transaction. Nested calls join the outer transaction. */
  tx<T>(fn: () => T): T {
    if (this.txDepth > 0) return fn();
    this.raw.exec("BEGIN IMMEDIATE");
    this.txDepth++;
    try {
      const result = fn();
      this.raw.exec("COMMIT");
      return result;
    } catch (err) {
      this.raw.exec("ROLLBACK");
      throw err;
    } finally {
      this.txDepth--;
    }
  }

  migrate(namespace: string, migrations: Migration[]): void {
    this.raw.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      namespace TEXT NOT NULL,
      version INTEGER NOT NULL,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      PRIMARY KEY (namespace, version)
    )`);
    const applied = new Set(
      this.all<{ version: number }>(
        "SELECT version FROM schema_migrations WHERE namespace = ?",
        namespace,
      ).map((r) => r.version),
    );
    const pending = [...migrations]
      .sort((a, b) => a.version - b.version)
      .filter((m) => !applied.has(m.version));
    for (const m of pending) {
      this.tx(() => {
        this.raw.exec(m.sql);
        this.run(
          "INSERT INTO schema_migrations (namespace, version, name, applied_at) VALUES (?, ?, ?, ?)",
          namespace,
          m.version,
          m.name,
          new Date().toISOString(),
        );
      });
    }
  }

  close(): void {
    this.statements.clear();
    this.raw.close();
  }
}

/** Parses a JSON column, returning `fallback` for null or malformed values. */
export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (value == null || value === "") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
