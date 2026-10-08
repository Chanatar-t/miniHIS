import { BackLink } from "@/components/patient";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { SCHEME, age } from "@/lib/labels";
import { OrderForm, type CatalogTest } from "./form";

type V = {
  id: number; vn: string; scheme: string; patient_id: number;
  hn: string; prefix: string; first_name: string; last_name: string; dob: string; sex: string;
};

export default async function OrderPage({ params }: PageProps<"/visits/[vn]/order">) {
  const user = await requireRole("DOCTOR");
  const { vn } = await params;
  const v = db
    .prepare(
      `SELECT v.id, v.vn, v.scheme, v.patient_id, p.hn, p.prefix, p.first_name, p.last_name, p.dob, p.sex
       FROM visits v JOIN patients p ON p.id = v.patient_id WHERE v.vn = ?`,
    )
    .get(vn) as V | undefined;
  if (!v) notFound();

  // catalog sorted by how often THIS doctor orders each test: the autocomplete learns habits without AI
  const catalog = db
    .prepare(
      `SELECT t.id, t.code, t.name, t.loinc, t.specimen_type, t.container, t.price, t.tat_days, ol.code AS outlab,
              (SELECT COUNT(*) FROM lab_order_items i JOIN lab_orders o ON o.id = i.order_id
               WHERE i.test_id = t.id AND o.ordered_by = ?) AS used
       FROM lab_tests t LEFT JOIN outlabs ol ON ol.id = t.outlab_id
       WHERE t.active = 1 -- new tests appear only after their first range is approved
       ORDER BY used DESC, t.code`,
    )
    .all(user.id) as CatalogTest[];

  // same test for same patient in last 7 days -> warn (duplicate orders cost money and blood)
  const recent = db
    .prepare(
      `SELECT DISTINCT i.test_id FROM lab_order_items i
       JOIN lab_orders o ON o.id = i.order_id JOIN visits v ON v.id = o.visit_id
       WHERE v.patient_id = ? AND i.status != 'CANCELLED' AND o.ordered_at >= datetime('now','localtime','-7 days')`,
    )
    .all(v.patient_id) as { test_id: number }[];

  return (
    <div className="space-y-4">
      <BackLink href={`/patients/${v.hn}`}>กลับไปหน้าผู้ป่วย</BackLink>
      <div className="card flex flex-wrap items-center gap-x-6 text-sm">
        <span className="font-mono font-semibold">{v.hn}</span>
        <span className="font-semibold">
          {v.prefix}
          {v.first_name} {v.last_name}
        </span>
        <span>
          {v.sex === "M" ? "ชาย" : "หญิง"} {age(v.dob)} ปี
        </span>
        <span className="font-mono">{v.vn}</span>
        <span>{SCHEME[v.scheme]}</span>
      </div>
      <h1 className="text-xl font-semibold">สั่งตรวจทางห้องปฏิบัติการ</h1>
      {/* node:sqlite rows have a null prototype; client props must be plain objects */}
      <OrderForm visitId={v.id} catalog={catalog.map((t) => ({ ...t }))} recentIds={recent.map((r) => r.test_id)} />
    </div>
  );
}
