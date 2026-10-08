import Link from "next/link";
import { notFound } from "next/navigation";
import { db, audit } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { SCHEME, ITEM_STATUS, FLAG, age } from "@/lib/labels";
import { openVisit } from "../actions";
import { AiSummaryCard } from "./ai-card";

type Patient = {
  id: number; hn: string; cid: string; prefix: string; first_name: string; last_name: string;
  dob: string; sex: string; phone: string | null;
};
type Visit = { id: number; vn: string; scheme: string; created_at: string };
type Item = {
  item_id: number; visit_id: number; order_id: number; priority: string; ordered_at: string; doctor: string;
  code: string; name: string; status: string; outlab: string | null; accession_no: string | null; shipment_no: string | null;
  value: string | null; flag: string | null; unit: string | null;
};

export default async function PatientPage({ params }: PageProps<"/patients/[hn]">) {
  const user = await requireRole();
  const { hn } = await params;
  const p = db.prepare("SELECT * FROM patients WHERE hn = ?").get(hn) as Patient | undefined;
  if (!p) notFound();
  audit(db, user.id, "VIEW", "patient", p.id); // PDPA: who looked at whom

  const visits = db
    .prepare("SELECT id, vn, scheme, created_at FROM visits WHERE patient_id = ? ORDER BY id DESC")
    .all(p.id) as Visit[];
  const items = db
    .prepare(
      `SELECT o.visit_id, o.id AS order_id, o.priority, o.ordered_at, u.name AS doctor,
              i.id AS item_id, t.code, t.name, i.status, ol.code AS outlab, s.accession_no, sh.shipment_no, i.value, i.flag, t.unit
       FROM lab_orders o
       JOIN visits v ON v.id = o.visit_id
       JOIN users u ON u.id = o.ordered_by
       JOIN lab_order_items i ON i.order_id = o.id
       JOIN lab_tests t ON t.id = i.test_id
       LEFT JOIN outlabs ol ON ol.id = t.outlab_id
       LEFT JOIN specimens s ON s.id = i.specimen_id
       LEFT JOIN shipments sh ON sh.id = s.shipment_id
       WHERE v.patient_id = ? ORDER BY o.id DESC, i.id`,
    )
    .all(p.id) as Item[];

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-x-8 gap-y-1">
        <div>
          <div className="text-xs text-slate-500">HN</div>
          <div className="font-mono text-lg font-semibold">{p.hn}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">ชื่อ-นามสกุล</div>
          <div className="text-lg font-semibold">
            {p.prefix}
            {p.first_name} {p.last_name}
          </div>
        </div>
        <div className="text-sm">
          {p.sex === "M" ? "ชาย" : "หญิง"} · อายุ {age(p.dob)} ปี · เกิด {p.dob}
        </div>
        <div className="font-mono text-sm">{p.cid}</div>
        {p.phone && <div className="text-sm">โทร {p.phone}</div>}
      </div>

      {user.role === "DOCTOR" && <AiSummaryCard patientId={p.id} />}

      {user.role === "CLERK" && (
        <form action={openVisit} className="card flex items-end gap-2">
          <input type="hidden" name="patientId" value={p.id} />
          <div className="w-60">
            <label className="label">สิทธิการรักษา</label>
            <select name="scheme" className="input">
              {Object.entries(SCHEME).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <button className="btn">เปิด Visit ใหม่</button>
        </form>
      )}

      <h2 className="font-semibold">ประวัติการมารับบริการ</h2>
      {visits.length === 0 && <p className="text-sm text-slate-500">ยังไม่มี Visit</p>}
      {visits.map((v) => {
        const its = items.filter((i) => i.visit_id === v.id);
        return (
          <div key={v.id} className="card space-y-3">
            <div className="flex items-center gap-4">
              <span className="font-mono font-semibold">{v.vn}</span>
              <span className="text-sm text-slate-500">{v.created_at}</span>
              <span className="text-sm">{SCHEME[v.scheme]}</span>
              {user.role === "DOCTOR" && (
                <Link href={`/visits/${v.vn}/order`} className="btn ml-auto">
                  สั่ง Lab
                </Link>
              )}
            </div>
            {its.length > 0 && (
              <table className="table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Test</th>
                    <th>ส่งตรวจที่</th>
                    <th>Accession / Shipment</th>
                    <th>สถานะ / ผล</th>
                    <th>แพทย์</th>
                  </tr>
                </thead>
                <tbody>
                  {its.map((i) => (
                    <tr key={i.item_id}>
                      <td className="font-mono text-xs">
                        {user.role === "DOCTOR" || user.role === "LAB" ? (
                          <Link href={`/reports/${i.order_id}`} className="text-teal-700 hover:underline">
                            #{i.order_id}
                          </Link>
                        ) : (
                          `#${i.order_id}`
                        )}{" "}
                        {i.priority === "STAT" && <b className="text-red-600">STAT</b>}
                      </td>
                      <td>
                        <span className="font-mono">{i.code}</span> {i.name}
                      </td>
                      <td>{i.outlab ?? "ในโรงพยาบาล"}</td>
                      <td className="font-mono text-xs">
                        {i.accession_no ?? "-"}
                        {i.shipment_no && <div className="text-slate-500">{i.shipment_no}</div>}
                      </td>
                      <td>
                        {/* value only once verified: unverified results are never shown to clinicians */}
                        {i.status === "VERIFIED" ? (
                          <span className="font-semibold">
                            {i.value} <span className="text-xs font-normal text-slate-500">{i.unit}</span>{" "}
                            {i.flag && i.flag !== "N" && (
                              <span className={`rounded px-1.5 py-0.5 text-xs ${FLAG[i.flag].cls}`}>{FLAG[i.flag].label}</span>
                            )}
                          </span>
                        ) : (
                          <span className={`rounded px-2 py-0.5 text-xs ${ITEM_STATUS[i.status].cls}`}>
                            {ITEM_STATUS[i.status].label}
                          </span>
                        )}
                      </td>
                      <td className="text-slate-500">{i.doctor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}
