import { BackLink } from "@/components/patient";
import { LabSteps } from "../../steps";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { age } from "@/lib/labels";
import { PrintButton } from "@/components/client";
import { Flash } from "@/components/flash";
import { sendShipment, removeFromShipment } from "../../actions";

type Sh = { id: number; shipment_no: string; status: string; created_at: string; sent_at: string | null; outlab: string; outlab_name: string; created_by: string };
type Line = {
  id: number; accession_no: string; specimen_type: string; container: string; collected_at: string;
  hn: string; patient: string; sex: string; dob: string; priority: string; tests: string;
};

export default async function ManifestPage({ params, searchParams }: PageProps<"/lab/shipments/[no]">) {
  await requireRole("LAB");
  const { no } = await params;
  const sh = db
    .prepare(
      `SELECT sh.id, sh.shipment_no, sh.status, sh.created_at, sh.sent_at, ol.code AS outlab, ol.name AS outlab_name, u.name AS created_by
       FROM shipments sh JOIN outlabs ol ON ol.id = sh.outlab_id JOIN users u ON u.id = sh.created_by WHERE sh.shipment_no = ?`,
    )
    .get(no) as Sh | undefined;
  if (!sh) notFound();

  // outlab sees ITS test codes, not ours (catalog mapping)
  const lines = db
    .prepare(
      `SELECT s.id, s.accession_no, s.specimen_type, s.container, s.collected_at, p.hn,
              p.prefix || p.first_name || ' ' || p.last_name AS patient, p.sex, p.dob, o.priority,
              group_concat(t.outlab_code || ' ' || t.code, ', ') AS tests
       FROM specimens s
       JOIN lab_orders o ON o.id = s.order_id JOIN visits v ON v.id = o.visit_id JOIN patients p ON p.id = v.patient_id
       JOIN lab_order_items i ON i.specimen_id = s.id JOIN lab_tests t ON t.id = i.test_id
       WHERE s.shipment_id = ? GROUP BY s.id ORDER BY o.priority = 'STAT' DESC, s.accession_no`,
    )
    .all(sh.id) as Line[];
  const draft = sh.status === "DRAFT";

  return (
    <div className="space-y-4">
      <BackLink href="/lab/shipments">รายการใบนำส่ง</BackLink>
      <LabSteps current="ship" back={false} />
      <div className="no-print">
        <Flash sp={await searchParams} />
      </div>
      <div className="no-print flex items-center gap-2">
        <PrintButton label="พิมพ์ใบนำส่ง" />
        {draft && lines.length > 0 && (
          <form action={sendShipment}>
            <input type="hidden" name="shipmentNo" value={sh.shipment_no} />
            <button className="btn bg-violet-700 hover:bg-violet-800">ยืนยันส่ง (ส่งมอบให้ผู้รับแล้ว)</button>
          </form>
        )}
      </div>

      <div className="card space-y-4">
        <div className="flex justify-between">
          <div>
            <h1 className="text-lg font-semibold">ใบนำส่งสิ่งส่งตรวจ (Specimen Manifest)</h1>
            <div className="text-sm">
              ถึง: <b>{sh.outlab}</b> {sh.outlab_name}
            </div>
          </div>
          <div className="text-right text-sm">
            <div className="font-mono text-lg font-semibold">{sh.shipment_no}</div>
            <div>สร้าง {sh.created_at}</div>
            <div>{draft ? <span className="text-amber-700">ยังไม่ส่ง</span> : `ส่ง ${sh.sent_at}`}</div>
          </div>
        </div>

        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Accession</th>
              <th>HN / ผู้ป่วย</th>
              <th>เพศ/อายุ</th>
              <th>Tests (รหัส Outlab)</th>
              <th>สิ่งส่งตรวจ</th>
              <th>เก็บเมื่อ</th>
              {draft && <th className="no-print" />}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.id}>
                <td>{i + 1}</td>
                <td className="font-mono">
                  {l.accession_no} {l.priority === "STAT" && <b className="text-red-600">STAT</b>}
                </td>
                <td>
                  <span className="font-mono text-xs">{l.hn}</span> {l.patient}
                </td>
                <td>
                  {l.sex}/{age(l.dob)}
                </td>
                <td className="text-xs">{l.tests}</td>
                <td className="text-xs">
                  {l.specimen_type}, {l.container}
                </td>
                <td className="text-xs">{l.collected_at}</td>
                {draft && (
                  <td className="no-print">
                    <form action={removeFromShipment}>
                      <input type="hidden" name="shipmentNo" value={sh.shipment_no} />
                      <input type="hidden" name="specimenId" value={l.id} />
                      <button className="text-xs text-slate-400 hover:text-red-600">เอาออก</button>
                    </form>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-sm">รวม {lines.length} หลอด</div>

        <div className="grid grid-cols-3 gap-8 pt-8 text-center text-sm">
          {[`ผู้ส่ง: ${sh.created_by}`, "ผู้รับ (Outlab)", "อุณหภูมิขณะส่งมอบ ____ °C"].map((s) => (
            <div key={s}>
              <div className="border-b border-dotted border-slate-400 pb-6" />
              <div className="mt-1">{s}</div>
              <div className="text-xs text-slate-500">วันที่/เวลา ____________</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
