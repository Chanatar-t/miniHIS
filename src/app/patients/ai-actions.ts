"use server";

import { RESULT_RANGE_SQL } from "@/lib/ranges";
import { z } from "zod";
import { db, audit } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { age, refRange } from "@/lib/labels";
import { summarizeLabs, type AiSummary, type LabHistory } from "@/lib/ai";

export type AiState = { summary?: AiSummary };

export async function aiSummary(_: AiState, formData: FormData): Promise<AiState> {
  const user = await requireRole("DOCTOR");
  const patientId = z.coerce.number().int().positive().parse(formData.get("patientId"));
  const p = db.prepare("SELECT sex, dob FROM patients WHERE id = ?").get(patientId) as { sex: "M" | "F"; dob: string } | undefined;
  if (!p) return {};

  const base = `FROM lab_order_items i JOIN lab_orders o ON o.id = i.order_id JOIN visits v ON v.id = o.visit_id
                JOIN lab_tests t ON t.id = i.test_id LEFT JOIN specimens s ON s.id = i.specimen_id
                WHERE v.patient_id = ?`;
  // only VERIFIED values go to the model: unverified results are not facts yet
  const results = (
    db
      .prepare(
        `SELECT date(coalesce(s.collected_at, o.ordered_at)) AS date, t.code AS test, t.name, t.loinc, i.value, t.unit,
                ${RESULT_RANGE_SQL}, i.flag
         ${base} AND i.status = 'VERIFIED' ORDER BY date, i.id`,
      )
      .all(patientId) as (Omit<LabHistory["results"][number], "ref"> & { ref_low: number | null; ref_high: number | null })[]
  ).map(({ ref_low, ref_high, ...r }) => ({ ...r, ref: refRange(ref_low, ref_high) }));
  const pending = db
    .prepare(`SELECT t.code AS test, t.name, i.status ${base} AND i.status NOT IN ('VERIFIED','REJECTED','CANCELLED')`)
    .all(patientId) as LabHistory["pending"];

  // log who sent what to the AI, but not the content itself
  audit(db, user.id, "AI_SUMMARY", "patient", patientId, `de-identified: ${results.length} results, ${pending.length} pending`);
  return { summary: await summarizeLabs({ sex: p.sex, age: age(p.dob), results, pending }) };
}
