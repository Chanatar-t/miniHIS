import Link from "next/link";
import { db } from "@/lib/db";

// The lab is a conveyor belt; this bar shows where the work is waiting.
// Rendered by each lab page (not a layout) so the counts refresh on every navigation.
export const LAB_STEPS = [
  { key: "collect", href: "/lab/collect", label: "เก็บสิ่งส่งตรวจ", unit: "ใบสั่ง" },
  { key: "receive", href: "/lab/receive", label: "รับเข้า Lab", unit: "หลอด" },
  { key: "ship", href: "/lab/shipments", label: "ส่ง Outlab", unit: "หลอด" },
  { key: "results", href: "/lab/results", label: "ลงผล / รับผล", unit: "รายการ" },
  { key: "verify", href: "/lab/verify", label: "Verify", unit: "รายการ" },
] as const;
export type LabStep = (typeof LAB_STEPS)[number]["key"];

export function labCounts(): Record<LabStep, number> & { critical: number; awaitingOutlab: number } {
  const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    collect: n("SELECT COUNT(DISTINCT order_id) AS n FROM lab_order_items WHERE status = 'ORDERED'"),
    receive: n("SELECT COUNT(*) AS n FROM specimens WHERE received_at IS NULL AND reject_reason IS NULL"),
    ship: n(
      `SELECT COUNT(DISTINCT s.id) AS n FROM specimens s JOIN lab_order_items i ON i.specimen_id = s.id JOIN lab_tests t ON t.id = i.test_id
       WHERE i.status = 'RECEIVED' AND t.outlab_id IS NOT NULL AND s.reject_reason IS NULL
         AND (s.shipment_id IS NULL OR s.shipment_id IN (SELECT id FROM shipments WHERE status = 'DRAFT'))`,
    ),
    results: n(
      `SELECT COUNT(*) AS n FROM lab_order_items i JOIN lab_tests t ON t.id = i.test_id
       WHERE (t.outlab_id IS NULL AND i.status = 'RECEIVED') OR (t.outlab_id IS NOT NULL AND i.status = 'SENT')`,
    ),
    verify: n("SELECT COUNT(*) AS n FROM lab_order_items WHERE status = 'RESULTED'"),
    critical: n("SELECT COUNT(*) AS n FROM lab_order_items WHERE status = 'RESULTED' AND flag IN ('LL','HH')"),
    awaitingOutlab: n("SELECT COUNT(*) AS n FROM lab_order_items WHERE status = 'SENT'"),
  };
}

export function LabSteps({ current }: { current: LabStep }) {
  const c = labCounts();
  return (
    <nav aria-label="ขั้นตอนงาน Lab" className="no-print overflow-x-auto">
      <ol className="flex min-w-[720px] items-stretch gap-1">
        {LAB_STEPS.map((s, i) => {
          const active = s.key === current;
          const count = c[s.key];
          const urgent = s.key === "verify" && c.critical > 0;
          return (
            <li key={s.key} className="flex flex-1 items-center gap-1">
              <Link
                href={s.href}
                aria-current={active ? "step" : undefined}
                className={`flex flex-1 items-center gap-2 rounded-lg border px-3 py-2 transition ${
                  active ? "border-violet-500 bg-violet-600 text-white shadow" : "border-slate-200 bg-white hover:border-violet-300"
                }`}
              >
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${active ? "bg-white text-violet-700" : "bg-slate-100 text-slate-600"}`}>
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.label}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                    urgent ? "bg-red-600 text-white" : count === 0 ? (active ? "bg-violet-500 text-violet-100" : "bg-slate-100 text-slate-400") : active ? "bg-white text-violet-700" : "bg-violet-100 text-violet-800"
                  }`}
                  title={`${count} ${s.unit}`}
                >
                  {count}
                </span>
              </Link>
              {i < LAB_STEPS.length - 1 && (
                <span className="text-slate-300" aria-hidden>
                  ›
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
