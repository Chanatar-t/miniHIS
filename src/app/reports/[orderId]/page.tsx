import { notFound } from "next/navigation";
import { db, audit } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { FLAG, ITEM_STATUS, SCHEME, age, isCritical, refRange } from "@/lib/labels";
import { Flash } from "@/components/flash";
import { PrintButton } from "@/components/client";
import { amendResult } from "@/app/lab/results/actions";

type Head = {
  id: number; priority: string; ordered_at: string; note: string | null; doctor: string; vn: string; scheme: string;
  patient_id: number; hn: string; patient: string; sex: string; dob: string;
};
type Item = {
  id: number; code: string; name: string; loinc: string | null; status: string; value: string | null; flag: string | null;
  unit: string | null; ref_low: number | null; ref_high: number | null; outlab: string | null;
  accession_no: string | null; collected_at: string | null; verified_at: string | null; verifier: string | null;
};
type Amend = { item_id: number; old_value: string; new_value: string; reason: string; by: string; at: string };
type Notice = { item_id: number; notified_to: string; method: string; by: string; at: string };

export default async function ReportPage({ params, searchParams }: PageProps<"/reports/[orderId]">) {
  const user = await requireRole("DOCTOR", "LAB");
  const orderId = Number((await params).orderId);
  const h = db
    .prepare(
      `SELECT o.id, o.priority, o.ordered_at, o.note, d.name AS doctor, v.vn, v.scheme, p.id AS patient_id, p.hn,
              p.prefix || p.first_name || ' ' || p.last_name AS patient, p.sex, p.dob
       FROM lab_orders o JOIN users d ON d.id = o.ordered_by JOIN visits v ON v.id = o.visit_id JOIN patients p ON p.id = v.patient_id
       WHERE o.id = ?`,
    )
    .get(orderId) as Head | undefined;
  if (!h) notFound();
  audit(db, user.id, "VIEW", "lab_report", orderId);

  const items = db
    .prepare(
      `SELECT i.id, t.code, t.name, t.loinc, i.status, i.value, i.flag, t.unit, t.ref_low, t.ref_high, ol.name AS outlab,
              s.accession_no, s.collected_at, i.verified_at, u.name AS verifier
       FROM lab_order_items i JOIN lab_tests t ON t.id = i.test_id LEFT JOIN outlabs ol ON ol.id = t.outlab_id
       LEFT JOIN specimens s ON s.id = i.specimen_id LEFT JOIN users u ON u.id = i.verified_by
       WHERE i.order_id = ? AND i.status NOT IN ('REJECTED','CANCELLED') ORDER BY i.id`,
    )
    .all(orderId) as Item[];
  const amends = db
    .prepare(
      `SELECT a.item_id, a.old_value, a.new_value, a.reason, u.name AS by, a.at FROM result_amendments a
       JOIN users u ON u.id = a.by_user JOIN lab_order_items i ON i.id = a.item_id WHERE i.order_id = ? ORDER BY a.id`,
    )
    .all(orderId) as Amend[];
  const notices = db
    .prepare(
      `SELECT c.item_id, c.notified_to, c.method, u.name AS by, c.at FROM critical_notifications c
       JOIN users u ON u.id = c.by_user JOIN lab_order_items i ON i.id = c.item_id WHERE i.order_id = ? ORDER BY c.id`,
    )
    .all(orderId) as Notice[];
  const sp = await searchParams;

  return (
    <div className="space-y-4">
      <div className="no-print flex items-center gap-2">
        <PrintButton label="พิมพ์ใบรายงานผล" />
        <div className="flex-1">
          <Flash sp={sp} />
        </div>
      </div>

      <div className="card space-y-4">
        <div className="flex justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">รายงานผลการตรวจทางห้องปฏิบัติการ</h1>
            <div className="text-sm">
              <span className="font-mono">{h.hn}</span> <b>{h.patient}</b> · {h.sex === "M" ? "ชาย" : "หญิง"} {age(h.dob)} ปี
            </div>
            <div className="text-sm text-slate-600">
              {h.vn} · {SCHEME[h.scheme]} · แพทย์ผู้สั่ง {h.doctor}
            </div>
          </div>
          <div className="text-right text-sm">
            <div className="font-mono">Order #{h.id}</div>
            {h.priority === "STAT" && <b className="text-red-600">STAT</b>}
            <div className="text-slate-600">สั่ง {h.ordered_at}</div>
          </div>
        </div>

        <table className="table">
          <thead>
            <tr>
              <th>Test</th>
              <th>ผล</th>
              <th />
              <th>หน่วย</th>
              <th>ค่าอ้างอิง</th>
              <th>ตรวจที่</th>
              <th>รายงานผล</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => {
              const done = i.status === "VERIFIED";
              const itemAmends = amends.filter((a) => a.item_id === i.id);
              return (
                <tr key={i.id} className={done && isCritical(i.flag) ? "bg-red-50" : ""}>
                  <td>
                    <span className="font-mono font-semibold">{i.code}</span> {i.name}
                    {i.loinc && <div className="text-xs text-slate-400">LOINC {i.loinc}</div>}
                  </td>
                  {done ? (
                    <>
                      <td className="font-semibold">
                        {i.value}
                        {itemAmends.length > 0 && <span className="ml-1 text-xs font-normal text-amber-700">(แก้ไข)</span>}
                      </td>
                      <td>{i.flag && i.flag !== "N" && <span className={`rounded px-1.5 py-0.5 text-xs ${FLAG[i.flag].cls}`}>{FLAG[i.flag].label}</span>}</td>
                    </>
                  ) : (
                    <td colSpan={2}>
                      <span className={`rounded px-2 py-0.5 text-xs ${ITEM_STATUS[i.status].cls}`}>{ITEM_STATUS[i.status].label}</span>
                    </td>
                  )}
                  <td className="text-xs">{i.unit}</td>
                  <td className="text-xs">{refRange(i.ref_low, i.ref_high)}</td>
                  <td className="text-xs">{i.outlab ?? "ในโรงพยาบาล"}</td>
                  <td className="text-xs">
                    {done && (
                      <>
                        {i.verifier}
                        <div className="text-slate-400">{i.verified_at}</div>
                        {user.role === "LAB" && (
                          <details className="no-print mt-1">
                            <summary className="cursor-pointer text-teal-700">แก้ไขผล</summary>
                            <form action={amendResult} className="mt-1 space-y-1">
                              <input type="hidden" name="orderId" value={h.id} />
                              <input type="hidden" name="itemId" value={i.id} />
                              <input name="value" required placeholder="ผลใหม่" className="input py-1 text-xs" />
                              <input name="reason" required placeholder="เหตุผล (บังคับ)" className="input py-1 text-xs" />
                              <input name="notifiedTo" placeholder="ผู้รับแจ้ง (ถ้าเป็นค่าวิกฤต)" className="input py-1 text-xs" />
                              <button className="btn-ghost text-xs">บันทึกการแก้ไข</button>
                            </form>
                          </details>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {amends.length > 0 && (
          <div className="text-xs">
            <div className="font-semibold">ประวัติการแก้ไขผล</div>
            {amends.map((a, n) => (
              <div key={n}>
                {items.find((i) => i.id === a.item_id)?.code}: {a.old_value} → {a.new_value} · เหตุผล: {a.reason} · {a.by} {a.at}
              </div>
            ))}
          </div>
        )}
        {notices.length > 0 && (
          <div className="text-xs">
            <div className="font-semibold">บันทึกการแจ้งค่าวิกฤต</div>
            {notices.map((c, n) => (
              <div key={n}>
                {items.find((i) => i.id === c.item_id)?.code}: แจ้ง {c.notified_to} ทาง{c.method} โดย {c.by} {c.at}
              </div>
            ))}
          </div>
        )}
        {h.note && <div className="text-xs text-slate-600">หมายเหตุจากแพทย์: {h.note}</div>}
      </div>
    </div>
  );
}
