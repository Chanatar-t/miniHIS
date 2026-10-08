import { RESULT_RANGE_SQL } from "@/lib/ranges";
import { LabSteps } from "../steps";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { FLAG, isCritical, refRange } from "@/lib/labels";
import { Flash } from "@/components/flash";
import { verifyOrder } from "../results/actions";

type Row = {
  item_id: number; order_id: number; priority: string; hn: string; patient: string; doctor: string;
  code: string; name: string; value: string; flag: string | null; unit: string | null; ref_low: number | null; ref_high: number | null;
  resulted_by: number | null; resulted_by_name: string | null; source: string | null; resulted_at: string;
};

export default async function VerifyPage({ searchParams }: PageProps<"/lab/verify">) {
  const user = await requireRole("LAB");
  const rows = db
    .prepare(
      `SELECT i.id AS item_id, o.id AS order_id, o.priority, p.hn, p.prefix || p.first_name || ' ' || p.last_name AS patient,
              d.name AS doctor, t.code, t.name, i.value, i.flag, t.unit, ${RESULT_RANGE_SQL},
              i.resulted_by, u.name AS resulted_by_name, m.control_id AS source, i.resulted_at
       FROM lab_order_items i
       JOIN lab_orders o ON o.id = i.order_id JOIN visits v ON v.id = o.visit_id JOIN patients p ON p.id = v.patient_id
       JOIN users d ON d.id = o.ordered_by JOIN lab_tests t ON t.id = i.test_id
       LEFT JOIN users u ON u.id = i.resulted_by LEFT JOIN inbound_messages m ON m.id = i.message_id
       WHERE i.status = 'RESULTED'
       ORDER BY i.id`,
    )
    .all() as Row[];
  // critical first, then STAT, then oldest
  const orders = [...Map.groupBy(rows, (r) => r.order_id).values()].sort(
    (a, b) =>
      +b.some((r) => isCritical(r.flag)) - +a.some((r) => isCritical(r.flag)) ||
      +(b[0].priority === "STAT") - +(a[0].priority === "STAT") ||
      a[0].item_id - b[0].item_id,
  );

  return (
    <div className="space-y-4">
      <LabSteps current="verify" />
      <h1 className="text-xl font-semibold">รอ Verify ({rows.length} รายการ)</h1>
      <Flash sp={await searchParams} />
      {orders.length === 0 && <p className="text-sm text-slate-500">ไม่มีผลรอ verify</p>}
      <div className="stagger space-y-4">
        {orders.map((items) => {
          const o = items[0];
          const critical = items.some((r) => isCritical(r.flag));
          const own = items.some((r) => r.resulted_by === user.id);
          return (
            <form key={o.order_id} action={verifyOrder} className={`card space-y-3 ${critical ? "border-2 border-red-500" : ""}`}>
              {items.map((r) => (
                <input key={r.item_id} type="hidden" name="itemId" value={r.item_id} />
              ))}
              <div className="flex flex-wrap items-center gap-x-4 text-sm">
                {critical && <span className="rounded bg-red-600 px-2 py-0.5 text-xs font-bold text-white">ค่าวิกฤต</span>}
                {o.priority === "STAT" && <b className="text-red-600">STAT</b>}
                <Link href={`/reports/${o.order_id}`} className="font-mono text-xs text-teal-700 hover:underline">
                  Order #{o.order_id}
                </Link>
                <span>
                  <span className="font-mono text-xs">{o.hn}</span> {o.patient}
                </span>
                <span className="text-slate-500">แพทย์: {o.doctor}</span>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Test</th>
                    <th>ผล</th>
                    <th />
                    <th>ค่าอ้างอิง</th>
                    <th>ลงผลโดย</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <tr key={r.item_id}>
                      <td>
                        <span className="font-mono font-semibold">{r.code}</span> {r.name}
                      </td>
                      <td className="font-semibold">
                        {r.value} <span className="text-xs font-normal text-slate-500">{r.unit}</span>
                      </td>
                      <td>{r.flag && r.flag !== "N" && <span className={`rounded px-1.5 py-0.5 text-xs ${FLAG[r.flag].cls}`}>{FLAG[r.flag].label}</span>}</td>
                      <td className="text-xs text-slate-500">{refRange(r.ref_low, r.ref_high)}</td>
                      <td className="text-xs">
                        {r.source ? `HL7 ${r.source}` : r.resulted_by_name}
                        {r.resulted_by === user.id && <span className="text-amber-700"> (คุณ)</span>}
                        <div className="text-slate-400">{r.resulted_at.slice(5, 16)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {critical && (
                <div className="grid gap-2 rounded-md bg-red-50 p-3 sm:grid-cols-[1fr_200px]">
                  <div>
                    <label className="label">แจ้งค่าวิกฤตแก่ (ชื่อ / ตำแหน่ง) *</label>
                    <input name="notifiedTo" required className="input" placeholder={`เช่น ${o.doctor}, พยาบาลหอผู้ป่วย`} />
                  </div>
                  <div>
                    <label className="label">ช่องทาง *</label>
                    <select name="method" className="input">
                      <option>โทรศัพท์</option>
                      <option>แจ้งด้วยตนเอง</option>
                      <option>ระบบแจ้งเตือน</option>
                    </select>
                  </div>
                </div>
              )}
              {own ? (
                <p className="text-sm text-amber-700">คุณเป็นผู้ลงผลบางรายการใน order นี้ ต้องให้เจ้าหน้าที่อีกคน verify (four-eyes)</p>
              ) : (
                <button className="btn">Verify และรายงานผล</button>
              )}
            </form>
          );
        })}
      </div>
    </div>
  );
}
