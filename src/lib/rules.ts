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
