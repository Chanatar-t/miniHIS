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

// BMI (kg/m²), 1 decimal; null when weight or height wasn't measured
export function bmi(weight: number | null, height: number | null): number | null {
  if (!weight || !height) return null;
  return Math.round((weight / (height / 100) ** 2) * 10) / 10;
}

// Asia-Pacific cut-offs (WHO 2000), used by Thai clinics: overweight from 23, obese from 25
export function bmiLabel(b: number): string {
  return b < 18.5 ? "น้ำหนักน้อย" : b < 23 ? "ปกติ" : b < 25 ? "น้ำหนักเกิน" : "อ้วน";
}

// Screening cues for the doctor, not a diagnosis. Adult thresholds.
export type Vitals = { sbp: number | null; dbp: number | null; pulse: number | null; rr: number | null; temp: number | null; spo2: number | null };
export function vitalAlerts(v: Vitals): string[] {
  const a: string[] = [];
  const { sbp, dbp } = v;
  if ((sbp ?? 0) >= 180 || (dbp ?? 0) >= 110) a.push("ความดันสูงมาก");
  else if ((sbp ?? 0) >= 140 || (dbp ?? 0) >= 90) a.push("ความดันสูง");
  else if (sbp !== null && sbp < 90) a.push("ความดันต่ำ");
  if (v.temp !== null && v.temp >= 37.5) a.push("มีไข้");
  if (v.spo2 !== null && v.spo2 < 95) a.push("SpO2 ต่ำ");
  if (v.pulse !== null && (v.pulse > 120 || v.pulse < 50)) a.push("ชีพจรผิดปกติ");
  if (v.rr !== null && (v.rr > 24 || v.rr < 10)) a.push("หายใจผิดปกติ");
  return a;
}

// Vital-sign fields: one list drives the form, the live hints and the server check
export type VitalKey = "sbp" | "dbp" | "pulse" | "rr" | "temp" | "spo2" | "weight" | "height";
export const VITAL_FIELDS: { key: VitalKey; label: string; unit: string; min: number; max: number; step: number; normal?: [number, number]; hint: string }[] = [
  { key: "sbp", label: "ความดันตัวบน", unit: "mmHg", min: 50, max: 300, step: 1, normal: [90, 139], hint: "ปกติ 90–139" },
  { key: "dbp", label: "ความดันตัวล่าง", unit: "mmHg", min: 20, max: 200, step: 1, normal: [60, 89], hint: "ปกติ 60–89" },
  { key: "pulse", label: "ชีพจร", unit: "ครั้ง/นาที", min: 20, max: 250, step: 1, normal: [60, 100], hint: "ปกติ 60–100" },
  { key: "rr", label: "การหายใจ", unit: "ครั้ง/นาที", min: 4, max: 80, step: 1, normal: [12, 20], hint: "ปกติ 12–20" },
  { key: "temp", label: "อุณหภูมิ", unit: "°C", min: 30, max: 45, step: 0.1, normal: [36, 37.4], hint: "ปกติ 36.0–37.4" },
  { key: "spo2", label: "SpO2", unit: "%", min: 50, max: 100, step: 1, normal: [95, 100], hint: "ปกติ 95 ขึ้นไป" },
  { key: "weight", label: "น้ำหนัก", unit: "kg", min: 0.5, max: 400, step: 0.1, hint: "เช่น 60.5" },
  { key: "height", label: "ส่วนสูง", unit: "cm", min: 30, max: 250, step: 0.1, hint: "เช่น 165" },
];

// Field -> message for raw form text. Live (while typing) skips "fill both BP fields", which is only an error on save.
export function vitalsErrors(raw: Partial<Record<VitalKey, string>>, onSave = false): Partial<Record<VitalKey, string>> {
  const e: Partial<Record<VitalKey, string>> = {};
  const num = (k: VitalKey) => (raw[k]?.trim() ? Number(raw[k]) : null);
  for (const f of VITAL_FIELDS) {
    const v = num(f.key);
    if (v === null) continue;
    if (!Number.isFinite(v)) e[f.key] = "ต้องเป็นตัวเลข";
    else if (v < f.min || v > f.max) e[f.key] = `ต้องอยู่ระหว่าง ${f.min}–${f.max} พิมพ์เกินหรือเปล่า?`;
  }
  const sbp = num("sbp"), dbp = num("dbp");
  if (!e.sbp && !e.dbp) {
    if (sbp !== null && dbp !== null && dbp >= sbp) e.dbp = "ต้องน้อยกว่าตัวบน กรอกสลับช่องหรือเปล่า?";
    else if (onSave && (sbp === null) !== (dbp === null)) e[sbp === null ? "sbp" : "dbp"] = "กรอกความดันให้ครบทั้งตัวบนและตัวล่าง";
  }
  return e;
}
