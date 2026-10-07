"use client";

import { useActionState } from "react";
import { createPatient, type FormState } from "../actions";

export function PatientForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createPatient, {});
  const f = state.fields ?? {};

  return (
    <form action={action} className="card grid grid-cols-2 gap-4">
      <div className="col-span-2">
        <label className="label">เลขบัตรประชาชน *</label>
        <input name="cid" defaultValue={f.cid} required inputMode="numeric" maxLength={13} pattern="\d{13}" className="input font-mono" />
      </div>
      <div>
        <label className="label">คำนำหน้า *</label>
        <select name="prefix" defaultValue={f.prefix} className="input">
          {["นาย", "นาง", "นางสาว", "ด.ช.", "ด.ญ."].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">เพศ *</label>
        <select name="sex" defaultValue={f.sex} className="input">
          <option value="M">ชาย</option>
          <option value="F">หญิง</option>
        </select>
      </div>
      <div>
        <label className="label">ชื่อ *</label>
        <input name="first_name" defaultValue={f.first_name} required className="input" />
      </div>
      <div>
        <label className="label">นามสกุล *</label>
        <input name="last_name" defaultValue={f.last_name} required className="input" />
      </div>
      <div>
        <label className="label">วันเกิด *</label>
        <input name="dob" type="date" defaultValue={f.dob} required className="input" />
      </div>
      <div>
        <label className="label">เบอร์โทร</label>
        <input name="phone" defaultValue={f.phone} inputMode="tel" className="input" />
      </div>
      {state.error && <p className="col-span-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <div className="col-span-2">
        <button disabled={pending} className="btn">
          {pending ? "กำลังบันทึก…" : "บันทึก"}
        </button>
      </div>
    </form>
  );
}
