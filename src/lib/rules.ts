// Pure domain rules — no DB, unit tested in tests/rules.test.ts

export type Flag = "LL" | "L" | "N" | "H" | "HH";

type Range = {
  ref_low: number | null;
  ref_high: number | null;
  crit_low: number | null;
  crit_high: number | null;
};

// Critical checked first: a critical value must never be reported as plain H/L.
export function flagResult(value: string, r: Range): Flag | null {
  const v = Number(value);
  if (value.trim() === "" || Number.isNaN(v)) return null; // text result, e.g. "Non-reactive"
  if (r.crit_low != null && v < r.crit_low) return "LL";
  if (r.crit_high != null && v > r.crit_high) return "HH";
  if (r.ref_low != null && v < r.ref_low) return "L";
  if (r.ref_high != null && v > r.ref_high) return "H";
  return "N";
}

// One tube per (specimen type, container, destination). In-house and each outlab get separate tubes
// because they physically go to different places.
export function groupIntoTubes<T extends { specimen_type: string; container: string; outlab_id: number | null }>(
  items: T[],
): T[][] {
  const tubes = new Map<string, T[]>();
  for (const it of items) {
    const key = `${it.specimen_type}|${it.container}|${it.outlab_id ?? "IN"}`;
    tubes.set(key, [...(tubes.get(key) ?? []), it]);
  }
  return [...tubes.values()];
}

// Order status is derived from its tests, never stored (a stored copy could drift out of sync).
// Rejected tests are ignored: a reject always re-queues a fresh ORDERED row for the same test.
export type OrderStatus = "WAITING" | "IN_PROGRESS" | "PARTIAL" | "COMPLETE" | "CANCELLED";
export function orderStatus(itemStatuses: string[]): OrderStatus {
  const live = itemStatuses.filter((s) => s !== "REJECTED" && s !== "CANCELLED");
  if (live.length === 0) return "CANCELLED";
  if (live.every((s) => s === "VERIFIED")) return "COMPLETE";
  if (live.some((s) => s === "VERIFIED")) return "PARTIAL";
  if (live.every((s) => s === "ORDERED")) return "WAITING";
  return "IN_PROGRESS";
}

export type RangeRow = {
  id: number; test_id: number; sex: "M" | "F" | null; age_min: number | null; age_max: number | null;
  ref_low: number | null; ref_high: number | null; crit_low: number | null; crit_high: number | null;
  effective_from: string; status: string;
};

// Which approved range applies to this patient today.
// Most specific scope wins (sex-specific > any sex; age-bounded > unbounded), then the newest version in effect.
export function pickRange(rows: RangeRow[], testId: number, sex: string, age: number, today: string): RangeRow | null {
  const score = (r: RangeRow) => (r.sex ? 2 : 0) + (r.age_min != null || r.age_max != null ? 1 : 0);
  const fits = rows.filter(
    (r) =>
      r.test_id === testId &&
      r.status === "APPROVED" &&
      r.effective_from <= today &&
      (r.sex == null || r.sex === sex) &&
      (r.age_min == null || age >= r.age_min) &&
      (r.age_max == null || age <= r.age_max),
  );
  fits.sort((a, b) => score(b) - score(a) || b.effective_from.localeCompare(a.effective_from) || b.id - a.id);
  return fits[0] ?? null;
}

// Sanity rules for a proposed range; returns a message for the proposer, or null if fine.
export function rangeProblem(r: {
  ref_low: number | null; ref_high: number | null; crit_low: number | null; crit_high: number | null; age_min: number | null; age_max: number | null;
}): string | null {
  if (r.ref_low == null && r.ref_high == null) return "ต้องมีค่าต่ำสุดหรือสูงสุดของช่วงปกติอย่างน้อยหนึ่งค่า";
  if (r.ref_low != null && r.ref_high != null && r.ref_low >= r.ref_high) return "ค่าต่ำสุดต้องน้อยกว่าค่าสูงสุด";
  if (r.crit_low != null && r.ref_low != null && r.crit_low > r.ref_low) return "ค่าวิกฤตต่ำต้องไม่มากกว่าค่าปกติต่ำสุด";
  if (r.crit_high != null && r.ref_high != null && r.crit_high < r.ref_high) return "ค่าวิกฤตสูงต้องไม่น้อยกว่าค่าปกติสูงสุด";
  if (r.age_min != null && r.age_max != null && r.age_min > r.age_max) return "อายุเริ่มต้องไม่มากกว่าอายุสิ้นสุด";
  if ([r.age_min, r.age_max].some((a) => a != null && (a < 0 || a > 130))) return "อายุต้องอยู่ระหว่าง 0-130 ปี";
  return null;
}

// For each result, the most recent verified value of the same test from an EARLIER visit.
// Compared by visit time, not id: back-entered / migrated visits get later ids than newer ones.
// visit_at: "YYYY-MM-DD HH:MM:SS" (sorts as text). history order does not matter.
export function withPrevious<T extends { test_id: number; visit_id: number; visit_at: string }>(
  rows: T[],
  history: { test_id: number; visit_id: number; visit_at: string; value: string; date: string }[],
): (T & { prev: { value: string; date: string } | null })[] {
  return rows.map((r) => {
    const earlier = history.filter((h) => h.test_id === r.test_id && h.visit_id !== r.visit_id && h.visit_at < r.visit_at);
    const p = earlier.reduce<(typeof history)[number] | undefined>((best, h) => (!best || h.visit_at >= best.visit_at ? h : best), undefined);
    return { ...r, prev: p ? { value: p.value, date: p.date } : null };
  });
}

// AI guardrail: numbers in the generated text that never appear in the source data (hallucinated values).
// Compares numerically so "7.20" matches "7.2".
export function ungroundedNumbers(output: string, source: string): string[] {
  const nums = (s: string) => s.match(/\d+(?:\.\d+)?/g) ?? [];
  const known = new Set(nums(source).map(Number));
  return [...new Set(nums(output))].filter((n) => !known.has(Number(n)));
}

// Thai national ID: 13 digits, last digit = (11 - sum(d[i] * (13 - i)) % 11) % 10
export function isValidCid(cid: string): boolean {
  if (!/^\d{13}$/.test(cid)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(cid[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(cid[12]);
}

export function cidCheckDigit(first12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (13 - i);
  return String((11 - (sum % 11)) % 10);
}
