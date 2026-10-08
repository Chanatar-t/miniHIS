import Link from "next/link";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { thDate } from "@/lib/labels";
import { todayIso } from "@/lib/ranges";
import { Flash } from "@/components/flash";
import { RangeValues, scopeLabel, versionState, type RangeFull } from "./shared";

type Test = { id: number; code: string; name: string; unit: string | null; outlab: string | null; active: number };

export default async function ConfigPage({ searchParams }: PageProps<"/config">) {
  const user = await requireRole("LAB");
  const tests = db
    .prepare("SELECT t.id, t.code, t.name, t.unit, ol.code AS outlab, t.active FROM lab_tests t LEFT JOIN outlabs ol ON ol.id = t.outlab_id ORDER BY t.active, t.code")
    .all() as Test[];
  const ranges = db
    .prepare(
      `SELECT r.*, pu.name AS proposer, ru.name AS reviewer FROM test_ranges r
       LEFT JOIN users pu ON pu.id = r.proposed_by LEFT JOIN users ru ON ru.id = r.reviewed_by ORDER BY r.id`,
    )
    .all() as RangeFull[];
  const today = todayIso();
  const pending = ranges.filter((r) => r.status === "PENDING");
  const byTest = Map.groupBy(ranges, (r) => r.test_id);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">ตั้งค่ารายการตรวจและค่าอ้างอิง</h1>
          <p className="text-sm text-slate-500">ค่าปกติและค่าวิกฤต แยกตามเพศ/อายุได้ ทุกการเปลี่ยนแปลงต้องมีเหตุผล และต้องให้ผู้มีสิทธิ์อีกคนอนุมัติ</p>
        </div>
        <Link href="/config/new" className="btn">
          + เพิ่มรายการตรวจใหม่
        </Link>
      </div>
      <Flash sp={await searchParams} />

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ["1", "เสนอ", "นักเทคนิคการแพทย์เสนอค่าใหม่ พร้อมเหตุผลและวันที่เริ่มใช้"],
          ["2", "อนุมัติ", "พยาธิแพทย์ (ผู้มีสิทธิ์) ตรวจผลกระทบแล้วอนุมัติ คนเสนออนุมัติเองไม่ได้"],
          ["3", "มีผล", "ใช้กับผลที่ลงหลังวันเริ่มใช้ ผลเก่ายังแสดงค่าอ้างอิงเดิมที่ใช้ตอนนั้น"],
        ].map(([n, t, d]) => (
          <div key={n} className="card flex gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-600 text-sm font-semibold text-white">{n}</span>
            <div>
              <div className="font-semibold">{t}</div>
              <p className="text-xs text-slate-600">{d}</p>
            </div>
          </div>
        ))}
      </div>

      <section id="pending" className={`card space-y-3 ${pending.length && user.canApprove ? "border-amber-300 bg-amber-50/40" : ""}`}>
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">รออนุมัติ</h2>
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${pending.length ? "bg-amber-500 text-white" : "bg-slate-100 text-slate-400"}`}>{pending.length}</span>
          {user.canApprove ? (
            <span className="text-xs text-amber-800">คุณมีสิทธิ์อนุมัติ</span>
          ) : (
            <span className="text-xs text-slate-500">ต้องให้ผู้มีสิทธิ์อนุมัติ (พยาธิแพทย์)</span>
          )}
        </div>
        {pending.length === 0 ? (
          <p className="text-sm text-slate-500">ไม่มีข้อเสนอค้าง</p>
        ) : (
          <ul className="stagger divide-y divide-slate-100">
            {pending.map((r) => {
              const t = tests.find((x) => x.id === r.test_id)!;
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm">
                  <Link href={`/config/${t.code}#range-${r.id}`} className="font-mono font-semibold text-teal-700 hover:underline">
                    {t.code}
                  </Link>
                  <span className="text-slate-600">{scopeLabel(r)}</span>
                  <RangeValues r={r} />
                  <span className="text-xs text-slate-500">
                    เสนอโดย {r.proposer} · {thDate(r.proposed_at)}
                  </span>
                  <Link href={`/config/${t.code}#range-${r.id}`} className="btn-ghost ml-auto text-xs">
                    {user.canApprove && r.proposed_by !== user.id ? "พิจารณา →" : "ดูรายละเอียด →"}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="card p-0">
        <table className="table">
          <thead>
            <tr>
              <th>รายการตรวจ</th>
              <th>ค่าปกติที่ใช้อยู่วันนี้</th>
              <th>หน่วย</th>
              <th>ตรวจที่</th>
              <th>สถานะ</th>
            </tr>
          </thead>
          <tbody className="stagger">
            {tests.map((t) => {
              const rs = byTest.get(t.id) ?? [];
              const current = rs.filter((r) => versionState(r, rs, today).label === "ใช้อยู่");
              const waiting = rs.filter((r) => r.status === "PENDING").length;
              return (
                <tr key={t.id}>
                  <td>
                    <Link href={`/config/${t.code}`} className="font-mono font-semibold text-teal-700 hover:underline">
                      {t.code}
                    </Link>{" "}
                    <span className="text-slate-600">{t.name}</span>
                  </td>
                  <td className="space-y-0.5 text-xs">
                    {current.length === 0 && <span className="text-slate-400">ยังไม่มีค่าที่อนุมัติ</span>}
                    {current.map((r) => (
                      <div key={r.id}>
                        <span className="inline-block w-36 text-slate-500">{scopeLabel(r)}</span> <RangeValues r={r} />
                      </div>
                    ))}
                  </td>
                  <td className="text-xs text-slate-500">{t.unit}</td>
                  <td className="text-xs">{t.outlab ?? "ในโรงพยาบาล"}</td>
                  <td className="space-x-1 whitespace-nowrap">
                    {t.active ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">เปิดใช้</span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">ยังไม่เปิดใช้</span>
                    )}
                    {waiting > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">รออนุมัติ {waiting}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
