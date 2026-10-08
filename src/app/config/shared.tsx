import type { RangeRow } from "@/lib/rules";
import { refRange, thDate } from "@/lib/labels";

export type RangeFull = RangeRow & {
  reason: string; proposed_at: string; proposer: string | null; reviewed_at: string | null; reviewer: string | null; review_note: string | null; proposed_by: number;
};

export const scopeKey = (r: Pick<RangeRow, "sex" | "age_min" | "age_max">) => `${r.sex ?? "*"}|${r.age_min ?? ""}|${r.age_max ?? ""}`;

export function scopeLabel(r: Pick<RangeRow, "sex" | "age_min" | "age_max">) {
  const sex = r.sex === "M" ? "ชาย" : r.sex === "F" ? "หญิง" : "ทุกเพศ";
  const age =
    r.age_min != null && r.age_max != null
      ? `อายุ ${r.age_min}–${r.age_max} ปี`
      : r.age_min != null
        ? `อายุ ${r.age_min} ปีขึ้นไป`
        : r.age_max != null
          ? `อายุไม่เกิน ${r.age_max} ปี`
          : "ทุกอายุ";
  return `${sex} · ${age}`;
}

export function RangeValues({ r }: { r: Pick<RangeRow, "ref_low" | "ref_high" | "crit_low" | "crit_high"> }) {
  return (
    <span className="tabular-nums">
      <span className="font-semibold">{refRange(r.ref_low, r.ref_high) || "—"}</span>
      {(r.crit_low != null || r.crit_high != null) && (
        <span className="ml-2 text-xs text-red-700">
          วิกฤต {r.crit_low != null && `< ${r.crit_low}`}
          {r.crit_low != null && r.crit_high != null && " หรือ "}
          {r.crit_high != null && `> ${r.crit_high}`}
        </span>
      )}
    </span>
  );
}

// Lifecycle of each version, in words a lab supervisor uses
export function versionState(r: RangeFull, all: RangeFull[], today: string) {
  if (r.status === "PENDING") return { label: "รออนุมัติ", cls: "bg-amber-100 text-amber-800" };
  if (r.status === "REJECTED") return { label: "ไม่อนุมัติ", cls: "bg-slate-100 text-slate-500 line-through" };
  if (r.effective_from > today) return { label: `อนุมัติแล้ว มีผล ${thDate(r.effective_from, false)}`, cls: "bg-sky-100 text-sky-800" };
  const current = all
    .filter((x) => x.status === "APPROVED" && scopeKey(x) === scopeKey(r) && x.effective_from <= today)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from) || b.id - a.id)[0];
  return current?.id === r.id ? { label: "ใช้อยู่", cls: "bg-emerald-100 text-emerald-800" } : { label: "ถูกแทนที่", cls: "bg-slate-100 text-slate-500" };
}
