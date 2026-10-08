"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { db, tx, audit, newAccession, newShipmentNo } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { groupIntoTubes } from "@/lib/rules";
import { REJECT_REASONS } from "@/lib/labels";
import { fail, withFlash } from "@/lib/flash";

const now = "datetime('now','localtime')";
const id = (v: FormDataEntryValue | null) => z.coerce.number().int().positive().parse(v);

// Collect: ORDERED items of one order -> tubes (one accession each) -> COLLECTED.
// Idempotent: a double click finds nothing left to collect and just shows the labels.
export async function collectOrder(formData: FormData) {
  const user = await requireRole("LAB");
  const orderId = id(formData.get("orderId"));
  tx(db, () => {
    const items = db
      .prepare(
        `SELECT i.id, t.specimen_type, t.container, t.outlab_id
         FROM lab_order_items i JOIN lab_tests t ON t.id = i.test_id
         WHERE i.order_id = ? AND i.status = 'ORDERED'`,
      )
      .all(orderId) as { id: number; specimen_type: string; container: string; outlab_id: number | null }[];

    const insSpecimen = db.prepare(
      `INSERT INTO specimens(accession_no, order_id, specimen_type, container, collected_by, collected_at)
       VALUES (?, ?, ?, ?, ?, ${now})`,
    );
    const link = db.prepare("UPDATE lab_order_items SET specimen_id = ?, status = 'COLLECTED' WHERE id = ?");
    for (const tube of groupIntoTubes(items)) {
      const acc = newAccession(db);
      const { lastInsertRowid } = insSpecimen.run(acc, orderId, tube[0].specimen_type, tube[0].container, user.id);
      for (const it of tube) link.run(lastInsertRowid, it.id);
      audit(db, user.id, "COLLECT", "specimen", lastInsertRowid, acc);
    }
  });
  redirect(`/lab/labels/${orderId}`);
}

// Receive into lab by scanning the tube barcode (scanner = keyboard + Enter)
export async function receiveSpecimen(formData: FormData) {
  await withFlash("/lab/receive", async () => {
    const user = await requireRole("LAB");
    const acc = String(formData.get("accession") ?? "").trim().toUpperCase();
    return tx(db, () => {
      const s = db.prepare("SELECT id, received_at, reject_reason FROM specimens WHERE accession_no = ?").get(acc) as
        | { id: number; received_at: string | null; reject_reason: string | null }
        | undefined;
      if (!s) fail(`ไม่พบหลอด ${acc || "(ว่าง)"}`);
      if (s.reject_reason) fail(`${acc} ถูก reject แล้ว (${s.reject_reason})`);
      if (s.received_at) fail(`${acc} รับเข้าแล้วเมื่อ ${s.received_at}`);
      db.prepare(`UPDATE specimens SET received_by = ?, received_at = ${now} WHERE id = ?`).run(user.id, s.id);
      db.prepare("UPDATE lab_order_items SET status = 'RECEIVED' WHERE specimen_id = ? AND status = 'COLLECTED'").run(s.id);
      audit(db, user.id, "RECEIVE", "specimen", s.id, acc);
      const outlab = db
        .prepare(
          "SELECT max(ol.code) AS o FROM lab_order_items i JOIN lab_tests t ON t.id = i.test_id LEFT JOIN outlabs ol ON ol.id = t.outlab_id WHERE i.specimen_id = ?",
        )
        .get(s.id) as { o: string | null };
      return `✓ รับ ${acc} เข้า Lab แล้ว · ขั้นต่อไป: ${outlab.o ? `ส่ง Outlab (${outlab.o})` : "ลงผล (ตรวจในโรงพยาบาล)"}`;
    });
  });
}

// Reject: tube unusable -> its items REJECTED, and the same tests re-queued as ORDERED (recollect).
// Allowed before receive (seen at the counter) or after; not once it is in a shipment, except "lost".
export async function rejectSpecimen(formData: FormData) {
  await withFlash("/lab/receive", async () => {
    const user = await requireRole("LAB");
    const specimenId = id(formData.get("specimenId"));
    const reason = z.enum(REJECT_REASONS).parse(formData.get("reason"));
    return tx(db, () => {
      const s = db.prepare("SELECT accession_no, shipment_id, reject_reason FROM specimens WHERE id = ?").get(specimenId) as
        | { accession_no: string; shipment_id: number | null; reject_reason: string | null }
        | undefined;
      if (!s) fail("ไม่พบหลอดนี้");
      if (s.reject_reason) fail(`${s.accession_no} ถูก reject ไปแล้ว`);
      if (s.shipment_id && reason !== "สูญหายระหว่างขนส่ง") fail(`${s.accession_no} อยู่ในใบนำส่งแล้ว เอาออกจากใบนำส่งก่อน`);
      db.prepare("UPDATE specimens SET reject_reason = ? WHERE id = ?").run(reason, specimenId);
      const items = db
        .prepare(
          `UPDATE lab_order_items SET status = 'REJECTED'
           WHERE specimen_id = ? AND status IN ('COLLECTED','RECEIVED','SENT') RETURNING order_id, test_id`,
        )
        .all(specimenId) as { order_id: number; test_id: number }[];
      const requeue = db.prepare("INSERT INTO lab_order_items(order_id, test_id) VALUES (?, ?)");
      for (const it of items) requeue.run(it.order_id, it.test_id);
      audit(db, user.id, "REJECT", "specimen", specimenId, `${s.accession_no}: ${reason}`);
      return `Reject ${s.accession_no} (${reason}) และส่งกลับไปรอเจาะใหม่ ${items.length} รายการ`;
    });
  });
}

// A received, not-rejected, not-shipped specimen belongs to the outlab of its tests (one per tube by grouping)
const PENDING_FOR_OUTLAB = `
  SELECT DISTINCT s.id FROM specimens s
  JOIN lab_order_items i ON i.specimen_id = s.id JOIN lab_tests t ON t.id = i.test_id
  WHERE s.received_at IS NOT NULL AND s.reject_reason IS NULL AND s.shipment_id IS NULL
    AND i.status = 'RECEIVED' AND t.outlab_id = ?`;

export async function createShipment(formData: FormData) {
  let no = "";
  await withFlash("/lab/shipments", async () => {
    const user = await requireRole("LAB");
    const outlabId = id(formData.get("outlabId"));
    no = tx(db, () => {
      const specimens = db.prepare(PENDING_FOR_OUTLAB).all(outlabId) as { id: number }[];
      if (specimens.length === 0) fail("ไม่มีหลอดรอส่งสำหรับ Outlab นี้");
      const no = newShipmentNo(db);
      const { lastInsertRowid } = db
        .prepare("INSERT INTO shipments(shipment_no, outlab_id, created_by) VALUES (?, ?, ?)")
        .run(no, outlabId, user.id);
      const put = db.prepare("UPDATE specimens SET shipment_id = ? WHERE id = ?");
      for (const s of specimens) put.run(lastInsertRowid, s.id);
      audit(db, user.id, "CREATE", "shipment", lastInsertRowid, `${specimens.length} specimens`);
      return no;
    });
  });
  redirect(`/lab/shipments/${no}`);
}

// DRAFT -> SENT; WHERE status = 'DRAFT' makes a double click harmless
export async function sendShipment(formData: FormData) {
  const shipmentNo = String(formData.get("shipmentNo"));
  await withFlash(`/lab/shipments/${shipmentNo}`, async () => {
    const user = await requireRole("LAB");
    return tx(db, () => {
      const sh = db.prepare("SELECT id, status FROM shipments WHERE shipment_no = ?").get(shipmentNo) as
        | { id: number; status: string }
        | undefined;
      if (!sh) fail("ไม่พบใบนำส่ง");
      if (sh.status !== "DRAFT") fail("ใบนำส่งนี้ส่งไปแล้ว");
      const n = (db.prepare("SELECT COUNT(*) AS n FROM specimens WHERE shipment_id = ?").get(sh.id) as { n: number }).n;
      if (n === 0) fail("ใบนำส่งว่าง ไม่มีหลอดให้ส่ง");
      db.prepare(`UPDATE shipments SET status = 'SENT', sent_at = ${now} WHERE id = ?`).run(sh.id);
      db.prepare(
        `UPDATE lab_order_items SET status = 'SENT'
         WHERE status = 'RECEIVED' AND specimen_id IN (SELECT id FROM specimens WHERE shipment_id = ?)`,
      ).run(sh.id);
      audit(db, user.id, "SEND", "shipment", sh.id, `${n} specimens`);
      return `ส่ง ${shipmentNo} แล้ว (${n} หลอด)`;
    });
  });
}

// remove one tube from a DRAFT shipment (e.g. found leaking while packing); it goes back to "waiting to ship"
export async function removeFromShipment(formData: FormData) {
  const shipmentNo = String(formData.get("shipmentNo"));
  await withFlash(`/lab/shipments/${shipmentNo}`, async () => {
    const user = await requireRole("LAB");
    const specimenId = id(formData.get("specimenId"));
    return tx(db, () => {
      const row = db
        .prepare(
          `SELECT s.accession_no, sh.status FROM specimens s JOIN shipments sh ON sh.id = s.shipment_id
           WHERE s.id = ? AND sh.shipment_no = ?`,
        )
        .get(specimenId, shipmentNo) as { accession_no: string; status: string } | undefined;
      if (!row) fail("หลอดนี้ไม่ได้อยู่ในใบนำส่งนี้");
      if (row.status !== "DRAFT") fail("ใบนำส่งที่ส่งแล้วแก้ไขไม่ได้");
      db.prepare("UPDATE specimens SET shipment_id = NULL WHERE id = ?").run(specimenId);
      audit(db, user.id, "UNSHIP", "specimen", specimenId, shipmentNo);
      return `เอา ${row.accession_no} ออกจากใบนำส่งแล้ว`;
    });
  });
}
