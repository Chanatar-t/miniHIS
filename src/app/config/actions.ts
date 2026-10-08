"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { db, tx, audit } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { rangeProblem } from "@/lib/rules";
import { todayIso } from "@/lib/ranges";
import { fail, withFlash, UserError } from "@/lib/flash";
import type { ActionState } from "@/components/action-form";

// "" -> null, otherwise a finite number
const num = z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().finite().nullable());
const int = z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().nullable());

const RangeInput = z.object({
  sex: z.enum(["", "M", "F"]).transform((s) => (s === "" ? null : s)),
  age_min: int,
  age_max: int,
  ref_low: num,
  ref_high: num,
  crit_low: num,
  crit_high: num,
  effective_from: z.iso.date("วันที่เริ่มใช้ไม่ถูกต้อง"),
  reason: z.string().trim().min(5, "ต้องระบุเหตุผลอย่างน้อย 5 ตัวอักษร เช่น guideline ที่อ้างอิง หรือการเปลี่ยนน้ำยา/เครื่องตรวจ").max(500),
});

function parseRange(formData: FormData) {
  const r = RangeInput.safeParse(Object.fromEntries(formData));
  if (!r.success) fail(r.error.issues[0].message);
  const problem = rangeProblem(r.data);
  if (problem) fail(problem);
  if (r.data.effective_from < todayIso()) fail("วันที่เริ่มใช้ต้องไม่ย้อนหลัง (ผลที่รายงานไปแล้วจะไม่เปลี่ยนตาม)");
  return r.data;
}

const insertRange = (testId: number | bigint, r: ReturnType<typeof parseRange>, by: number) =>
  db
    .prepare(
      `INSERT INTO test_ranges(test_id, sex, age_min, age_max, ref_low, ref_high, crit_low, crit_high, effective_from, reason, proposed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(testId, r.sex, r.age_min, r.age_max, r.ref_low, r.ref_high, r.crit_low, r.crit_high, r.effective_from, r.reason, by).lastInsertRowid;

// UserError -> {error} shown inside the form (typed values kept); anything else is a real bug and throws
async function formResult(fn: () => Promise<void> | void): Promise<ActionState | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}

// Lab staff propose; nothing changes for patients until someone else approves it
export async function proposeRange(_: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole("LAB");
  const code = String(formData.get("code"));
  const err = await formResult(() => {
    const r = parseRange(formData);
    tx(db, () => {
      const t = db.prepare("SELECT id FROM lab_tests WHERE code = ?").get(code) as { id: number } | undefined;
      if (!t) fail("ไม่พบรายการตรวจ");
      const id = insertRange(t.id, r, user.id);
      audit(db, user.id, "PROPOSE_RANGE", "test_range", id, `${code} ${JSON.stringify(r)}`);
    });
  });
  if (err) return err;
  redirect(`/config/${code}?msg=${encodeURIComponent("✓ ส่งข้อเสนอแล้ว รอผู้มีสิทธิ์อนุมัติ (ยังไม่มีผลกับผู้ป่วยจนกว่าจะอนุมัติ)")}#pending`);
}

// Maker-checker: approver needs the permission and cannot be the proposer
export async function reviewRange(formData: FormData) {
  const code = String(formData.get("code"));
  await withFlash(`/config/${code}`, async () => {
    const user = await requireRole("LAB");
    if (!user.canApprove) fail("บัญชีนี้ไม่มีสิทธิ์อนุมัติค่าอ้างอิง");
    const id = z.coerce.number().int().positive().parse(formData.get("rangeId"));
    const decision = z.enum(["APPROVED", "REJECTED"]).parse(formData.get("decision"));
    const note = String(formData.get("note") ?? "").trim().slice(0, 500);
    if (decision === "REJECTED" && !note) fail("ไม่อนุมัติต้องระบุเหตุผล เพื่อให้ผู้เสนอแก้ไขได้");
    return tx(db, () => {
      const r = db.prepare("SELECT test_id, status, proposed_by FROM test_ranges WHERE id = ?").get(id) as
        | { test_id: number; status: string; proposed_by: number }
        | undefined;
      if (!r) fail("ไม่พบข้อเสนอ");
      if (r.status !== "PENDING") fail("ข้อเสนอนี้ถูกพิจารณาไปแล้ว");
      if (r.proposed_by === user.id) fail("ผู้เสนออนุมัติข้อเสนอของตัวเองไม่ได้ (ต้องเป็นคนละคน)");
      db.prepare(`UPDATE test_ranges SET status = ?, reviewed_by = ?, reviewed_at = datetime('now','localtime'), review_note = ? WHERE id = ?`).run(
        decision, user.id, note || null, id,
      );
      // a new test becomes orderable with its first approved range
      if (decision === "APPROVED") db.prepare("UPDATE lab_tests SET active = 1 WHERE id = ? AND active = 0").run(r.test_id);
      audit(db, user.id, decision === "APPROVED" ? "APPROVE_RANGE" : "REJECT_RANGE", "test_range", id, note || undefined);
      return decision === "APPROVED" ? "✓ อนุมัติแล้ว ค่าใหม่มีผลตามวันที่เริ่มใช้" : "บันทึกการไม่อนุมัติแล้ว";
    });
  });
}

const TestInput = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,10}$/, "รหัสใช้ตัวอังกฤษ/ตัวเลข 1-10 ตัว เช่น K, NA, HBSAG"),
  name: z.string().trim().min(2, "กรอกชื่อรายการตรวจ").max(100),
  loinc: z.string().trim().regex(/^(\d{1,7}-\d)?$/, "LOINC รูปแบบไม่ถูกต้อง เช่น 2345-7"),
  specimen_type: z.string().trim().min(2, "กรอกชนิดสิ่งส่งตรวจ"),
  container: z.string().trim().min(2, "กรอกชนิดหลอด"),
  unit: z.string().trim().max(20),
  price: z.coerce.number().min(0, "ราคาต้องไม่ติดลบ"),
  outlab_id: z.preprocess((v) => (v === "" ? null : Number(v)), z.number().int().nullable()),
  outlab_code: z.string().trim().max(20),
  outlab_cost: num,
  tat_days: z.coerce.number().int().min(0).max(60),
});

export async function createTest(_: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole("LAB");
  let code = "";
  const err = await formResult(() => {
    const t = TestInput.safeParse(Object.fromEntries(formData));
    if (!t.success) fail(t.error.issues[0].message);
    if (t.data.outlab_id && !t.data.outlab_code) fail("test ที่ส่ง Outlab ต้องมีรหัส test ของ Outlab");
    const r = parseRange(formData);
    code = t.data.code;
    tx(db, () => {
      if (db.prepare("SELECT 1 FROM lab_tests WHERE code = ?").get(t.data.code)) fail(`รหัส ${t.data.code} มีอยู่แล้ว`);
      const d = t.data;
      const { lastInsertRowid } = db
        .prepare(
          `INSERT INTO lab_tests(code, name, loinc, specimen_type, container, unit, price, outlab_id, outlab_code, outlab_cost, tat_days, active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        )
        .run(d.code, d.name, d.loinc || null, d.specimen_type, d.container, d.unit || null, d.price, d.outlab_id, d.outlab_code || null, d.outlab_cost, d.tat_days);
      insertRange(lastInsertRowid, r, user.id);
      audit(db, user.id, "CREATE_TEST", "lab_test", lastInsertRowid, d.code);
    });
  });
  if (err) return err;
  redirect(`/config/${code}?msg=${encodeURIComponent("✓ สร้างรายการตรวจแล้ว จะสั่งได้หลังอนุมัติค่าอ้างอิงชุดแรก")}`);
}
