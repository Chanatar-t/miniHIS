"use client";
import { X } from "lucide-react";
import { startTransition, useActionState, useRef, useState } from "react";
import { VITAL_FIELDS, bmi, bmiLabel, vitalsErrors, type VitalKey } from "@/lib/rules";
import { saveVitals, type VitalsState } from "../actions";

type Values = Record<VitalKey | "cc", string>;

// Screening in a dialog over the patient page (allergy box stays right behind it).
// Typed values are never lost: errors don't clear the form, closing keeps it, only a successful save leaves.
export function VitalsModal({ vn, label, initial, prev, note }: { vn: string; label: string; initial: Values; prev: Partial<Values>; note: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [v, setV] = useState(initial);
  const [tried, setTried] = useState(false); // after a save attempt, also nag about half-filled BP
  const [state, action, pending] = useActionState<VitalsState, FormData>(saveVitals, {});
  const errors = vitalsErrors(v, tried);
  const b = bmi(Number(v.weight) || null, Number(v.height) || null);

  // what to say under a field: error (red) > outside normal (amber) > normal range + last time (grey)
  const hint = (f: (typeof VITAL_FIELDS)[number]) => {
    const err = errors[f.key];
    if (err) return { cls: "text-red-600", text: err };
    const n = Number(v[f.key]);
    if (v[f.key].trim() && f.normal && (n < f.normal[0] || n > f.normal[1]))
      return { cls: "text-amber-700", text: `${n > f.normal[1] ? "สูง" : "ต่ำ"}กว่าปกติ (${f.hint})` };
    return { cls: "text-slate-500", text: `${f.hint}${prev[f.key] ? ` · ครั้งก่อน ${prev[f.key]}` : ""}` };
  };

  return (
    <>
      <button type="button" onClick={() => dialog.current?.showModal()} className="btn px-4 py-2">
        {label}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="vitals-title"
        className="m-auto w-[min(44rem,calc(100vw-2rem))] rounded-2xl bg-transparent p-0 backdrop:bg-slate-900/50 backdrop:backdrop-blur-sm"
      >
        <form
          action={action} // no-JS fallback
          noValidate // our hints explain the problem; the browser's bubble would just block
          onSubmit={(e) => {
            e.preventDefault();
            setTried(true);
            if (Object.keys(vitalsErrors(v, true)).length) return;
            const data = new FormData(e.currentTarget);
            startTransition(() => action(data));
          }}
          className="rounded-2xl bg-white shadow-2xl"
        >
          <input type="hidden" name="vn" value={vn} />
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h2 id="vitals-title" className="text-lg font-semibold">
                ซักประวัติ · สัญญาณชีพ
              </h2>
              <p className="text-xs text-slate-500">{note}</p>
            </div>
            <button type="button" onClick={() => dialog.current?.close()} aria-label="ปิด" className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100">
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>

          <div className="space-y-4 p-5">
            <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4">
              {VITAL_FIELDS.map((f) => {
                const h = hint(f);
                return (
                  <div key={f.key}>
                    <label htmlFor={`vs-${f.key}`} className="text-sm text-slate-600">
                      {f.label} <span className="text-xs text-slate-400">({f.unit})</span>
                    </label>
                    <input
                      id={`vs-${f.key}`}
                      name={f.key}
                      type="number"
                      inputMode="decimal"
                      step={f.step}
                      value={v[f.key]}
                      onChange={(e) => setV((s) => ({ ...s, [f.key]: e.target.value }))}
                      placeholder={prev[f.key] ?? ""}
                      aria-invalid={!!errors[f.key]}
                      aria-describedby={`vs-${f.key}-hint`}
                      className={`input mt-1 ${errors[f.key] ? "border-red-400 bg-red-50" : ""}`}
                    />
                    <p id={`vs-${f.key}-hint`} className={`mt-1 text-xs leading-snug ${h.cls}`}>
                      {h.text}
                    </p>
                  </div>
                );
              })}
            </div>
            <p className="text-sm text-slate-600">
              BMI: {b === null ? <span className="text-slate-400">กรอกน้ำหนักและส่วนสูงแล้วคำนวณให้</span> : <b>{b} ({bmiLabel(b)})</b>}
            </p>
            <div>
              <label htmlFor="vs-cc" className="text-sm text-slate-600">
                อาการสำคัญที่มา (CC)
              </label>
              <textarea
                id="vs-cc"
                name="cc"
                rows={2}
                maxLength={500}
                value={v.cc}
                onChange={(e) => setV((s) => ({ ...s, cc: e.target.value }))}
                className="input mt-1"
                placeholder="เช่น ไข้ ไอ 3 วัน"
              />
            </div>
            {(state.error || (tried && Object.keys(errors).length > 0)) && (
              <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {state.error ?? "มีช่องที่ต้องแก้ ดูข้อความสีแดงใต้ช่อง"}
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              <span className="mr-auto text-xs text-slate-400">ช่องไหนไม่ได้วัดเว้นว่างได้ · ปิดหน้าต่างแล้วข้อมูลที่กรอกยังอยู่</span>
              <button type="button" onClick={() => dialog.current?.close()} className="btn-ghost">
                ปิด
              </button>
              <button disabled={pending} className="btn px-5">
                {pending ? "กำลังบันทึก…" : "บันทึก ส่งพบแพทย์"}
              </button>
            </div>
          </div>
        </form>
      </dialog>
    </>
  );
}
