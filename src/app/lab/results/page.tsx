import { CircleCheck, FileInput, Microscope, TestTubeDiagonal, TriangleAlert, Truck } from "lucide-react";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { refRange, thDate, DUE_OFFSET } from "@/lib/labels";
import { Flash } from "@/components/flash";
import { LabSteps, labCounts } from "../steps";
import { ResultInput } from "./result-input";
import { saveResults, importHl7 } from "./actions";
import { approvedRanges, rangeFor, type Range } from "@/lib/ranges";

type Row = {
  item_id: number; accession_no: string; collected_at: string; hn: string; patient: string; priority: string;
  code: string; name: string; unit: string | null; ref_low: number | null; ref_high: number | null; crit_low: number | null; crit_high: number | null;
  outlab: string | null; outlab_code: string | null; tat_days: number; due: string; overdue: number;
};

export default async function ResultsPage({ searchParams }: PageProps<"/lab/results">) {
  await requireRole("LAB");
  const sp = await searchParams;
  // ready for a result: in-house tube received, or outlab tube already sent
  const raw = db
    .prepare(
      `SELECT i.id AS item_id, s.accession_no, s.collected_at, p.hn, p.prefix || p.first_name || ' ' || p.last_name AS patient, o.priority,
              i.test_id, p.sex, p.dob, t.code, t.name, t.unit, ol.code AS outlab, t.outlab_code, t.tat_days,
              datetime(s.collected_at, ${DUE_OFFSET}) AS due,
              datetime(s.collected_at, ${DUE_OFFSET}) < datetime('now','localtime') AS overdue
       FROM lab_order_items i
       JOIN specimens s ON s.id = i.specimen_id JOIN lab_tests t ON t.id = i.test_id
       JOIN lab_orders o ON o.id = i.order_id JOIN visits v ON v.id = o.visit_id JOIN patients p ON p.id = v.patient_id
       LEFT JOIN outlabs ol ON ol.id = t.outlab_id
       WHERE (t.outlab_id IS NULL AND i.status = 'RECEIVED') OR (t.outlab_id IS NOT NULL AND i.status = 'SENT')
       ORDER BY o.priority = 'STAT' DESC, overdue DESC, s.collected_at, i.id`,
    )
    .all() as (Omit<Row, keyof Range> & { test_id: number; sex: string; dob: string })[];
  // the range each patient will be flagged with (sex/age specific, in force today) — same as the server uses on save
  const ranges = approvedRanges();
  const rows: Row[] = raw.map((r) => ({ ...r, ...rangeFor(ranges, r.test_id, r.sex, r.dob) }));
  const inhouse = rows.filter((r) => !r.outlab);
  const outlab = rows.filter((r) => r.outlab);
  const tab = sp.tab === "out" || sp.tab === "in" ? sp.tab : inhouse.length || !outlab.length ? "in" : "out";
  const c = labCounts();
  const sample = typeof sp.sample === "string" ? sampleOru(sp.sample, outlab) : "";

  return (
    <div className="space-y-5">
      <LabSteps current="results" />
      <div>
        <h1 className="text-2xl font-semibold">ลงผล / รับผล</h1>
        <p className="text-sm text-slate-500">บันทึกผลแล้วรายการจะไปรอที่ขั้น Verify ให้เจ้าหน้าที่อีกคนตรวจทานก่อนแพทย์เห็น</p>
      </div>
      <Flash sp={sp} />

      {/* two kinds of work, two tabs */}
      <div className="grid gap-3 sm:grid-cols-2" role="tablist">
        {(
          [
            ["in", Microscope, "ตรวจในโรงพยาบาล", "คีย์ผลจากเครื่องตรวจในห้อง Lab", inhouse.length],
            ["out", Truck, "รอผลจาก Outlab", "นำเข้าไฟล์ผลที่ Outlab ส่งมา หรือคีย์เอง", outlab.length],
          ] as const
        ).map(([key, Icon, title, desc, n]) => (
          <Link
            key={key}
            href={`/lab/results?tab=${key}`}
            role="tab"
            aria-selected={tab === key}
            className={`flex items-center gap-3 rounded-xl border-2 p-4 transition ${tab === key ? "border-violet-500 bg-violet-50" : "border-slate-200 bg-white hover:border-violet-300"}`}
          >
            <Icon className="h-7 w-7 text-violet-600" aria-hidden />
            <span className="flex-1">
              <span className="block font-semibold">{title}</span>
              <span className="block text-xs text-slate-500">{desc}</span>
            </span>
            <span className={`rounded-full px-3 py-1 text-sm font-bold ${n ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-400"}`}>{n}</span>
          </Link>
        ))}
      </div>

      {tab === "in" ? (
        inhouse.length ? (
          <Tubes rows={inhouse} />
        ) : (
          <Empty
            title="ไม่มีผลที่รอคีย์ในโรงพยาบาล"
            hints={[
              c.receive > 0 && { text: `มี ${c.receive} หลอดยังไม่ได้สแกนรับเข้า Lab (ต้องรับเข้าก่อนจึงจะลงผลได้)`, href: "/lab/receive", cta: "ไปรับเข้า Lab" },
              c.collect > 0 && { text: `มี ${c.collect} ใบสั่งยังไม่ได้เก็บสิ่งส่งตรวจ`, href: "/lab/collect", cta: "ไปเก็บสิ่งส่งตรวจ" },
              outlab.length > 0 && { text: `มี ${outlab.length} รายการรอผลจาก Outlab`, href: "/lab/results?tab=out", cta: "ดูรายการ Outlab" },
            ]}
          />
        )
      ) : (
        <div className="space-y-4">
          <form action={importHl7} className="card space-y-3 border-violet-200">
            <div>
              <h2 className="flex items-center gap-1.5 font-semibold"><FileInput className="h-5 w-5 text-violet-600" aria-hidden /> นำเข้าไฟล์ผลจาก Outlab</h2>
              <p className="text-sm text-slate-500">
                Outlab ส่งผลมาเป็นไฟล์มาตรฐาน HL7 (.hl7) เลือกไฟล์แล้วกดนำเข้า ระบบจับคู่กับหลอดด้วยเลข Accession และติดธงสูง/ต่ำให้เอง
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-slate-300 p-3">
              <input type="file" name="file" accept=".hl7,.txt" className="text-sm" />
              <button className="btn ml-auto px-4 py-2">นำเข้าผล</button>
            </div>
            <details open={!!sample} className="text-sm">
              <summary className="cursor-pointer text-slate-600">หรือวางข้อความ HL7 เอง {outlab.length > 0 && "· เดโม: สร้างไฟล์ตัวอย่าง"}</summary>
              <div className="mt-2 space-y-2">
                <div className="flex flex-wrap gap-2">
                  {[...new Set(outlab.map((r) => r.outlab!))].map((o) => (
                    <Link key={o} href={`/lab/results?tab=out&sample=${o}`} className="btn-ghost text-xs">
                      สร้างข้อความตัวอย่างจาก {o}
                    </Link>
                  ))}
                </div>
                <textarea name="raw" rows={sample ? 8 : 3} defaultValue={sample} key={sample} className="input font-mono text-xs" placeholder="MSH|^~\&|..." />
              </div>
            </details>
          </form>

          {outlab.length ? (
            <>
              <h2 className="pt-2 font-semibold">หรือคีย์ผลเอง (กรณี Outlab ส่งผลเป็นกระดาษ / ผ่านเว็บ)</h2>
              <Tubes rows={outlab} />
            </>
          ) : (
            <Empty
              title="ไม่มีรายการรอผลจาก Outlab"
              hints={[
                c.ship > 0 && { text: `มี ${c.ship} หลอดรอส่ง Outlab (ต้องส่งก่อน ผลจึงจะกลับมา)`, href: "/lab/shipments", cta: "ไปส่ง Outlab" },
                c.receive > 0 && { text: `มี ${c.receive} หลอดยังไม่ได้สแกนรับเข้า Lab`, href: "/lab/receive", cta: "ไปรับเข้า Lab" },
              ]}
            />
          )}
        </div>
      )}
    </div>
  );
}

function Tubes({ rows }: { rows: Row[] }) {
  return (
    <div className="stagger space-y-3">
      {[...Map.groupBy(rows, (r) => r.accession_no).values()].map((items) => {
        const s = items[0];
        return (
          <form key={s.accession_no} action={saveResults} className={`card space-y-2 ${s.priority === "STAT" ? "border-red-300" : ""}`}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="inline-flex items-center gap-1 font-mono font-semibold"><TestTubeDiagonal className="h-4 w-4 text-violet-600" aria-hidden />{s.accession_no}</span>
              {s.priority === "STAT" && <b className="text-red-600">STAT</b>}
              <span className="font-medium">{s.patient}</span>
              <span className="font-mono text-xs text-slate-500">{s.hn}</span>
              {s.outlab && <span className="rounded bg-violet-50 px-2 py-0.5 text-xs text-violet-700">{s.outlab}</span>}
              <span className={`ml-auto text-xs ${s.overdue ? "font-semibold text-red-600" : "text-slate-500"}`}>
                {s.overdue ? <><TriangleAlert className="mr-0.5 inline h-3.5 w-3.5" aria-hidden />เกินกำหนดได้ผล </> : "กำหนดได้ผล "}
                {thDate(s.due)}
              </span>
            </div>
            <ul className="divide-y divide-slate-100">
              {items.map((i) => (
                <li key={i.item_id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
                  <div className="min-w-48 flex-1">
                    <span className="font-mono font-semibold">{i.code}</span> <span className="text-slate-600">{i.name}</span>
                    {i.outlab_code && <span className="ml-1 text-xs text-slate-400">({i.outlab_code})</span>}
                  </div>
                  <ResultInput name={`value_${i.item_id}`} label={`ผล ${i.code}`} range={{ ref_low: i.ref_low, ref_high: i.ref_high, crit_low: i.crit_low, crit_high: i.crit_high }} />
                  <span className="w-16 text-xs text-slate-500">{i.unit}</span>
                  <span className="w-28 text-xs text-slate-500">ปกติ {refRange(i.ref_low, i.ref_high)}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end">
              <button className="btn">บันทึกผล → ส่งไป Verify</button>
            </div>
          </form>
        );
      })}
    </div>
  );
}

type Hint = { text: string; href: string; cta: string } | false;
function Empty({ title, hints }: { title: string; hints: Hint[] }) {
  const h = hints.filter(Boolean) as Exclude<Hint, false>[];
  return (
    <div className="card animate-fade-up space-y-3 py-8 text-center">
      <CircleCheck className="mx-auto h-10 w-10 text-emerald-500" aria-hidden />
      <div className="font-semibold">{title}</div>
      {h.length > 0 ? (
        <ul className="mx-auto max-w-lg space-y-2 text-left">
          {h.map((x) => (
            <li key={x.href} className="flex items-center gap-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span className="flex-1">{x.text}</span>
              <Link href={x.href} className="btn whitespace-nowrap">
                {x.cta} →
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">ไม่มีงานค้างในขั้นก่อนหน้า</p>
      )}
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
