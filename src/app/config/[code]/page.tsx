import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { FLAG, age, thDate } from "@/lib/labels";
import { flagResult } from "@/lib/rules";
import { todayIso } from "@/lib/ranges";
import { Flash } from "@/components/flash";
import { BackLink } from "@/components/patient";
import { ActionForm } from "@/components/action-form";
import { proposeRange, reviewRange } from "../actions";
import { RangeValues, scopeKey, scopeLabel, versionState, type RangeFull } from "../shared";

type Test = {
  id: number; code: string; name: string; loinc: string | null; specimen_type: string; container: string; unit: string | null;
  price: number; tat_days: number; active: number; outlab: string | null; outlab_code: string | null;
};

// "If this range had been in force, how many of the last year's reported results would carry a different flag?"
function impact(r: RangeFull) {
  const rows = db
    .prepare(
      `SELECT i.value, i.flag, p.sex, p.dob FROM lab_order_items i
       JOIN lab_orders o ON o.id = i.order_id JOIN visits v ON v.id = o.visit_id JOIN patients p ON p.id = v.patient_id
       WHERE i.test_id = ? AND i.status = 'VERIFIED' AND i.verified_at >= datetime('now','localtime','-365 days')`,
    )
    .all(r.test_id) as { value: string; flag: string | null; sex: string; dob: string }[];
  const inScope = rows.filter((x) => (r.sex == null || r.sex === x.sex) && (r.age_min == null || age(x.dob) >= r.age_min) && (r.age_max == null || age(x.dob) <= r.age_max));
  const changes = new Map<string, number>();
  for (const x of inScope) {
    const now = flagResult(x.value, r) ?? "-";
    const before = x.flag ?? "-";
    if (now !== before) changes.set(`${before}→${now}`, (changes.get(`${before}→${now}`) ?? 0) + 1);
  }
  return { checked: inScope.length, changed: [...changes.values()].reduce((a, b) => a + b, 0), changes: [...changes] };
}

const flagName = (f: string) => (f === "-" ? "ไม่มีธง" : f === "N" ? "ปกติ" : FLAG[f]?.label ?? f);

export default async function TestConfigPage({ params, searchParams }: PageProps<"/config/[code]">) {
  const user = await requireRole("LAB");
  const { code } = await params;
  const t = db
    .prepare(
      `SELECT t.id, t.code, t.name, t.loinc, t.specimen_type, t.container, t.unit, t.price, t.tat_days, t.active, ol.code AS outlab, t.outlab_code
       FROM lab_tests t LEFT JOIN outlabs ol ON ol.id = t.outlab_id WHERE t.code = ?`,
    )
    .get(code) as Test | undefined;
  if (!t) notFound();
  const all = db
    .prepare(
      `SELECT r.*, pu.name AS proposer, ru.name AS reviewer FROM test_ranges r
       LEFT JOIN users pu ON pu.id = r.proposed_by LEFT JOIN users ru ON ru.id = r.reviewed_by
       WHERE r.test_id = ? ORDER BY r.id DESC`,
    )
    .all(t.id) as RangeFull[];
  const today = todayIso();
  const current = all.filter((r) => versionState(r, all, today).label === "ใช้อยู่").sort((a, b) => scopeKey(a).localeCompare(scopeKey(b)));
  const pending = all.filter((r) => r.status === "PENDING");
  const base = current.find((r) => r.sex == null && r.age_min == null && r.age_max == null) ?? current[0];

  return (
    <div className="space-y-5">
      <BackLink href="/config">รายการตรวจทั้งหมด</BackLink>
      <header className="card flex flex-wrap items-start gap-x-8 gap-y-2">
        <div>
          <h1 className="text-2xl font-semibold">
            <span className="font-mono">{t.code}</span> {t.name}
          </h1>
          <div className="text-sm text-slate-500">
            {t.specimen_type} · {t.container} · หน่วย {t.unit ?? "-"} · {t.outlab ? `ส่ง ${t.outlab} (${t.outlab_code})` : "ตรวจในโรงพยาบาล"} · TAT {t.tat_days} วัน ·{" "}
            {t.price.toLocaleString()} บาท {t.loinc && `· LOINC ${t.loinc}`}
          </div>
        </div>
        <span className={`ml-auto rounded-full px-3 py-1 text-sm ${t.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
          {t.active ? "เปิดให้สั่งตรวจ" : "ยังไม่เปิดใช้ (รออนุมัติค่าอ้างอิงชุดแรก)"}
        </span>
      </header>
      <Flash sp={await searchParams} />

      <section className="card space-y-2">
        <h2 className="font-semibold">ค่าที่ใช้อยู่วันนี้</h2>
        {current.length === 0 && <p className="text-sm text-slate-500">ยังไม่มีค่าที่อนุมัติ ผลของ test นี้จะไม่มีธง</p>}
        <ul className="divide-y divide-slate-100">
          {current.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 py-2 text-sm">
              <span className="w-44 text-slate-600">{scopeLabel(r)}</span>
              <RangeValues r={r} />
              <span className="text-xs text-slate-500">ตั้งแต่ {thDate(r.effective_from, false)}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-slate-500">ถ้ามีหลายชุด ระบบเลือกชุดที่ตรงกับผู้ป่วยมากที่สุด: แยกเพศ ก่อน แยกอายุ ก่อน ทุกเพศ/ทุกอายุ</p>
      </section>

      {pending.length > 0 && (
        <section id="pending" className="space-y-3">
          <h2 className="font-semibold">ข้อเสนอรออนุมัติ ({pending.length})</h2>
          {pending.map((r) => {
            const im = impact(r);
            const own = r.proposed_by === user.id;
            return (
              <article key={r.id} id={`range-${r.id}`} className="card scroll-mt-6 space-y-3 border-amber-300">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">รออนุมัติ</span>
                  <span className="text-sm text-slate-600">{scopeLabel(r)}</span>
                  <RangeValues r={r} />
                  <span className="text-sm">เริ่มใช้ {thDate(r.effective_from, false)}</span>
                </div>
                <p className="text-sm">
                  <span className="text-slate-500">เหตุผล:</span> {r.reason}
                  <span className="ml-2 text-xs text-slate-500">
                    — {r.proposer} · {thDate(r.proposed_at)}
                  </span>
                </p>
                <div className="rounded-lg bg-slate-50 p-3 text-sm">
                  <div className="font-medium">ผลกระทบ (ผลที่รายงานใน 1 ปีที่ผ่านมา ในกลุ่มผู้ป่วยเดียวกัน)</div>
                  {im.checked === 0 ? (
                    <p className="text-slate-500">ยังไม่มีผลย้อนหลังให้เทียบ</p>
                  ) : im.changed === 0 ? (
                    <p className="text-emerald-700">ตรวจ {im.checked} ผล · ไม่มีผลใดเปลี่ยนธง</p>
                  ) : (
                    <p>
                      ตรวจ {im.checked} ผล · <b className="text-amber-800">ธงเปลี่ยน {im.changed} ผล</b>{" "}
                      {im.changes.map(([k, n]) => {
                        const [a, b] = k.split("→");
                        return (
                          <span key={k} className="ml-2 inline-block rounded bg-white px-1.5 py-0.5 text-xs ring-1 ring-slate-200">
                            {flagName(a)} → {flagName(b)}: {n}
                          </span>
                        );
                      })}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-slate-500">ผลที่รายงานไปแล้วจะไม่ถูกเปลี่ยน ตัวเลขนี้ใช้ประกอบการตัดสินใจเท่านั้น</p>
                </div>
                {user.canApprove && !own ? (
                  <form action={reviewRange} className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                    <input type="hidden" name="code" value={t.code} />
                    <input type="hidden" name="rangeId" value={r.id} />
                    <input name="note" placeholder="หมายเหตุ (บังคับเมื่อไม่อนุมัติ)" className="input min-w-60 flex-1" />
                    <button name="decision" value="REJECTED" className="btn-ghost text-red-700">
                      ไม่อนุมัติ
                    </button>
                    <button name="decision" value="APPROVED" className="btn">
                      อนุมัติ
                    </button>
                  </form>
                ) : (
                  <p className="border-t border-slate-100 pt-3 text-sm text-slate-500">
                    {own ? "คุณเป็นผู้เสนอ ต้องให้ผู้มีสิทธิ์คนอื่นอนุมัติ" : "รอผู้มีสิทธิ์อนุมัติ (พยาธิแพทย์)"}
                  </p>
                )}
              </article>
            );
          })}
        </section>
      )}

      <section className="card space-y-3">
        <div>
          <h2 className="font-semibold">เสนอค่าอ้างอิงใหม่</h2>
          <p className="text-xs text-slate-500">ยังไม่มีผลกับผู้ป่วยจนกว่าจะได้รับอนุมัติ เว้นว่างได้ถ้าไม่มีขอบเขตด้านนั้น (เช่น PSA มีแค่ค่าสูงสุด)</p>
        </div>
        <ActionForm action={proposeRange} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <input type="hidden" name="code" value={t.code} />
          <Field label="เพศ">
            <select name="sex" defaultValue="" className="input">
              <option value="">ทุกเพศ</option>
              <option value="M">ชาย</option>
              <option value="F">หญิง</option>
            </select>
          </Field>
          <Field label="อายุตั้งแต่ (ปี)">
            <input name="age_min" type="number" min={0} max={130} className="input" placeholder="ไม่จำกัด" />
          </Field>
          <Field label="อายุถึง (ปี)">
            <input name="age_max" type="number" min={0} max={130} className="input" placeholder="ไม่จำกัด" />
          </Field>
          <Field label="เริ่มใช้วันที่ *">
            <input name="effective_from" type="date" required min={today} defaultValue={today} className="input" />
          </Field>
          <Field label={`ค่าปกติต่ำสุด ${t.unit ? `(${t.unit})` : ""}`}>
            <input name="ref_low" type="number" step="any" defaultValue={base?.ref_low ?? ""} className="input" />
          </Field>
          <Field label="ค่าปกติสูงสุด">
            <input name="ref_high" type="number" step="any" defaultValue={base?.ref_high ?? ""} className="input" />
          </Field>
          <Field label="วิกฤตเมื่อต่ำกว่า">
            <input name="crit_low" type="number" step="any" defaultValue={base?.crit_low ?? ""} className="input border-red-200" />
          </Field>
          <Field label="วิกฤตเมื่อสูงกว่า">
            <input name="crit_high" type="number" step="any" defaultValue={base?.crit_high ?? ""} className="input border-red-200" />
          </Field>
          <div className="col-span-full">
            <Field label="เหตุผล / แหล่งอ้างอิง *">
              <textarea name="reason" required minLength={5} rows={2} className="input" placeholder="เช่น ปรับตาม guideline ปี 2026 / เปลี่ยนน้ำยาล็อตใหม่ / ย้ายไปเครื่องตรวจรุ่นใหม่" />
            </Field>
          </div>
          <div className="col-span-full flex justify-end">
            <button className="btn">ส่งให้อนุมัติ</button>
          </div>
        </ActionForm>
      </section>

      <section className="card p-0">
        <h2 className="px-4 pt-4 font-semibold">ประวัติทุกเวอร์ชัน</h2>
        <div className="overflow-x-auto">
          <table className="table min-w-[860px]">
            <thead>
              <tr>
                <th>สถานะ</th>
                <th>กลุ่มผู้ป่วย</th>
                <th>ค่า</th>
                <th>เริ่มใช้</th>
                <th>เหตุผล</th>
                <th>เสนอ / พิจารณา</th>
              </tr>
            </thead>
            <tbody>
              {all.map((r) => {
                const s = versionState(r, all, today);
                return (
                  <tr key={r.id}>
                    <td>
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${s.cls}`}>{s.label}</span>
                    </td>
                    <td className="text-xs">{scopeLabel(r)}</td>
                    <td className="text-xs">
                      <RangeValues r={r} />
                    </td>
                    <td className="whitespace-nowrap text-xs">{thDate(r.effective_from, false)}</td>
                    <td className="text-xs text-slate-600">{r.reason}</td>
                    <td className="text-xs text-slate-500">
                      {r.proposer} · {thDate(r.proposed_at)}
                      {r.reviewer && (
                        <div>
                          {r.status === "APPROVED" ? "อนุมัติ" : "ไม่อนุมัติ"}: {r.reviewer} · {r.reviewed_at && thDate(r.reviewed_at)}
                          {r.review_note && ` · “${r.review_note}”`}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
