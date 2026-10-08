"use client";
import { Check, Dices } from "lucide-react";

import { startTransition, useActionState, useState } from "react";
import { cidCheckDigit, isValidCid } from "@/lib/rules";
import { createPatient, type FormState } from "../actions";

// a valid-format test ID; starts with 9, which no seeded patient uses, so it will not hit "already registered"
const FEMALE_PREFIX = ["นาง", "นางสาว", "ด.ญ."];

const randomCid = () => {
  const first12 = "9" + Array.from({ length: 11 }, () => Math.floor(Math.random() * 10)).join("");
  return first12 + cidCheckDigit(first12);
};

// Used on /patients/new and inside the registration modal (bare + onCancel)
export function PatientForm({ initial = {}, bare, onCancel }: { initial?: Record<string, string>; bare?: boolean; onCancel?: () => void }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createPatient, {});
  // All fields controlled: React resets a form after every action, which silently flipped the selects back
  // to their first option after a server error. Controlled state survives that, and lets us validate as you type.
  const [v, setV] = useState({
    cid: initial.cid ?? "", prefix: "นาย", sex: "M", first_name: initial.first_name ?? "", last_name: initial.last_name ?? "", dob: "", phone: "",
  });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const setCid = (cid: string) => setV((s) => ({ ...s, cid }));
  const cid = v.cid;
  const cidState = cid.length < 13 ? "typing" : isValidCid(cid) ? "ok" : "bad";
  const field = (id: string, label: string, input: React.ReactNode, wide = false) => (
    <div className={wide ? "col-span-2" : ""}>
      <label htmlFor={`reg-${id}`} className="label">
        {label}
      </label>
      {input}
    </div>
  );

  return (
    <form
      action={action} // no-JS fallback
      // With JS, submit ourselves: React's automatic form reset after an action runs native form.reset(),
      // which snaps controlled <select>s back to their first option while React still holds the old value.
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      className={`grid grid-cols-2 gap-4 ${bare ? "" : "card"}`}
    >
      <div className="col-span-2">
        <div className="flex items-baseline justify-between">
          <label htmlFor="reg-cid" className="label">
            เลขบัตรประชาชน *
          </label>
          {/* demo / UAT helper: real IDs have a check digit, random typing fails ~9 in 10 */}
          <button type="button" onClick={() => setCid(randomCid())} className="text-xs text-teal-700 hover:underline">
            <Dices className="mr-1 inline h-3.5 w-3.5" aria-hidden />สุ่มเลขทดสอบ
          </button>
        </div>
        <input
          id="reg-cid"
          name="cid"
          value={cid}
          onChange={(e) => setCid(e.target.value.replace(/\D/g, ""))}
          required
          autoFocus
          inputMode="numeric"
          maxLength={13}
          pattern="\d{13}"
          title="ตัวเลข 13 หลัก"
          aria-describedby="reg-cid-hint"
          className={`input font-mono ${cidState === "bad" ? "border-red-400" : cidState === "ok" ? "border-emerald-400" : ""}`}
        />
        <p id="reg-cid-hint" className={`mt-1 text-xs ${cidState === "bad" ? "text-red-600" : "text-slate-500"}`}>
          {cidState === "bad"
            ? "หลักสุดท้ายไม่ตรงกับเลขตรวจสอบ ตรวจกับบัตรอีกครั้ง"
            : cidState === "ok"
              ? <><Check className="mr-0.5 inline h-3.5 w-3.5 text-emerald-600" aria-hidden />รูปแบบเลขบัตรถูกต้อง</>
              : `${cid.length}/13 หลัก · หลักที่ 13 เป็นเลขตรวจสอบ ระบบตรวจให้อัตโนมัติ`}
        </p>
      </div>
      {field(
        "prefix",
        "คำนำหน้า *",
        <select
          id="reg-prefix"
          name="prefix"
          value={v.prefix}
          // the prefix implies the sex in almost every case; pre-select it, still editable
          onChange={(e) => setV((s) => ({ ...s, prefix: e.target.value, sex: FEMALE_PREFIX.includes(e.target.value) ? "F" : "M" }))}
          className="input"
        >
          {["นาย", "นาง", "นางสาว", "ด.ช.", "ด.ญ."].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>,
      )}
      {field(
        "sex",
        "เพศ *",
        <select id="reg-sex" name="sex" value={v.sex} onChange={set("sex")} className="input">
          <option value="M">ชาย</option>
          <option value="F">หญิง</option>
        </select>,
      )}
      {field("first", "ชื่อ *", <input id="reg-first" name="first_name" value={v.first_name} onChange={set("first_name")} required className="input" />)}
      {field("last", "นามสกุล *", <input id="reg-last" name="last_name" value={v.last_name} onChange={set("last_name")} required className="input" />)}
      {field("dob", "วันเกิด *", <input id="reg-dob" name="dob" type="date" value={v.dob} onChange={set("dob")} required max={new Date().toLocaleDateString("sv-SE")} className="input" />)}
      {field("phone", "เบอร์โทร", <input id="reg-phone" name="phone" value={v.phone} onChange={set("phone")} inputMode="tel" className="input" />)}
      {state.error && (
        <p role="alert" className="col-span-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
      <div className="col-span-2 flex justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn-ghost">
            ยกเลิก
          </button>
        )}
        <button disabled={pending} className="btn px-5">
          {pending ? "กำลังบันทึก…" : "บันทึก"}
        </button>
      </div>
    </form>
  );
}
