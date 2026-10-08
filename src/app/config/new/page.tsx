import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { todayIso } from "@/lib/ranges";
import { BackLink } from "@/components/patient";
import { ActionForm } from "@/components/action-form";
import { createTest } from "../actions";

export default async function NewTestPage() {
  await requireRole("LAB");
  const outlabs = db.prepare("SELECT id, code, name FROM outlabs ORDER BY code").all() as { id: number; code: string; name: string }[];
  const today = todayIso();
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <BackLink href="/config">รายการตรวจทั้งหมด</BackLink>
      <div>
        <h1 className="text-2xl font-semibold">เพิ่มรายการตรวจใหม่</h1>
        <p className="text-sm text-slate-500">สร้างแล้วยังสั่งตรวจไม่ได้ จนกว่าผู้มีสิทธิ์จะอนุมัติค่าอ้างอิงชุดแรก</p>
      </div>
      <ActionForm action={createTest} className="card grid grid-cols-2 gap-3 sm:grid-cols-4">
        <h2 className="col-span-full font-semibold">ข้อมูลรายการตรวจ</h2>
        <F label="รหัส *" hint="ตัวอังกฤษ/ตัวเลข เช่น K, NA, HBSAG">
          <input name="code" required pattern="[A-Za-z0-9]{1,10}" className="input font-mono uppercase" />
        </F>
        <F label="ชื่อ *" wide>
          <input name="name" required className="input" placeholder="เช่น Potassium" />
        </F>
        <F label="LOINC">
          <input name="loinc" className="input font-mono" placeholder="2823-3" />
        </F>
        <F label="สิ่งส่งตรวจ *">
          <input name="specimen_type" required className="input" placeholder="Serum" />
        </F>
        <F label="หลอด *">
          <input name="container" required className="input" placeholder="Red top" />
        </F>
        <F label="หน่วย">
          <input name="unit" className="input" placeholder="mmol/L" />
        </F>
        <F label="ราคา (บาท) *">
          <input name="price" type="number" min={0} step="any" required className="input" />
        </F>
        <F label="ตรวจที่">
          <select name="outlab_id" defaultValue="" className="input">
            <option value="">ในโรงพยาบาล</option>
            {outlabs.map((o) => (
              <option key={o.id} value={o.id}>
                ส่ง {o.code}
              </option>
            ))}
          </select>
        </F>
        <F label="รหัส test ของ Outlab" hint="ถ้าส่ง Outlab">
          <input name="outlab_code" className="input font-mono" />
        </F>
        <F label="ต้นทุน Outlab (บาท)">
          <input name="outlab_cost" type="number" min={0} step="any" className="input" />
        </F>
        <F label="ได้ผลภายใน (วัน) *" hint="0 = ภายใน 2 ชั่วโมง">
          <input name="tat_days" type="number" min={0} max={60} defaultValue={0} required className="input" />
        </F>

        <h2 className="col-span-full border-t border-slate-100 pt-3 font-semibold">ค่าอ้างอิงชุดแรก (ทุกเพศ ทุกอายุ)</h2>
        <input type="hidden" name="sex" value="" />
        <input type="hidden" name="age_min" value="" />
        <input type="hidden" name="age_max" value="" />
        <F label="ค่าปกติต่ำสุด">
          <input name="ref_low" type="number" step="any" className="input" />
        </F>
        <F label="ค่าปกติสูงสุด">
          <input name="ref_high" type="number" step="any" className="input" />
        </F>
        <F label="วิกฤตเมื่อต่ำกว่า">
          <input name="crit_low" type="number" step="any" className="input border-red-200" />
        </F>
        <F label="วิกฤตเมื่อสูงกว่า">
          <input name="crit_high" type="number" step="any" className="input border-red-200" />
        </F>
        <F label="เริ่มใช้วันที่ *">
          <input name="effective_from" type="date" required min={today} defaultValue={today} className="input" />
        </F>
        <F label="เหตุผล / แหล่งอ้างอิง *" wide>
          <input name="reason" required minLength={5} className="input" placeholder="เช่น เปิดบริการตรวจใหม่ ค่าอ้างอิงตามคู่มือน้ำยา" />
        </F>
        <p className="col-span-full text-xs text-slate-500">ค่าแยกตามเพศ/อายุ เพิ่มได้ในหน้ารายการตรวจหลังสร้างแล้ว</p>
        <div className="col-span-full flex justify-end">
          <button className="btn">สร้างและส่งให้อนุมัติ</button>
        </div>
      </ActionForm>
    </div>
  );
}

function F({ label, hint, wide, children }: { label: string; hint?: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={`block ${wide ? "col-span-2" : ""}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}
