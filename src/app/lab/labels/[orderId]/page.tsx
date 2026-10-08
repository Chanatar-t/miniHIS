import { LabSteps } from "../../steps";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { Barcode, PrintButton } from "@/components/client";

type Tube = {
  accession_no: string; specimen_type: string; container: string; collected_at: string;
  hn: string; patient: string; sex: string; dob: string; priority: string; tests: string; outlab: string | null;
};

export default async function LabelsPage({ params }: PageProps<"/lab/labels/[orderId]">) {
  await requireRole("LAB");
  const { orderId } = await params;
  const tubes = db
    .prepare(
      `SELECT s.accession_no, s.specimen_type, s.container, s.collected_at, p.hn, p.first_name || ' ' || p.last_name AS patient,
              p.sex, p.dob, o.priority, group_concat(t.code, ' ') AS tests, max(ol.code) AS outlab
       FROM specimens s
       JOIN lab_orders o ON o.id = s.order_id JOIN visits v ON v.id = o.visit_id JOIN patients p ON p.id = v.patient_id
       JOIN lab_order_items i ON i.specimen_id = s.id JOIN lab_tests t ON t.id = i.test_id
       LEFT JOIN outlabs ol ON ol.id = t.outlab_id
       WHERE s.order_id = ? AND s.reject_reason IS NULL
       GROUP BY s.id ORDER BY s.id`,
    )
    .all(Number(orderId)) as Tube[];
  if (tubes.length === 0) notFound();

  return (
    <div className="space-y-4">
      <LabSteps current="collect" />
      <div className="no-print flex items-center gap-3">
        <h1 className="text-xl font-semibold">ฉลากหลอดเลือด · Order #{orderId}</h1>
        <PrintButton label="พิมพ์ฉลาก" />
        <Link href="/lab/collect" className="btn-ghost">
          กลับไปหน้ารอเก็บ
        </Link>
      </div>
      <p className="no-print text-sm text-slate-500">
        ระบบแยกหลอดให้อัตโนมัติ: test ที่ใช้หลอดชนิดเดียวกันและส่งไปที่เดียวกันจะรวมเป็นหลอดเดียว ({tubes.length} หลอด)
      </p>
      <div className="flex flex-wrap gap-4">
        {/* ~50x25mm sticker */}
        {tubes.map((t) => (
          <div key={t.accession_no} className="w-[19rem] break-inside-avoid rounded border border-slate-400 bg-white p-2 text-[11px] leading-tight">
            <div className="flex justify-between font-semibold">
              <span>
                {t.hn} {t.patient}
              </span>
              {t.priority === "STAT" && <span className="text-red-600">STAT</span>}
            </div>
            <Barcode value={t.accession_no} height={36} />
            <div className="flex justify-between">
              <span>{t.container}</span>
              <span className="font-semibold">{t.outlab ?? "IN-HOUSE"}</span>
            </div>
            <div>{t.tests}</div>
            <div className="text-slate-500">เก็บ {t.collected_at}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
