"use server";

import { z } from "zod";
import { db, tx, audit } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { flagResult } from "@/lib/rules";
import { parseOru, type Oru } from "@/lib/hl7";
import { fail, withFlash } from "@/lib/flash";
import { isCritical } from "@/lib/labels";
import { approvedRanges, rangeFor, RESULT_RANGE_SQL, type Range } from "@/lib/ranges";

const now = "datetime('now','localtime')";
// Flag with the range in force for THIS patient (sex/age) and store that range with the result,
// so a later range revision never changes what an existing report says.
const SNAPSHOT = "ref_low = ?, ref_high = ?, crit_low = ?, crit_high = ?";
const snap = (r: Range) => [r.ref_low, r.ref_high, r.crit_low, r.crit_high] as const;
const PATIENT_JOIN = "JOIN lab_orders o ON o.id = i.order_id JOIN visits v ON v.id = o.visit_id JOIN patients p ON p.id = v.patient_id";

// Manual entry: in-house tests after receive, or outlab tests whose result came on paper / portal.
export async function saveResults(formData: FormData) {
  await withFlash("/lab/results", async () => {
    const user = await requireRole("LAB");
    const entries = [...formData]
      .filter(([k, v]) => k.startsWith("value_") && String(v).trim() !== "")
      .map(([k, v]) => ({ itemId: Number(k.slice(6)), value: String(v).trim().slice(0, 100) }));
    if (entries.length === 0) fail("ยังไม่ได้กรอกผล");
    return tx(db, () => {
      const item = db.prepare(
        `SELECT i.status, i.test_id, t.code, t.outlab_id, p.sex, p.dob
         FROM lab_order_items i JOIN lab_tests t ON t.id = i.test_id ${PATIENT_JOIN} WHERE i.id = ?`,
      );
      const save = db.prepare(
        `UPDATE lab_order_items SET value = ?, flag = ?, ${SNAPSHOT}, resulted_by = ?, resulted_at = ${now}, status = 'RESULTED' WHERE id = ?`,
      );
      const ranges = approvedRanges();
      for (const e of entries) {
        const it = item.get(e.itemId) as { status: string; test_id: number; code: string; outlab_id: number | null; sex: string; dob: string } | undefined;
        if (!it) fail("ไม่พบรายการ");
        const ready = it.outlab_id == null ? it.status === "RECEIVED" : it.status === "SENT";
        if (!ready) fail(`${it.code}: สถานะ ${it.status} ลงผลไม่ได้ (อาจมีคนลงผลไปแล้ว)`);
        const range = rangeFor(ranges, it.test_id, it.sex, it.dob);
        save.run(e.value, flagResult(e.value, range), ...snap(range), user.id, e.itemId);
        audit(db, user.id, "RESULT", "lab_order_item", e.itemId, `${it.code}=${e.value}`);
      }
      return `✓ บันทึกผล ${entries.length} รายการแล้ว · ขั้นต่อไป: ให้เจ้าหน้าที่อีกคนกด Verify (เมนูขั้นที่ 5)`;
    });
  });
}

// HL7 ORU^R01 from an outlab. Idempotent on MSH-10; we re-flag with OUR reference ranges.
export async function importHl7(formData: FormData) {
  await withFlash("/lab/results?tab=out", async () => {
    const user = await requireRole("LAB");
    const file = formData.get("file");
    const raw = file instanceof File && file.size > 0 ? await file.text() : String(formData.get("raw") ?? "");
    if (!raw.trim()) fail("ไม่มีข้อความ HL7");
    if (raw.length > 1_000_000) fail("ไฟล์ใหญ่เกินไป");
    let msg: Oru;
    try {
      msg = parseOru(raw);
    } catch (e) {
      fail(`HL7 ไม่ถูกต้อง: ${(e as Error).message}`);
    }

    return tx(db, () => {
      if (db.prepare("SELECT 1 FROM inbound_messages WHERE control_id = ?").get(msg.controlId)) {
        fail(`ข้อความ ${msg.controlId} เคย import แล้ว ระบบไม่บันทึกผลซ้ำ`);
      }
      const { lastInsertRowid: msgId } = db
        .prepare("INSERT INTO inbound_messages(control_id, raw, status) VALUES (?, ?, 'OK')")
        .run(msg.controlId, raw);

      // match: our accession (OBR-2) + the outlab's own test code (OBX-3)
      const find = db.prepare(
        `SELECT i.id, i.status, i.test_id, t.code, ol.code AS outlab, p.sex, p.dob
         FROM specimens s JOIN lab_order_items i ON i.specimen_id = s.id
         JOIN lab_tests t ON t.id = i.test_id JOIN outlabs ol ON ol.id = t.outlab_id ${PATIENT_JOIN}
         WHERE s.accession_no = ? AND t.outlab_code = ? AND s.reject_reason IS NULL`,
      );
      const save = db.prepare(
        `UPDATE lab_order_items SET value = ?, flag = ?, ${SNAPSHOT}, resulted_by = NULL, resulted_at = ${now}, message_id = ?, status = 'RESULTED'
         WHERE id = ?`,
      );
      const ranges = approvedRanges();
      let applied = 0;
      const problems: string[] = [];
      for (const r of msg.results) {
        const it = find.get(r.accession, r.code) as
          | { id: number; status: string; test_id: number; code: string; outlab: string; sex: string; dob: string }
          | undefined;
        const where = `${r.accession} ${r.code}`;
        if (!it) problems.push(`${where}: ไม่พบในระบบ`);
        else if (it.outlab !== msg.sendingApp) problems.push(`${where}: ไม่ใช่ test ของ ${msg.sendingApp}`);
        else if (it.status !== "SENT") problems.push(`${where}: สถานะ ${it.status}`);
        else {
          const range = rangeFor(ranges, it.test_id, it.sex, it.dob);
          save.run(r.value, flagResult(r.value, range), ...snap(range), msgId, it.id);
          applied++;
        }
      }
      // nothing usable: roll back so the same message can be re-sent after fixing
      if (applied === 0) fail(`ไม่มีผลที่ตรงกับรายการในระบบ: ${problems.join("; ")}`);
      if (problems.length) {
        db.prepare("UPDATE inbound_messages SET status = 'ERROR', error = ? WHERE id = ?").run(problems.join("\n"), msgId);
      }
      audit(db, user.id, "IMPORT_HL7", "inbound_message", msgId, `${msg.controlId}: ${applied} ok, ${problems.length} unmatched`);
      return `✓ นำเข้า ${msg.controlId}: ${applied} ผล · ขั้นต่อไป: Verify` + (problems.length ? ` · ไม่ตรง ${problems.length} รายการ (${problems.join("; ")}) ให้ลงผลเอง` : "");
    });
  });
}

// Four-eyes: whoever entered a result cannot verify it. Critical values need a documented phone call.
export async function verifyOrder(formData: FormData) {
  await withFlash("/lab/verify", async () => {
    const user = await requireRole("LAB");
    // only the items the verifier actually saw on screen (a result arriving meanwhile is not verified blindly)
    const itemIds = z.array(z.coerce.number().int().positive()).min(1).parse(formData.getAll("itemId"));
    const notifiedTo = String(formData.get("notifiedTo") ?? "").trim();
    const method = String(formData.get("method") ?? "").trim();
    return tx(db, () => {
      const get = db.prepare(
        "SELECT i.status, i.flag, i.resulted_by, t.code FROM lab_order_items i JOIN lab_tests t ON t.id = i.test_id WHERE i.id = ?",
      );
      const items = itemIds.map((id) => ({ id, ...(get.get(id) as { status: string; flag: string | null; resulted_by: number | null; code: string }) }));
      for (const it of items) {
        if (it.status !== "RESULTED") fail(`${it.code ?? it.id}: สถานะเปลี่ยนไปแล้ว (${it.status ?? "ไม่พบ"}) กรุณารีเฟรช`);
        if (it.resulted_by === user.id) fail(`${it.code}: คุณเป็นผู้ลงผลเอง ต้องให้เจ้าหน้าที่อีกคน verify (four-eyes)`);
      }
      const critical = items.filter((it) => isCritical(it.flag));
      if (critical.length && (!notifiedTo || !method)) fail("มีค่าวิกฤต ต้องบันทึกว่าแจ้งใคร และแจ้งทางไหน ก่อน verify");

      const verify = db.prepare(`UPDATE lab_order_items SET status = 'VERIFIED', verified_by = ?, verified_at = ${now} WHERE id = ?`);
      const notify = db.prepare("INSERT INTO critical_notifications(item_id, notified_to, method, by_user) VALUES (?, ?, ?, ?)");
      for (const it of items) verify.run(user.id, it.id);
      for (const it of critical) notify.run(it.id, notifiedTo, method, user.id);
      audit(db, user.id, "VERIFY", "lab_order_item", null, `items=${itemIds.join(",")}${critical.length ? ` critical->${notifiedTo}` : ""}`);
      return `✓ Verify ${items.length} รายการแล้ว แพทย์เห็นผลแล้ว` + (critical.length ? ` · บันทึกการแจ้งค่าวิกฤต ${critical.length} รายการ` : "");
    });
  });
}

// Change a reported result: keep the old value, require a reason, re-flag.
export async function amendResult(formData: FormData) {
  const orderId = z.coerce.number().int().positive().parse(formData.get("orderId"));
  await withFlash(`/reports/${orderId}`, async () => {
    const user = await requireRole("LAB");
    const itemId = z.coerce.number().int().positive().parse(formData.get("itemId"));
    const value = String(formData.get("value") ?? "").trim().slice(0, 100);
    const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);
    const notifiedTo = String(formData.get("notifiedTo") ?? "").trim();
    if (!value) fail("กรอกผลใหม่");
    if (!reason) fail("ต้องระบุเหตุผลที่แก้ไขผล");
    return tx(db, () => {
      const it = db
        .prepare(
          `SELECT i.status, i.value, t.code, ${RESULT_RANGE_SQL}
           FROM lab_order_items i JOIN lab_tests t ON t.id = i.test_id WHERE i.id = ? AND i.order_id = ?`,
        )
        .get(itemId, orderId) as (Range & { status: string; value: string; code: string }) | undefined;
      if (!it) fail("ไม่พบรายการ");
      if (it.status !== "VERIFIED") fail("แก้ไขได้เฉพาะผลที่รายงานแล้ว");
      if (it.value === value) fail("ค่าใหม่เหมือนค่าเดิม");
      const flag = flagResult(value, it);
      if (isCritical(flag) && !notifiedTo) fail("ผลใหม่เป็นค่าวิกฤต ต้องระบุผู้รับแจ้ง");
      db.prepare("INSERT INTO result_amendments(item_id, old_value, new_value, reason, by_user) VALUES (?, ?, ?, ?, ?)").run(
        itemId, it.value, value, reason, user.id,
      );
      db.prepare(`UPDATE lab_order_items SET value = ?, flag = ?, verified_by = ?, verified_at = ${now} WHERE id = ?`).run(
        value, flag, user.id, itemId,
      );
      if (isCritical(flag)) {
        db.prepare("INSERT INTO critical_notifications(item_id, notified_to, method, by_user) VALUES (?, ?, 'โทรศัพท์', ?)").run(itemId, notifiedTo, user.id);
      }
      audit(db, user.id, "AMEND", "lab_order_item", itemId, `${it.code}: ${it.value} -> ${value} (${reason})`);
      return `แก้ไขผล ${it.code}: ${it.value} → ${value}`;
    });
  });
}
