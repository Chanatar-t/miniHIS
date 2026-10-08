import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { SCHEME, queueNo, thDate } from "@/lib/labels";
import { AutoPrint, Barcode, PrintButton } from "@/components/client";
import { BackLink, fullName } from "@/components/patient";

type Slip = { vn: string; scheme: string; created_at: string; hn: string; prefix: string; first_name: string; last_name: string };

// Queue slip the patient carries: queue no. big, VN barcode so the doctor/lab can scan it
export default async function SlipPage({ params, searchParams }: PageProps<"/visits/[vn]/slip">) {
  await requireRole("CLERK", "ADMIN");
  const { vn } = await params;
  const back = (await searchParams).back === "list" ? "/patients" : null;
  const v = db
    .prepare(
      `SELECT v.vn, v.scheme, v.created_at, p.hn, p.prefix, p.first_name, p.last_name
       FROM visits v JOIN patients p ON p.id = v.patient_id WHERE v.vn = ?`,
    )
    .get(vn) as Slip | undefined;
  if (!v) notFound();

  return (
    <div className="space-y-4">
      <AutoPrint />
      <div className="no-print flex items-center gap-3">
        <BackLink href={back ?? `/patients/${v.hn}`}>กลับ</BackLink>
        <PrintButton label="พิมพ์ใบคิวอีกครั้ง" />
      </div>
      {/* ~80mm thermal roll */}
      <div className="mx-auto w-[80mm] space-y-2 bg-white p-4 text-center text-black print:mx-0 print:p-0">
        <div className="text-sm font-semibold">Mini HIS · ใบคิว</div>
        <div className="text-xs">คิวที่</div>
        <div className="text-6xl font-bold leading-none">{queueNo(v.vn)}</div>
        <div className="text-base font-semibold">{fullName(v)}</div>
        <div className="text-sm">
          <span className="font-mono">{v.hn}</span> · {SCHEME[v.scheme]}
        </div>
        <div className="flex justify-center">
          <Barcode value={v.vn} height={40} />
        </div>
        <div className="text-xs">{thDate(v.created_at)}</div>
        <div className="border-t border-dashed border-black pt-2 text-xs">กรุณารอเรียกชื่อหน้าห้องตรวจ</div>
      </div>
    </div>
  );
}
