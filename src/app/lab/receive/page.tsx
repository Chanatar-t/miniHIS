import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { REJECT_REASONS } from "@/lib/labels";
import { Flash } from "@/components/flash";
import { receiveSpecimen, rejectSpecimen } from "../actions";

type S = {
  id: number; accession_no: string; container: string; collected_at: string; received_at: string | null;
  hn: string; patient: string; priority: string; tests: string; outlab: string | null; shipment_id: number | null;
};

const BASE = `
  SELECT s.id, s.accession_no, s.container, s.collected_at, s.received_at, s.shipment_id,
         p.hn, p.first_name || ' ' || p.last_name AS patient, o.priority,
         group_concat(t.code, ' ') AS tests, max(ol.code) AS outlab
  FROM specimens s
  JOIN lab_orders o ON o.id = s.order_id JOIN visits v ON v.id = o.visit_id JOIN patients p ON p.id = v.patient_id
  JOIN lab_order_items i ON i.specimen_id = s.id JOIN lab_tests t ON t.id = i.test_id
  LEFT JOIN outlabs ol ON ol.id = t.outlab_id
  WHERE s.reject_reason IS NULL`;

export default async function ReceivePage({ searchParams }: PageProps<"/lab/receive">) {
  await requireRole("LAB");
  const sp = await searchParams;
  const waiting = db.prepare(`${BASE} AND s.received_at IS NULL GROUP BY s.id ORDER BY o.priority = 'STAT' DESC, s.collected_at`).all() as S[];
  const received = db
    .prepare(`${BASE} AND s.received_at >= date('now','localtime') GROUP BY s.id ORDER BY s.received_at DESC`)
    .all() as S[];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">รับสิ่งส่งตรวจเข้า Lab</h1>
      <form action={receiveSpecimen} className="card flex gap-2">
        <input name="accession" autoFocus autoComplete="off" className="input font-mono text-lg" placeholder="สแกนบาร์โค้ด หรือพิมพ์ Accession แล้วกด Enter" />
        <button className="btn">รับเข้า</button>
      </form>
      <Flash sp={sp} />

      <Section title={`รอรับเข้า (${waiting.length})`} rows={waiting} />
      <Section title={`รับเข้าวันนี้ (${received.length})`} rows={received} />
    </div>
  );
}

// Reject is allowed in both lists: hemolysis is usually spotted right at the counter
function Section({ title, rows }: { title: string; rows: S[] }) {
  return (
    <div className="card p-0">
      <h2 className="px-3 pt-3 font-semibold">{title}</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Accession</th>
            <th>ผู้ป่วย</th>
            <th>Tests</th>
            <th>หลอด</th>
            <th>ปลายทาง</th>
            <th>เวลา</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id}>
              <td className="font-mono">
                {s.accession_no} {s.priority === "STAT" && <b className="text-red-600">STAT</b>}
              </td>
              <td>
                <span className="font-mono text-xs">{s.hn}</span> {s.patient}
              </td>
              <td className="text-xs">{s.tests}</td>
              <td className="text-xs">{s.container}</td>
              <td>{s.outlab ?? "In-house"}</td>
              <td className="text-xs">{(s.received_at ?? s.collected_at).slice(11, 16)}</td>
              <td>
                {s.shipment_id ? (
                  <span className="text-xs text-slate-400">อยู่ในใบนำส่ง</span>
                ) : (
                  <form action={rejectSpecimen} className="flex gap-1">
                    <input type="hidden" name="specimenId" value={s.id} />
                    <select name="reason" className="input py-1 text-xs" aria-label="เหตุผล reject">
                      {REJECT_REASONS.map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </select>
                    <button className="btn-ghost text-xs text-red-700">Reject</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="py-6 text-center text-slate-500">
                ไม่มีรายการ
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
