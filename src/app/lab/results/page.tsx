import Link from "next/link";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { refRange } from "@/lib/labels";
import { Flash } from "@/components/flash";
import { saveResults, importHl7 } from "./actions";

type Row = {
  item_id: number; accession_no: string; collected_at: string; hn: string; patient: string; priority: string;
  code: string; name: string; unit: string | null; ref_low: number | null; ref_high: number | null;
  outlab: string | null; outlab_code: string | null; tat_days: number; due: string; overdue: number;
};

export default async function ResultsPage({ searchParams }: PageProps<"/lab/results">) {
  await requireRole("LAB");
  const sp = await searchParams;
  // ready for a result: in-house tube received, or outlab tube already sent
  const rows = db
    .prepare(
      `SELECT i.id AS item_id, s.accession_no, s.collected_at, p.hn, p.first_name || ' ' || p.last_name AS patient, o.priority,
              t.code, t.name, t.unit, t.ref_low, t.ref_high, ol.code AS outlab, t.outlab_code, t.tat_days,
              datetime(s.collected_at, '+' || t.tat_days || ' days') AS due,
              datetime(s.collected_at, '+' || t.tat_days || ' days') < datetime('now','localtime') AS overdue
       FROM lab_order_items i
       JOIN specimens s ON s.id = i.specimen_id JOIN lab_tests t ON t.id = i.test_id
       JOIN lab_orders o ON o.id = i.order_id JOIN visits v ON v.id = o.visit_id JOIN patients p ON p.id = v.patient_id
       LEFT JOIN outlabs ol ON ol.id = t.outlab_id
       WHERE (t.outlab_id IS NULL AND i.status = 'RECEIVED') OR (t.outlab_id IS NOT NULL AND i.status = 'SENT')
       ORDER BY o.priority = 'STAT' DESC, overdue DESC, s.collected_at, i.id`,
    )
    .all() as Row[];
  const tubes = [...Map.groupBy(rows, (r) => r.accession_no).values()];
  const sample = typeof sp.sample === "string" ? sampleOru(sp.sample, rows) : "";

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">ลงผล / รับผลจาก Outlab</h1>
      <Flash sp={sp} />

      <form action={importHl7} className="card space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">นำเข้าผล HL7 (ORU^R01)</h2>
          <span className="text-xs text-slate-500">เดโม: สร้างข้อความตัวอย่างจากหลอดที่ส่งไปแล้ว →</span>
          {["OUT-A", "OUT-B"].map((c) => (
            <Link key={c} href={`/lab/results?sample=${c}`} className="btn-ghost text-xs">
              ตัวอย่างจาก {c}
            </Link>
          ))}
        </div>
        <textarea name="raw" rows={sample ? 8 : 3} defaultValue={sample} key={sample} className="input font-mono text-xs" placeholder="วางข้อความ HL7 ที่นี่ หรือเลือกไฟล์" />
        <div className="flex items-center gap-2">
          <input type="file" name="file" accept=".hl7,.txt" className="text-sm" />
          <button className="btn ml-auto">นำเข้า</button>
        </div>
      </form>

      <h2 className="font-semibold">รอผล ({rows.length} รายการ)</h2>
      {tubes.length === 0 && <p className="text-sm text-slate-500">ไม่มีรายการรอผล</p>}
      {tubes.map((items) => {
        const s = items[0];
        return (
          <form key={s.accession_no} action={saveResults} className={`card space-y-2 ${s.priority === "STAT" ? "border-red-300" : ""}`}>
            <div className="flex flex-wrap items-center gap-x-4 text-sm">
              <span className="font-mono font-semibold">{s.accession_no}</span>
              {s.priority === "STAT" && <b className="text-red-600">STAT</b>}
              <span>
                <span className="font-mono text-xs">{s.hn}</span> {s.patient}
              </span>
              <span className="text-slate-500">{s.outlab ?? "In-house"}</span>
              <span className={`ml-auto text-xs ${s.overdue ? "font-semibold text-red-600" : "text-slate-500"}`}>
                {s.overdue ? "⚠ เกินกำหนด " : "กำหนดได้ผล "}
                {s.due.slice(0, 16)}
              </span>
            </div>
            <table className="table">
              <tbody>
                {items.map((i) => (
                  <tr key={i.item_id}>
                    <td className="w-1/3">
                      <span className="font-mono font-semibold">{i.code}</span> {i.name}
                      {i.outlab_code && <span className="ml-1 text-xs text-slate-400">({i.outlab_code})</span>}
                    </td>
                    <td className="w-40">
                      <input name={`value_${i.item_id}`} aria-label={`ผล ${i.code}`} autoComplete="off" className="input" />
                    </td>
                    <td className="text-xs text-slate-500">{i.unit}</td>
                    <td className="text-xs text-slate-500">ค่าอ้างอิง {refRange(i.ref_low, i.ref_high)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="btn">บันทึกผล</button>
          </form>
        );
      })}
    </div>
  );
}

// Demo helper: what the outlab would send back for the tubes we shipped to it.
// First result is abnormal high, the rest mid-range, so the demo shows flagging.
function sampleOru(outlab: string, rows: Row[]) {
  const sent = rows.filter((r) => r.outlab === outlab);
  if (sent.length === 0) return "";
  const ts = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const lines = [`MSH|^~\\&|${outlab}|${outlab}|MINIHIS|HOSP|${ts}||ORU^R01|${outlab}-${ts}|P|2.5`];
  for (const [acc, items] of Map.groupBy(sent, (r) => r.accession_no)) {
    lines.push(`PID|1||${items[0].hn}`, `OBR|1|${acc}`);
    items.forEach((r, n) => {
      const lo = r.ref_low ?? 0, hi = r.ref_high ?? 10;
      const v = lines.length <= 3 && n === 0 ? hi * 3 : (lo + hi) / 2;
      lines.push(`OBX|${n + 1}|NM|${r.outlab_code}^${r.code}||${+v.toFixed(2)}|${r.unit ?? ""}|${refRange(r.ref_low, r.ref_high)}||||F`);
    });
  }
  return lines.join("\n");
}
