import Link from "next/link";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { createShipment } from "../actions";

type Pending = { id: number; code: string; name: string; pending: number; stat: number };
type Shipment = { shipment_no: string; outlab: string; status: string; created_at: string; sent_at: string | null; n: number };

export default async function ShipmentsPage() {
  await requireRole("LAB");
  const pending = db
    .prepare(
      `SELECT ol.id, ol.code, ol.name, COUNT(DISTINCT s.id) AS pending,
              COUNT(DISTINCT CASE WHEN o.priority = 'STAT' THEN s.id END) AS stat
       FROM outlabs ol
       LEFT JOIN lab_tests t ON t.outlab_id = ol.id
       LEFT JOIN lab_order_items i ON i.test_id = t.id AND i.status = 'RECEIVED'
       LEFT JOIN specimens s ON s.id = i.specimen_id AND s.shipment_id IS NULL AND s.reject_reason IS NULL
       LEFT JOIN lab_orders o ON o.id = s.order_id
       GROUP BY ol.id ORDER BY ol.code`,
    )
    .all() as Pending[];
  const shipments = db
    .prepare(
      `SELECT sh.shipment_no, ol.code AS outlab, sh.status, sh.created_at, sh.sent_at, COUNT(s.id) AS n
       FROM shipments sh JOIN outlabs ol ON ol.id = sh.outlab_id LEFT JOIN specimens s ON s.shipment_id = sh.id
       GROUP BY sh.id ORDER BY sh.id DESC LIMIT 50`,
    )
    .all() as Shipment[];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">ส่งตรวจ Outlab</h1>
      <div className="grid gap-4 md:grid-cols-2">
        {pending.map((p) => (
          <div key={p.id} className="card flex items-center gap-4">
            <div className="flex-1">
              <div className="font-semibold">{p.code}</div>
              <div className="text-sm text-slate-500">{p.name}</div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-semibold">{p.pending}</div>
              <div className="text-xs text-slate-500">หลอดรอส่ง{p.stat > 0 && <b className="text-red-600"> · STAT {p.stat}</b>}</div>
            </div>
            <form action={createShipment}>
              <input type="hidden" name="outlabId" value={p.id} />
              <button disabled={p.pending === 0} className="btn">
                สร้างใบนำส่ง
              </button>
            </form>
          </div>
        ))}
      </div>

      <div className="card p-0">
        <h2 className="px-3 pt-3 font-semibold">ประวัติการส่ง</h2>
        <table className="table">
          <thead>
            <tr>
              <th>เลขที่</th>
              <th>Outlab</th>
              <th>จำนวนหลอด</th>
              <th>สถานะ</th>
              <th>สร้าง</th>
              <th>ส่ง</th>
            </tr>
          </thead>
          <tbody>
            {shipments.map((s) => (
              <tr key={s.shipment_no}>
                <td>
                  <Link href={`/lab/shipments/${s.shipment_no}`} className="font-mono text-teal-700 hover:underline">
                    {s.shipment_no}
                  </Link>
                </td>
                <td>{s.outlab}</td>
                <td>{s.n}</td>
                <td>
                  <span className={`rounded px-2 py-0.5 text-xs ${s.status === "DRAFT" ? "bg-amber-100 text-amber-800" : "bg-violet-100 text-violet-800"}`}>
                    {s.status === "DRAFT" ? "ร่าง (ยังไม่ส่ง)" : "ส่งแล้ว"}
                  </span>
                </td>
                <td className="text-xs">{s.created_at}</td>
                <td className="text-xs">{s.sent_at ?? "-"}</td>
              </tr>
            ))}
            {shipments.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-slate-500">
                  ยังไม่มีการส่ง
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
