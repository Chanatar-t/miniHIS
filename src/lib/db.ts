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
  // Schema is all IF NOT EXISTS: re-run on every start so new tables appear in an existing DB.
  // BEGIN IMMEDIATE: if several processes start at once (next build workers), only one seeds.
  tx(db, () => {
    db.exec(readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8"));
    if (!db.prepare("SELECT 1 FROM users").get()) seed(db);
    upgrade(db);
  });
  return db;
}

// Bring a DB created by an older version up to date: columns and seed rows added after day 1.
// ponytail: hand-written list; switch to numbered migration files once there are more than a few.
const ADDED_COLUMNS: [table: string, column: string, type: string][] = [
  ["lab_order_items", "message_id", "INTEGER REFERENCES inbound_messages(id)"],
  ["users", "can_approve_config", "INTEGER NOT NULL DEFAULT 0"],
  ["lab_tests", "active", "INTEGER NOT NULL DEFAULT 1"],
  ["lab_order_items", "ref_low", "REAL"],
  ["lab_order_items", "ref_high", "REAL"],
  ["lab_order_items", "crit_low", "REAL"],
  ["lab_order_items", "crit_high", "REAL"],
];
function upgrade(d: DatabaseSync) {
  for (const [table, column, type] of ADDED_COLUMNS) {
    const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  // second medtech for four-eyes demo (seeded from day 3)
  d.prepare("INSERT INTO users(username, name, role) SELECT 'lab2', 'ทนพ.สมศักดิ์ ตรวจดี', 'LAB' WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'lab2')").run();
  // pathologist: works in the lab and may approve reference-range changes
  d.prepare(
    "INSERT INTO users(username, name, role, can_approve_config) SELECT 'path', 'พญ.วิไล พยาธิ (พยาธิแพทย์)', 'LAB', 1 WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'path')",
  ).run();

  // first time: today's catalog ranges become version 1, plus the sex-specific ranges a real lab would use
  if (!d.prepare("SELECT 1 FROM test_ranges").get()) {
    const approver = (d.prepare("SELECT id FROM users WHERE username = 'path'").get() as { id: number }).id;
    const ins = d.prepare(
      `INSERT INTO test_ranges(test_id, sex, ref_low, ref_high, crit_low, crit_high, effective_from, status, reason, proposed_by, reviewed_by, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, '2026-01-01', 'APPROVED', ?, ?, ?, '2026-01-01 08:00:00')`,
    );
    const tests = d.prepare("SELECT id, code, ref_low, ref_high, crit_low, crit_high FROM lab_tests").all() as {
      id: number; code: string; ref_low: number | null; ref_high: number | null; crit_low: number | null; crit_high: number | null;
    }[];
    const bySex: Record<string, [sex: "M" | "F", lo: number, hi: number][]> = {
      CREA: [["M", 0.7, 1.2], ["F", 0.5, 0.9]],
      FERR: [["M", 30, 400], ["F", 13, 150]],
    };
    for (const t of tests) {
      ins.run(t.id, null, t.ref_low, t.ref_high, t.crit_low, t.crit_high, "ค่าเริ่มต้นจากระบบเดิม", approver, approver);
      for (const [sex, lo, hi] of bySex[t.code] ?? []) ins.run(t.id, sex, lo, hi, t.crit_low, t.crit_high, "ค่าอ้างอิงแยกตามเพศ", approver, approver);
    }
  }
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
