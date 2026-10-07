import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { seed } from "./seed";

// ponytail: SQLite file DB, single process. Swap to Postgres when it needs multiple app servers.
const DB_FILE = process.env.DB_FILE ?? path.join(process.cwd(), "data", "his.db");

function open(): DatabaseSync {
  mkdirSync(path.dirname(DB_FILE), { recursive: true });
  const db = new DatabaseSync(DB_FILE);
  db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  // BEGIN IMMEDIATE: if several processes start at once (next build workers), only one creates the schema
  tx(db, () => {
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'users'").get()) return;
    db.exec(readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8"));
    seed(db);
  });
  return db;
}

// survive Next.js dev hot reload
const g = globalThis as unknown as { __db?: DatabaseSync };
export const db = (g.__db ??= open());

export function tx<T>(d: DatabaseSync, fn: () => T): T {
  d.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    d.exec("COMMIT");
    return out;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

// Atomic running number: never use SELECT MAX()+1 (two users get the same number).
export function nextNumber(d: DatabaseSync, name: string): number {
  const row = d
    .prepare(
      "INSERT INTO counters(name, value) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value",
    )
    .get(name) as { value: number };
  return row.value;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const yymmdd = (t = new Date()) => `${pad(t.getFullYear() % 100)}${pad(t.getMonth() + 1)}${pad(t.getDate())}`;

export const newHn = (d: DatabaseSync) => `HN${pad(nextNumber(d, "HN"), 7)}`;

// daily running number, e.g. VN2610070001
function dailyNo(d: DatabaseSync, prefix: string, width: number) {
  const day = yymmdd();
  return `${prefix}${day}${pad(nextNumber(d, `${prefix}-${day}`), width)}`;
}
export const newVn = (d: DatabaseSync) => dailyNo(d, "VN", 4);
export const newAccession = (d: DatabaseSync) => dailyNo(d, "L", 4); // printed as Code128 on the tube
export const newShipmentNo = (d: DatabaseSync) => dailyNo(d, "SH", 3);

export function audit(
  d: DatabaseSync,
  userId: number | null,
  action: string,
  entity: string,
  entityId: number | bigint | null,
  detail?: string,
) {
  d.prepare(
    "INSERT INTO audit_log(user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)",
  ).run(userId, action, entity, entityId, detail ?? null);
}
