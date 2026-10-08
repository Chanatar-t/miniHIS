import { db } from "./db";
import { pickRange, type RangeRow } from "./rules";
import { age } from "./labels";

export type Range = { ref_low: number | null; ref_high: number | null; crit_low: number | null; crit_high: number | null };
const NONE: Range = { ref_low: null, ref_high: null, crit_low: null, crit_high: null };

export const todayIso = () => new Date().toLocaleDateString("sv-SE"); // local YYYY-MM-DD

export function approvedRanges(): RangeRow[] {
  return db.prepare("SELECT * FROM test_ranges WHERE status = 'APPROVED'").all() as RangeRow[];
}

// The range in force for this patient today; no approved range -> no flag (never guess)
export function rangeFor(rows: RangeRow[], testId: number, sex: string, dob: string): Range {
  const r = pickRange(rows, testId, sex, age(dob), todayIso());
  return r ? { ref_low: r.ref_low, ref_high: r.ref_high, crit_low: r.crit_low, crit_high: r.crit_high } : NONE;
}

// SQL: the range stored with a result when it was flagged; older results without a snapshot fall back to the catalog default
export const RESULT_RANGE_SQL = `coalesce(i.ref_low, t.ref_low) AS ref_low, coalesce(i.ref_high, t.ref_high) AS ref_high,
  coalesce(i.crit_low, t.crit_low) AS crit_low, coalesce(i.crit_high, t.crit_high) AS crit_high`;
