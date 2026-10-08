import { ArrowRight, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { LAB_STEPS, LabSteps, labCounts } from "./steps";

// "งาน Lab" in the menu: an overview, not a redirect. A redirect here trapped the browser's back button
// (back -> /lab -> forwarded again). Points at the first step with work waiting (critical verifies first).
export default async function LabHome() {
  await requireRole("LAB");
  const c = labCounts();
  const next = c.critical > 0 ? LAB_STEPS.find((s) => s.key === "verify")! : LAB_STEPS.find((s) => c[s.key] > 0);
  const total = LAB_STEPS.reduce((n, s) => n + c[s.key], 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">งาน Lab</h1>
        <p className="text-sm text-slate-500">{total ? `งานค้างทั้งหมด ${total} รายการ เลือกขั้นตอนที่จะทำ` : "ไม่มีงานค้าง"}</p>
      </div>
      <LabSteps />

      {c.critical > 0 && (
        <Link href="/lab/verify" className="flex items-center gap-3 rounded-xl border border-red-300 bg-red-50 p-4 text-red-900 hover:bg-red-100">
          <TriangleAlert className="h-6 w-6 shrink-0" aria-hidden />
          <span className="flex-1">
            <b>ค่าวิกฤตรอ Verify {c.critical} รายการ</b> ต้องแจ้งแพทย์และบันทึกการแจ้งก่อน Verify
          </span>
          <ArrowRight className="h-5 w-5" aria-hidden />
        </Link>
      )}

      <ol className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {LAB_STEPS.map((s, i) => {
          const isNext = s.key === next?.key;
          return (
            <li key={s.key}>
              <Link
                href={s.href}
                className={`card card-hover flex h-full flex-col gap-2 ${isNext ? "border-violet-400 ring-2 ring-violet-200" : ""}`}
              >
                <span className="text-xs text-slate-500">ขั้นที่ {i + 1}</span>
                <span className="font-semibold">{s.label}</span>
                <span className={`text-3xl font-bold ${c[s.key] ? "text-violet-700" : "text-slate-300"}`}>{c[s.key]}</span>
                <span className="text-xs text-slate-500">{s.unit}รอดำเนินการ</span>
                {isNext && <span className="mt-auto text-sm font-medium text-violet-700">เริ่มที่นี่ →</span>}
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
