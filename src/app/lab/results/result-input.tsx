"use client";

import { useState } from "react";
import { flagResult } from "@/lib/rules";
import { FLAG } from "@/lib/labels";

type Range = { ref_low: number | null; ref_high: number | null; crit_low: number | null; crit_high: number | null };

// Shows the flag the server will assign, while typing (same pure function), so a typo like 650 vs 65.0 is caught before saving.
export function ResultInput({ name, label, range }: { name: string; label: string; range: Range }) {
  const [v, setV] = useState("");
  const flag = v.trim() ? flagResult(v, range) : null;
  const critical = flag === "LL" || flag === "HH";
  return (
    <div className="flex items-center gap-2">
      <input
        name={name}
        value={v}
        onChange={(e) => setV(e.target.value)}
        aria-label={label}
        autoComplete="off"
        inputMode="decimal"
        className={`input w-32 text-right font-semibold ${critical ? "border-red-500 bg-red-50" : ""}`}
      />
      <span className="w-20 text-xs" aria-live="polite">
        {flag && flag !== "N" && <span className={`rounded px-1.5 py-0.5 ${FLAG[flag].cls}`}>{FLAG[flag].label}</span>}
        {flag === "N" && <span className="text-emerald-700">ปกติ</span>}
        {v.trim() && flag === null && <span className="text-slate-500">ข้อความ</span>}
      </span>
    </div>
  );
}
