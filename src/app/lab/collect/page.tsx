import { LabSteps } from "../steps";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { collectOrder } from "../actions";

type Row = {
  order_id: number; priority: string; ordered_at: string; note: string | null; hn: string; patient: string; vn: string;
  code: string; container: string; outlab: string | null;
};

export default async function CollectPage() {
  await requireRole("LAB");
  const rows = db
    .prepare(
      `SELECT o.id AS order_id, o.priority, o.ordered_at, o.note, p.hn, p.prefix || p.first_name || ' ' || p.last_name AS patient,
              v.vn, t.code, t.container, ol.code AS outlab
       FROM lab_order_items i
       JOIN lab_orders o ON o.id = i.order_id JOIN visits v ON v.id = o.visit_id JOIN patients p ON p.id = v.patient_id
       JOIN lab_tests t ON t.id = i.test_id LEFT JOIN outlabs ol ON ol.id = t.outlab_id
       WHERE i.status = 'ORDERED'
       ORDER BY o.priority = 'STAT' DESC, o.ordered_at, t.code`,
    )
    .all() as Row[];
  const orders = Map.groupBy(rows, (r) => r.order_id);

  return (
    <div className="space-y-4">
      <LabSteps current="collect" />
      <h1 className="text-xl font-semibold">รอเก็บสิ่งส่งตรวจ ({orders.size})</h1>
      {orders.size === 0 && <p className="text-sm text-slate-500">ไม่มีงานค้าง</p>}
      {[...orders.values()].map((items) => {
        const o = items[0];
        return (
          <div key={o.order_id} className={`card flex flex-wrap items-center gap-4 ${o.priority === "STAT" ? "border-red-300" : ""}`}>
            <div className="w-28">
              {o.priority === "STAT" && <div className="text-xs font-bold text-red-600">STAT</div>}
              <div className="font-mono text-xs text-slate-500">#{o.order_id}</div>
              <div className="text-xs text-slate-500">{o.ordered_at.slice(11, 16)}</div>
            </div>
            <div className="min-w-48">
              <Link href={`/patients/${o.hn}`} className="font-mono text-teal-700 hover:underline">
                {o.hn}
              </Link>
              <div>{o.patient}</div>
            </div>
            <div className="flex flex-1 flex-wrap gap-1">
              {items.map((i) => (
                <span key={i.code} className="rounded bg-slate-100 px-2 py-0.5 text-xs" title={i.container}>
                  {i.code} <span className="text-slate-400">{i.outlab ?? "IN"}</span>
                </span>
              ))}
              {o.note && <div className="w-full text-xs text-amber-700">หมายเหตุ: {o.note}</div>}
            </div>
            <form action={collectOrder}>
              <input type="hidden" name="orderId" value={o.order_id} />
              <button className="btn">เก็บแล้ว + พิมพ์ฉลาก</button>
            </form>
          </div>
        );
      })}
    </div>
  );
}
