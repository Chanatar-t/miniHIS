"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { db, tx, audit, newHn, newVn } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { VITAL_FIELDS, isValidCid, vitalsErrors, type VitalKey } from "@/lib/rules";
import { fail, withFlash } from "@/lib/flash";

export type FormState = { error?: string; fields?: Record<string, string> };

const PatientInput = z.object({
  cid: z
    .string()
    .trim()
    .refine(
      isValidCid,
      "เลขบัตรประชาชนไม่ถูกต้อง: หลักสุดท้ายเป็นเลขตรวจสอบที่คำนวณจาก 12 หลักแรก และไม่ตรงกัน อาจพิมพ์ผิดหรือสลับหลัก กรุณาตรวจกับบัตรอีกครั้ง",
    ),
  prefix: z.enum(["นาย", "นาง", "นางสาว", "ด.ช.", "ด.ญ."]),
  first_name: z.string().trim().min(1, "กรอกชื่อ"),
  last_name: z.string().trim().min(1, "กรอกนามสกุล"),
  dob: z.iso.date("วันเกิดไม่ถูกต้อง").refine((d) => d <= new Date().toISOString().slice(0, 10), "วันเกิดอยู่ในอนาคต"),
  sex: z.enum(["M", "F"]),
  phone: z.string().trim().regex(/^0\d{8,9}$/, "เบอร์โทรไม่ถูกต้อง").or(z.literal("")),
});

export async function createPatient(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireRole("CLERK");
  const fields = Object.fromEntries(formData) as Record<string, string>;
  const parsed = PatientInput.safeParse(fields);
  if (!parsed.success) return { error: parsed.error.issues[0].message, fields };
  const p = parsed.data;

  const dup = db.prepare("SELECT hn FROM patients WHERE cid = ?").get(p.cid) as { hn: string } | undefined;
  if (dup) return { error: `เลขบัตรนี้ลงทะเบียนแล้ว: ${dup.hn}`, fields };

  const hn = tx(db, () => {
    const hn = newHn(db);
    const { lastInsertRowid } = db
      .prepare(
        "INSERT INTO patients(hn, cid, prefix, first_name, last_name, dob, sex, phone) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(hn, p.cid, p.prefix, p.first_name, p.last_name, p.dob, p.sex, p.phone || null);
    audit(db, user.id, "CREATE", "patient", lastInsertRowid);
    return hn;
  });
  redirect(`/patients/${hn}?registered=1`);
}

const VisitInput = z.object({
  patientId: z.coerce.number().int().positive(),
  scheme: z.enum(["UC", "SSS", "CSMBS", "SELF"]),
});

// Opened from the search list (back=list) or the patient page; returns there with ?opened=VN for the success banner.
export async function openVisit(formData: FormData) {
  const user = await requireRole("CLERK");
  const v = VisitInput.parse(Object.fromEntries(formData));
  const r = tx(db, () => {
    const p = db.prepare("SELECT hn FROM patients WHERE id = ?").get(v.patientId) as { hn: string } | undefined;
    if (!p) throw new Error("Patient not found");
    // one visit per patient per day: a second click / second clerk must not create a second queue number
    const today = db
      .prepare("SELECT vn FROM visits WHERE patient_id = ? AND date(created_at) = date('now','localtime')")
      .get(v.patientId) as { vn: string } | undefined;
    if (today) return { hn: p.hn, vn: today.vn, existed: true };
    const vn = newVn(db);
    const { lastInsertRowid } = db.prepare("INSERT INTO visits(vn, patient_id, scheme) VALUES (?, ?, ?)").run(vn, v.patientId, v.scheme);
    audit(db, user.id, "CREATE", "visit", lastInsertRowid, vn);
    return { hn: p.hn, vn, existed: false };
  });
  const base = formData.get("back") === "list" ? "/patients" : `/patients/${r.hn}`;
  redirect(`${base}?${new URLSearchParams(r.existed ? { existed: r.vn } : { opened: r.vn })}`);
}

// Allergy forms sit on the patient page; go back there (validated: never an open redirect)
const backTo = (formData: FormData) => {
  const b = String(formData.get("back") ?? "");
  return /^\/patients\/HN\d+$/.test(b) ? b : "/patients";
};
const AllergyInput = z.object({
  patientId: z.coerce.number().int().positive(),
  drug: z.string().trim().min(1, "กรอกชื่อยาที่แพ้").max(100),
  reaction: z.string().trim().max(200),
});

export async function addAllergy(formData: FormData) {
  await withFlash(backTo(formData), async () => {
    const user = await requireRole("NURSE", "DOCTOR");
    const a = AllergyInput.safeParse(Object.fromEntries(formData));
    if (!a.success) fail(a.error.issues[0].message);
    const { patientId, drug, reaction } = a.data;
    return tx(db, () => {
      if (!db.prepare("SELECT 1 FROM patients WHERE id = ?").get(patientId)) fail("ไม่พบผู้ป่วย");
      if (db.prepare("SELECT 1 FROM allergies WHERE patient_id = ? AND removed_at IS NULL AND lower(drug) = lower(?)").get(patientId, drug))
        fail(`มีประวัติแพ้ ${drug} อยู่แล้ว`);
      const { lastInsertRowid } = db
        .prepare("INSERT INTO allergies(patient_id, drug, reaction, recorded_by) VALUES (?, ?, ?, ?)")
        .run(patientId, drug, reaction || null, user.id);
      db.prepare("UPDATE patients SET nkda_at = NULL WHERE id = ?").run(patientId); // an allergy overrides "no known allergy"
      audit(db, user.id, "CREATE", "allergy", lastInsertRowid, drug);
      return `บันทึกแพ้ยา ${drug} แล้ว`;
    });
  });
}

// Wrong entry: hide it, keep the row (who recorded it, who removed it)
export async function removeAllergy(formData: FormData) {
  await withFlash(backTo(formData), async () => {
    const user = await requireRole("NURSE", "DOCTOR");
    const id = z.coerce.number().int().positive().parse(formData.get("allergyId"));
    return tx(db, () => {
      const r = db
        .prepare("UPDATE allergies SET removed_at = datetime('now','localtime'), removed_by = ? WHERE id = ? AND removed_at IS NULL RETURNING drug")
        .get(user.id, id) as { drug: string } | undefined;
      if (!r) fail("รายการนี้ถูกลบไปแล้ว");
      audit(db, user.id, "REMOVE", "allergy", id, r.drug);
      return `ลบรายการแพ้ ${r.drug} แล้ว`;
    });
  });
}

// Asked, and the patient has no known drug allergy: differs from "never asked"
export async function markNoAllergy(formData: FormData) {
  await withFlash(backTo(formData), async () => {
    const user = await requireRole("NURSE", "DOCTOR");
    const patientId = z.coerce.number().int().positive().parse(formData.get("patientId"));
    return tx(db, () => {
      if (db.prepare("SELECT 1 FROM allergies WHERE patient_id = ? AND removed_at IS NULL").get(patientId))
        fail("ผู้ป่วยมีประวัติแพ้ยาอยู่ ต้องลบรายการเดิมก่อน");
      db.prepare("UPDATE patients SET nkda_at = datetime('now','localtime') WHERE id = ?").run(patientId);
      audit(db, user.id, "NKDA", "patient", patientId);
      return "บันทึกว่า ผู้ป่วยปฏิเสธการแพ้ยา แล้ว";
    });
  });
}

export type VitalsState = { errors?: Partial<Record<VitalKey, string>>; error?: string };

// Nurse screening, from the modal on the patient page. Errors come back to the form (typed values stay);
// only a successful save redirects.
export async function saveVitals(_: VitalsState, formData: FormData): Promise<VitalsState> {
  const user = await requireRole("NURSE", "DOCTOR");
  const raw = Object.fromEntries(VITAL_FIELDS.map((f) => [f.key, String(formData.get(f.key) ?? "")])) as Record<VitalKey, string>;
  const cc = String(formData.get("cc") ?? "").trim().slice(0, 500);
  const errors = vitalsErrors(raw, true);
  if (Object.keys(errors).length) return { errors, error: "มีช่องที่ต้องแก้ ดูข้อความสีแดงใต้ช่อง" };
  const v = Object.fromEntries(VITAL_FIELDS.map((f) => [f.key, raw[f.key].trim() ? Number(raw[f.key]) : null])) as Record<VitalKey, number | null>;
  if (Object.values(v).every((x) => x === null) && !cc) return { error: "ยังไม่ได้กรอกค่าใดเลย" };

  const vn = String(formData.get("vn"));
  const hn = tx(db, () => {
    const visit = db.prepare("SELECT v.id, p.hn FROM visits v JOIN patients p ON p.id = v.patient_id WHERE v.vn = ?").get(vn) as
      | { id: number; hn: string }
      | undefined;
    if (!visit) throw new Error("Visit not found");
    db.prepare(
      `INSERT INTO vitals(visit_id, sbp, dbp, pulse, rr, temp, spo2, weight, height, cc, recorded_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(visit_id) DO UPDATE SET sbp=excluded.sbp, dbp=excluded.dbp, pulse=excluded.pulse, rr=excluded.rr, temp=excluded.temp,
         spo2=excluded.spo2, weight=excluded.weight, height=excluded.height, cc=excluded.cc,
         recorded_by=excluded.recorded_by, recorded_at=datetime('now','localtime')`,
    ).run(visit.id, v.sbp, v.dbp, v.pulse, v.rr, v.temp, v.spo2, v.weight, v.height, cc || null, user.id);
    // values in the audit detail: a re-measure overwrites the row, the log keeps every version
    audit(db, user.id, "SAVE", "vitals", visit.id, JSON.stringify({ ...v, cc }));
    return visit.hn;
  });
  redirect(`/patients/${hn}?${new URLSearchParams({ msg: "บันทึกซักประวัติแล้ว สถานะเปลี่ยนเป็น รอพบแพทย์" })}`);
}
