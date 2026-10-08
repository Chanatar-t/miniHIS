import { CircleCheck, TriangleAlert } from "lucide-react";
import { db } from "@/lib/db";
import { thDate } from "@/lib/labels";
import { addAllergy, markNoAllergy, removeAllergy } from "./actions";

type Allergy = { id: number; drug: string; reaction: string | null; created_at: string; by: string };

// Drug allergy: red when there is one, so nobody misses it. Three states on purpose:
// allergic / asked and none (NKDA) / never asked -- "nothing on file" must not read as "safe".
export function Allergies({ patientId, back, editable }: { patientId: number; back: string; editable: boolean }) {
  const list = db
    .prepare(
      `SELECT a.id, a.drug, a.reaction, a.created_at, u.name AS by FROM allergies a JOIN users u ON u.id = a.recorded_by
       WHERE a.patient_id = ? AND a.removed_at IS NULL ORDER BY a.id`,
    )
    .all(patientId) as Allergy[];
  const nkda = (db.prepare("SELECT nkda_at FROM patients WHERE id = ?").get(patientId) as { nkda_at: string | null }).nkda_at;

  return (
    <section
      aria-label="ประวัติแพ้ยา"
      className={`rounded-xl border p-4 ${list.length ? "border-red-300 bg-red-50" : nkda ? "border-emerald-200 bg-emerald-50/60" : "border-amber-200 bg-amber-50"}`}
    >
      {list.length ? (
        <div className="space-y-2">
          <h2 className="flex items-center gap-2 font-semibold text-red-800">
            <TriangleAlert className="h-5 w-5" aria-hidden /> แพ้ยา {list.length} รายการ
          </h2>
          <ul className="space-y-1">
            {list.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <b className="text-red-800">{a.drug}</b>
                {a.reaction && <span className="text-red-700">อาการ: {a.reaction}</span>}
                <span className="text-xs text-slate-500">
                  {a.by} · {thDate(a.created_at, false)}
                </span>
                {editable && (
                  <form action={removeAllergy} className="ml-auto">
                    <input type="hidden" name="allergyId" value={a.id} />
                    <input type="hidden" name="back" value={back} />
                    <button className="text-xs text-slate-500 underline hover:text-red-700">ลบ (บันทึกผิด)</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : nkda ? (
        <p className="flex items-center gap-2 text-sm text-emerald-800">
          <CircleCheck className="h-4 w-4" aria-hidden /> ปฏิเสธการแพ้ยา (ถามเมื่อ {thDate(nkda)})
        </p>
      ) : (
        <p className="flex items-center gap-2 text-sm text-amber-900">
          <TriangleAlert className="h-4 w-4" aria-hidden /> ยังไม่ได้ซักประวัติแพ้ยา ถามผู้ป่วยก่อนสั่งยาทุกครั้ง
        </p>
      )}

      {editable && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-black/5 pt-3">
          <form action={addAllergy} className="flex flex-1 flex-wrap items-end gap-2">
            <input type="hidden" name="patientId" value={patientId} />
            <input type="hidden" name="back" value={back} />
            <label className="min-w-36 flex-1 text-xs text-slate-600">
              ชื่อยาที่แพ้
              <input name="drug" required maxLength={100} className="input mt-1" placeholder="เช่น Penicillin" />
            </label>
            <label className="min-w-36 flex-1 text-xs text-slate-600">
              อาการ (ถ้าทราบ)
              <input name="reaction" maxLength={200} className="input mt-1" placeholder="เช่น ผื่น ปากบวม" />
            </label>
            <button className="btn-ghost whitespace-nowrap">+ เพิ่มยาที่แพ้</button>
          </form>
          {!list.length && !nkda && (
            <form action={markNoAllergy}>
              <input type="hidden" name="patientId" value={patientId} />
              <input type="hidden" name="back" value={back} />
              <button className="btn-ghost whitespace-nowrap">ผู้ป่วยปฏิเสธการแพ้ยา</button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
