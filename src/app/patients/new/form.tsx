"use client";

import { useActionState } from "react";
import { createPatient, type FormState } from "../actions";

// Used on /patients/new and inside the registration modal (bare + onCancel)
export function PatientForm({ initial = {}, bare, onCancel }: { initial?: Record<string, string>; bare?: boolean; onCancel?: () => void }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createPatient, {});
  const f = state.fields ?? initial;
  const field = (id: string, label: string, input: React.ReactNode, wide = false) => (
    <div className={wide ? "col-span-2" : ""}>
      <label htmlFor={`reg-${id}`} className="label">
        {label}
      </label>
      {input}
    </div>
  );

  return (
    <form action={action} className={`grid grid-cols-2 gap-4 ${bare ? "" : "card"}`}>
      {field(
        "cid",
        "เลขบัตรประชาชน *",
        <input id="reg-cid" name="cid" defaultValue={f.cid} required autoFocus inputMode="numeric" maxLength={13} pattern="\d{13}" title="ตัวเลข 13 หลัก" className="input font-mono" />,
        true,
      )}
      {field(
        "prefix",
        "คำนำหน้า *",
        <select id="reg-prefix" name="prefix" defaultValue={f.prefix} className="input">
          {["นาย", "นาง", "นางสาว", "ด.ช.", "ด.ญ."].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>,
      )}
      {field(
        "sex",
        "เพศ *",
        <select id="reg-sex" name="sex" defaultValue={f.sex} className="input">
          <option value="M">ชาย</option>
          <option value="F">หญิง</option>
        </select>,
      )}
      {field("first", "ชื่อ *", <input id="reg-first" name="first_name" defaultValue={f.first_name} required className="input" />)}
      {field("last", "นามสกุล *", <input id="reg-last" name="last_name" defaultValue={f.last_name} required className="input" />)}
      {field("dob", "วันเกิด *", <input id="reg-dob" name="dob" type="date" defaultValue={f.dob} required className="input" />)}
      {field("phone", "เบอร์โทร", <input id="reg-phone" name="phone" defaultValue={f.phone} inputMode="tel" className="input" />)}
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
