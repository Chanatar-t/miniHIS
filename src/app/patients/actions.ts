"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { db, tx, audit, newHn, newVn } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { isValidCid } from "@/lib/rules";

export type FormState = { error?: string; fields?: Record<string, string> };

const PatientInput = z.object({
  cid: z.string().trim().refine(isValidCid, "เลขบัตรประชาชนไม่ถูกต้อง (checksum ไม่ผ่าน)"),
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
  redirect(`/patients/${hn}`);
}

const VisitInput = z.object({
  patientId: z.coerce.number().int().positive(),
  scheme: z.enum(["UC", "SSS", "CSMBS", "SELF"]),
});

export async function openVisit(formData: FormData) {
  const user = await requireRole("CLERK");
  const v = VisitInput.parse(Object.fromEntries(formData));
  const hn = tx(db, () => {
    const p = db.prepare("SELECT hn FROM patients WHERE id = ?").get(v.patientId) as { hn: string } | undefined;
    if (!p) throw new Error("Patient not found");
    const { lastInsertRowid } = db
      .prepare("INSERT INTO visits(vn, patient_id, scheme) VALUES (?, ?, ?)")
      .run(newVn(db), v.patientId, v.scheme);
    audit(db, user.id, "CREATE", "visit", lastInsertRowid);
    return p.hn;
  });
  redirect(`/patients/${hn}`);
}
