import { Check, CircleCheck, SearchX } from "lucide-react";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { SCHEME, age, queueNo } from "@/lib/labels";
import { todayVisits } from "@/lib/visits";
import { LiveSearch } from "@/components/client";
import { Avatar, TodayList, fullName } from "@/components/patient";
import { openVisit } from "./actions";
import { RegisterModal, OpenRegisterButton } from "./register-modal";

type Row = { id: number; hn: string; cid: string; prefix: string; first_name: string; last_name: string; dob: string; sex: string; phone: string | null };

// Front desk: search -> open visit in one place; right column = today's queue and where each patient is
export default async function PatientsPage({ searchParams }: PageProps<"/patients">) {
  const user = await requireRole();
  const sp = await searchParams;
  const q = String(sp.q ?? "").trim();
  const isClerk = user.role === "CLERK";

  // No search yet: list everyone, recent first (latest visit, then newest registration), 10 per page.
  // ponytail: LIKE scan + OFFSET paging, fine for thousands of rows; FTS5 / keyset paging when it gets slow
  const where = `WHERE ? = '' OR p.hn = ? OR p.cid = ? OR p.first_name || ' ' || p.last_name LIKE ? OR p.phone = ?`;
  const args = [q, q.toUpperCase(), q, `%${q}%`, q];
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM patients p ${where}`).get(...args) as { n: number }).n;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number(sp.page) || 1));
  const rows = db
    .prepare(
      `SELECT p.id, p.hn, p.cid, p.prefix, p.first_name, p.last_name, p.dob, p.sex, p.phone FROM patients p ${where}
       ORDER BY coalesce((SELECT max(v.id) FROM visits v WHERE v.patient_id = p.id), 0) DESC, p.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...args, PAGE_SIZE, (page - 1) * PAGE_SIZE) as Row[];
  const today = todayVisits();
  const visitToday = new Map(today.map((v) => [v.patient_id, v]));
  const opened = typeof sp.opened === "string" ? today.find((v) => v.vn === sp.opened) : undefined;
  const existed = typeof sp.existed === "string" ? today.find((v) => v.vn === sp.existed) : undefined;
  // pre-fill the registration form from what was typed
  // pre-fill the registration modal from what was typed: 13 digits -> CID, otherwise "first last"
  const isCid = /^\d{13}$/.test(q);
  const [first_name = "", ...rest] = isCid || !q ? [] : q.split(/\s+/);
  const regInitial: Record<string, string> = isCid ? { cid: q } : { first_name, last_name: rest.join(" ") };

  return (
    <div className="space-y-5">
      {opened && (
        <div className="animate-fade-up flex flex-wrap items-center gap-5 rounded-2xl border border-emerald-300 bg-emerald-50 p-5">
          <div className="animate-pop flex h-20 w-20 flex-col items-center justify-center rounded-2xl bg-emerald-600 text-white" style={{ animationDelay: "120ms" }}>
            <span className="text-xs">คิวที่</span>
            <span className="text-3xl font-bold leading-none">{queueNo(opened.vn)}</span>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-1.5 text-lg font-semibold text-emerald-900"><CircleCheck className="h-5 w-5" aria-hidden /> เปิด Visit ให้ {fullName(opened)} แล้ว</div>
            <div className="text-sm text-emerald-800">
              {opened.vn} · {SCHEME[opened.scheme]}
            </div>
            <div className="mt-2 text-sm text-slate-700">
              <b>ขั้นต่อไป:</b> แจ้งเลขคิวและให้ผู้ป่วยไปรอหน้าห้องตรวจ แพทย์จะเห็นชื่อในรายการ Visit วันนี้ทันที
            </div>
          </div>
        </div>
      )}
      {existed && (
        <p className="animate-fade-up rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {fullName(existed)} มี Visit วันนี้อยู่แล้ว (คิว {queueNo(existed.vn)} · {existed.vn}) ไม่ได้เปิดซ้ำ
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        {/* search & open visit */}
        <section className="space-y-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold">{isClerk ? "ค้นหาผู้ป่วย / เปิด Visit" : "ค้นหาผู้ป่วย"}</h1>
              <p className="text-sm text-slate-500">พิมพ์ HN, เลขบัตรประชาชน 13 หลัก, ชื่อ หรือเบอร์โทร ผลจะขึ้นทันที</p>
            </div>
            {isClerk && (
              <RegisterModal initial={regInitial} className="btn-ghost whitespace-nowrap">
                + ผู้ป่วยใหม่
              </RegisterModal>
            )}
          </div>
          <form className="card p-3">
            {/* new key after a visit is opened -> fresh empty box for the next patient (not keyed on q: that would steal focus while typing) */}
            <LiveSearch key={opened?.vn ?? existed?.vn ?? "search"} defaultValue={q} placeholder="เช่น HN0000001, 1100000000016, สมชาย" />
          </form>

          <p className="px-1 text-sm text-slate-500">
            {total === 0 ? "" : `${q ? `ผลการค้นหา “${q}”` : "ผู้ป่วยทั้งหมด (มาล่าสุดอยู่บน)"} · แสดง ${(page - 1) * PAGE_SIZE + 1}–${(page - 1) * PAGE_SIZE + rows.length} จาก ${total} คน`}
          </p>

          {q && rows.length === 0 && (
            <div className="card animate-fade-up space-y-3 text-center">
              <SearchX className="mx-auto h-10 w-10 text-slate-400" aria-hidden />
              <div className="font-medium">ไม่พบผู้ป่วย “{q}”</div>
              <p className="text-sm text-slate-500">ตรวจตัวสะกดอีกครั้ง ถ้าเป็นผู้ป่วยใหม่ให้ลงทะเบียน</p>
              {isClerk && (
                <OpenRegisterButton className="btn mx-auto">
                  ลงทะเบียนผู้ป่วยใหม่ {isCid ? "ด้วยเลขบัตรนี้" : q ? `ชื่อ “${q}”` : ""}
                </OpenRegisterButton>
              )}
            </div>
          )}

          <ul className="stagger space-y-3">
            {rows.map((p) => {
              const v = visitToday.get(p.id);
              return (
                <li key={p.id} className="card flex flex-wrap items-center gap-4 card-hover">
                  <Avatar name={p.first_name} sex={p.sex} />
                  <div className="min-w-48 flex-1">
                    <Link href={`/patients/${p.hn}`} className="text-lg font-semibold hover:text-teal-700">
                      {fullName(p)}
                    </Link>
                    <div className="text-sm text-slate-500">
                      <span className="font-mono text-slate-700">{p.hn}</span> · {p.sex === "M" ? "ชาย" : "หญิง"} {age(p.dob)} ปี ·{" "}
                      <span className="font-mono">{maskCid(p.cid)}</span>
                    </div>
                  </div>
                  {v ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-sm text-emerald-800"><Check className="h-4 w-4" aria-hidden /> มี Visit วันนี้ · คิว {queueNo(v.vn)}</span>
                  ) : isClerk ? (
                    <form action={openVisit} className="flex items-center gap-2">
                      <input type="hidden" name="patientId" value={p.id} />
                      <input type="hidden" name="back" value="list" />
                      <select name="scheme" aria-label="สิทธิการรักษา" className="input w-40">
                        {Object.entries(SCHEME).map(([k, label]) => (
                          <option key={k} value={k}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <button className="btn whitespace-nowrap">เปิด Visit</button>
                    </form>
                  ) : (
                    <Link href={`/patients/${p.hn}`} className="btn-ghost">
                      ดูข้อมูล →
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
          <Pager page={page} pages={pages} q={q} />
        </section>

        {/* today */}
        <aside className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">Visit วันนี้</h2>
            <span className="text-sm text-slate-500">{today.length} คน</span>
          </div>
          <TodayList visits={today} highlight={opened?.vn} action={user.role === "DOCTOR" ? "order" : undefined} />
        </aside>
      </div>
    </div>
  );
}

// PDPA: lists show a masked national ID; the full value only on the patient page
const maskCid = (c: string) => `${c.slice(0, 1)}-XXXX-XXXXX-${c.slice(10, 12)}-${c.slice(12)}`;

const PAGE_SIZE = 10;

// ‹ 1 2 3 … › links; keeps the search text, works without JS
function Pager({ page, pages, q }: { page: number; pages: number; q: string }) {
  if (pages <= 1) return null;
  const href = (p: number) => `/patients?${new URLSearchParams({ ...(q && { q }), ...(p > 1 && { page: String(p) }) })}`;
  // show first, last, and 2 around the current page
  const nums = [...new Set([1, page - 2, page - 1, page, page + 1, page + 2, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const base = "flex h-9 min-w-9 items-center justify-center rounded-md border px-3 text-sm";
  return (
    <nav aria-label="เลือกหน้า" className="flex flex-wrap items-center justify-center gap-1 pt-2">
      {page > 1 ? (
        <Link href={href(page - 1)} className={`${base} border-slate-300 bg-white hover:bg-slate-50`}>
          ‹ ก่อนหน้า
        </Link>
      ) : (
        <span className={`${base} border-slate-200 text-slate-300`}>‹ ก่อนหน้า</span>
      )}
      {nums.map((n, i) => (
        <span key={n} className="flex items-center gap-1">
          {i > 0 && n - nums[i - 1] > 1 && <span className="px-1 text-slate-400">…</span>}
          <Link
            href={href(n)}
            aria-current={n === page ? "page" : undefined}
            className={`${base} ${n === page ? "border-teal-600 bg-teal-600 font-semibold text-white" : "border-slate-300 bg-white hover:bg-slate-50"}`}
          >
            {n}
          </Link>
        </span>
      ))}
      {page < pages ? (
        <Link href={href(page + 1)} className={`${base} border-slate-300 bg-white hover:bg-slate-50`}>
          ถัดไป ›
        </Link>
      ) : (
        <span className={`${base} border-slate-200 text-slate-300`}>ถัดไป ›</span>
      )}
    </nav>
  );
}
