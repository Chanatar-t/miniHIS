"use client";
import { Sparkles, TriangleAlert } from "lucide-react";

import { useActionState } from "react";
import { aiSummary, type AiState } from "../ai-actions";

const SEV = {
  critical: "border-red-500 bg-red-50",
  abnormal: "border-amber-400 bg-amber-50",
  normal: "border-slate-200",
};

export function AiSummaryCard({ patientId }: { patientId: number }) {
  const [state, action, pending] = useActionState<AiState, FormData>(aiSummary, {});
  const s = state.summary;

  return (
    <div className="card space-y-3">
      <form action={action} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="patientId" value={patientId} />
        <h2 className="font-semibold">สรุปผล Lab</h2>
        <span className="text-xs text-slate-500">ส่งเฉพาะเพศ อายุ และผลที่ verify แล้ว ไม่ส่งชื่อ/HN/เลขบัตร</span>
        <button disabled={pending} className="btn ml-auto">
          {pending ? "กำลังสรุป…" : s ? "สรุปใหม่" : <><Sparkles className="h-4 w-4" aria-hidden /> สรุปด้วย AI</>}
        </button>
      </form>

      {s && (
        <div className="animate-fade-up space-y-2" aria-live="polite">
          <div className="flex items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-xs ${s.source === "ai" ? "bg-violet-100 text-violet-800" : "bg-slate-100 text-slate-700"}`}>
              {s.source === "ai" ? "AI-generated" : "สรุปแบบกฎ"}
            </span>
            <p className="font-medium">{s.headline}</p>
          </div>
          {s.warning && <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800"><TriangleAlert className="mr-1 inline h-3.5 w-3.5" aria-hidden />{s.warning}</p>}
          <ul className="stagger grid gap-2 sm:grid-cols-2">
            {s.findings.map((f, i) => (
              <li key={i} className={`rounded-md border-l-4 px-3 py-2 text-sm ${SEV[f.severity]}`}>
                <span className="font-mono font-semibold">{f.test}</span> {f.note}
              </li>
            ))}
          </ul>
          {s.pending.length > 0 && <p className="text-sm text-slate-600">รอผล: {s.pending.join(", ")}</p>}
          <p className="text-xs text-slate-500">ใช้ประกอบการตัดสินใจเท่านั้น ไม่ใช่การวินิจฉัย โปรดตรวจสอบกับตารางผลจริงด้านล่างทุกครั้ง</p>
        </div>
      )}
    </div>
  );
}
