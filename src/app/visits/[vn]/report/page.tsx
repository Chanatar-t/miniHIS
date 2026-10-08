import { notFound } from "next/navigation";
import { db, audit } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { ORDER_STATUS, SCHEME, age, queueNo, thDate } from "@/lib/labels";
import { orderStatus } from "@/lib/rules";
import { visitResults } from "@/lib/visits";
import { PrintButton } from "@/components/client";
import { BackLink, fullName } from "@/components/patient";
import { ResultsTable } from "@/components/results-table";

type V = {
  id: number; vn: string; scheme: string; created_at: string; patient_id: number;
  hn: string; prefix: string; first_name: string; last_name: string; sex: string; dob: string;
};

// One printable report for everything tested in a visit (all orders), read by the doctor directly.
export default async function VisitReportPage({ params }: PageProps<"/visits/[vn]/report">) {
  const user = await requireRole("DOCTOR", "LAB");
  const { vn } = await params;
  const v = db
    .prepare(
      `SELECT v.id, v.vn, v.scheme, v.created_at, p.id AS patient_id, p.hn, p.prefix, p.first_name, p.last_name, p.sex, p.dob
       FROM visits v JOIN patients p ON p.id = v.patient_id WHERE v.vn = ?`,
    )
    .get(vn) as V | undefined;
  if (!v) notFound();
  audit(db, user.id, "VIEW", "visit_report", v.id);

  const rows = visitResults(v.id, v.patient_id);
  const st = ORDER_STATUS[orderStatus(rows.map((r) => r.status))];
  const notes = db
    .prepare(
      `SELECT t.code, c.notified_to, c.method, u.name AS by, c.at FROM critical_notifications c
       JOIN lab_order_items i ON i.id = c.item_id JOIN lab_orders o ON o.id = i.order_id JOIN lab_tests t ON t.id = i.test_id
       JOIN users u ON u.id = c.by_user WHERE o.visit_id = ? ORDER BY c.id`,
    )
    .all(v.id) as { code: string; notified_to: string; method: string; by: string; at: string }[];
  const amends = db
    .prepare(
      `SELECT t.code, a.old_value, a.new_value, a.reason, u.name AS by, a.at FROM result_amendments a
       JOIN lab_order_items i ON i.id = a.item_id JOIN lab_orders o ON o.id = i.order_id JOIN lab_tests t ON t.id = i.test_id
       JOIN users u ON u.id = a.by_user WHERE o.visit_id = ? ORDER BY a.id`,
    )
    .all(v.id) as { code: string; old_value: string; new_value: string; reason: string; by: string; at: string }[];
  const reported = rows.filter((r) => r.status === "VERIFIED").length;

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center gap-2">
        <BackLink href={`/patients/${v.hn}`}>กลับไปหน้าผู้ป่วย</BackLink>
        <div className="ml-auto">
          <PrintButton label="พิมพ์ใบรายงานผล" />
        </div>
      </div>

      <article className="card space-y-4">
        <header className="flex flex-wrap justify-between gap-4 border-b border-slate-200 pb-3">
          <div>
            <h1 className="text-lg font-semibold">รายงานผลการตรวจทางห้องปฏิบัติการ</h1>
            <div className="text-sm">
              <span className="font-mono">{v.hn}</span> <b>{fullName(v)}</b> · {v.sex === "M" ? "ชาย" : "หญิง"} {age(v.dob)} ปี
            </div>
            <div className="text-sm text-slate-600">
              มารับบริการ {thDate(v.created_at)} · คิว {queueNo(v.vn)} · {SCHEME[v.scheme]}
            </div>
          </div>
          <div className="text-right text-sm">
            <div className="font-mono">{v.vn}</div>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
            <div className="mt-1 text-xs text-slate-500">
              รายงานแล้ว {reported}/{rows.length} รายการ
            </div>
          </div>
        </header>

        {rows.length ? <ResultsTable rows={rows} /> : <p className="py-6 text-center text-sm text-slate-500">Visit นี้ไม่มีการสั่งตรวจ</p>}

        {notes.length > 0 && (
          <div className="text-xs">
            <div className="font-semibold">บันทึกการแจ้งค่าวิกฤต</div>
            {notes.map((c, n) => (
              <div key={n}>
                {c.code}: แจ้ง {c.notified_to} ทาง{c.method} โดย {c.by} {thDate(c.at)}
              </div>
            ))}
          </div>
        )}
        {amends.length > 0 && (
          <div className="text-xs">
            <div className="font-semibold">ประวัติการแก้ไขผล</div>
            {amends.map((a, n) => (
              <div key={n}>
                {a.code}: {a.old_value} → {a.new_value} · เหตุผล: {a.reason} · {a.by} {thDate(a.at)}
              </div>
            ))}
          </div>
        )}
        <footer className="border-t border-slate-100 pt-2 text-xs text-slate-500">
          แสดงเฉพาะค่าที่ตรวจทาน (verify) แล้ว รายการที่ยังไม่ได้ผลแสดงเป็นสถานะ · ค่าอ้างอิงของโรงพยาบาล · พิมพ์โดย {user.name}
        </footer>
      </article>
    </div>
  );
}
