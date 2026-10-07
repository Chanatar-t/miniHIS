"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { db, tx, audit, newAccession, newShipmentNo } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { groupIntoTubes } from "@/lib/rules";
import { REJECT_REASONS } from "@/lib/labels";

const now = "datetime('now','localtime')";
const id = (v: FormDataEntryValue | null) => z.coerce.number().int().positive().parse(v);
const back = (path: string, msg: string, ok = true) =>
  redirect(`${path}?${new URLSearchParams({ [ok ? "msg" : "err"]: msg })}`);

// Collect: ORDERED items of one order -> tubes (one accession each) -> COLLECTED
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
    if (items.length === 0) throw new Error("Nothing to collect (already collected?)");

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
  const user = await requireRole("LAB");
  const acc = String(formData.get("accession") ?? "").trim().toUpperCase();
  const msg = tx(db, () => {
    const s = db.prepare("SELECT id, received_at, reject_reason FROM specimens WHERE accession_no = ?").get(acc) as
      | { id: number; received_at: string | null; reject_reason: string | null }
      | undefined;
    if (!s) return { ok: false, text: `ไม่พบ ${acc || "(ว่าง)"}` };
    if (s.reject_reason) return { ok: false, text: `${acc} ถูก reject แล้ว` };
    if (s.received_at) return { ok: false, text: `${acc} รับเข้าแล้วเมื่อ ${s.received_at}` };
    db.prepare(`UPDATE specimens SET received_by = ?, received_at = ${now} WHERE id = ?`).run(user.id, s.id);
    db.prepare("UPDATE lab_order_items SET status = 'RECEIVED' WHERE specimen_id = ? AND status = 'COLLECTED'").run(s.id);
    audit(db, user.id, "RECEIVE", "specimen", s.id, acc);
    return { ok: true, text: `รับ ${acc} แล้ว` };
  });
  back("/lab/receive", msg.text, msg.ok);
}

// Reject: tube unusable -> its items REJECTED, and the same tests re-queued as ORDERED (recollect)
export async function rejectSpecimen(formData: FormData) {
  const user = await requireRole("LAB");
  const specimenId = id(formData.get("specimenId"));
  const reason = z.enum(REJECT_REASONS).parse(formData.get("reason"));
  const acc = tx(db, () => {
    const s = db.prepare("SELECT accession_no, shipment_id FROM specimens WHERE id = ?").get(specimenId) as
      | { accession_no: string; shipment_id: number | null }
      | undefined;
    if (!s) throw new Error("Specimen not found");
    if (s.shipment_id && reason !== "สูญหายระหว่างขนส่ง") throw new Error("Specimen already shipped");
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
    return s.accession_no;
  });
  back("/lab/receive", `Reject ${acc} (${reason}) และสร้างงานเจาะซ้ำแล้ว`);
}

// A received, not-rejected, not-shipped specimen belongs to the outlab of its tests (one per tube by grouping)
const PENDING_FOR_OUTLAB = `
  SELECT DISTINCT s.id FROM specimens s
  JOIN lab_order_items i ON i.specimen_id = s.id JOIN lab_tests t ON t.id = i.test_id
  WHERE s.received_at IS NOT NULL AND s.reject_reason IS NULL AND s.shipment_id IS NULL
    AND i.status = 'RECEIVED' AND t.outlab_id = ?`;

export async function createShipment(formData: FormData) {
  const user = await requireRole("LAB");
  const outlabId = id(formData.get("outlabId"));
  const no = tx(db, () => {
    const specimens = db.prepare(PENDING_FOR_OUTLAB).all(outlabId) as { id: number }[];
    if (specimens.length === 0) throw new Error("No specimens to ship");
    const no = newShipmentNo(db);
    const { lastInsertRowid } = db
      .prepare("INSERT INTO shipments(shipment_no, outlab_id, created_by) VALUES (?, ?, ?)")
      .run(no, outlabId, user.id);
    const put = db.prepare("UPDATE specimens SET shipment_id = ? WHERE id = ?");
    for (const s of specimens) put.run(lastInsertRowid, s.id);
    audit(db, user.id, "CREATE", "shipment", lastInsertRowid, `${specimens.length} specimens`);
    return no;
  });
  redirect(`/lab/shipments/${no}`);
}

// DRAFT -> SENT; WHERE status = 'DRAFT' makes a double click harmless
export async function sendShipment(formData: FormData) {
  const user = await requireRole("LAB");
  const shipmentId = id(formData.get("shipmentId"));
  const no = tx(db, () => {
    const row = db
      .prepare(`UPDATE shipments SET status = 'SENT', sent_at = ${now} WHERE id = ? AND status = 'DRAFT' RETURNING shipment_no`)
      .get(shipmentId) as { shipment_no: string } | undefined;
    if (!row) throw new Error("Shipment not found or already sent");
    db.prepare(
      `UPDATE lab_order_items SET status = 'SENT'
       WHERE status = 'RECEIVED' AND specimen_id IN (SELECT id FROM specimens WHERE shipment_id = ?)`,
    ).run(shipmentId);
    audit(db, user.id, "SEND", "shipment", shipmentId);
    return row.shipment_no;
  });
  redirect(`/lab/shipments/${no}`);
}

// remove one tube from a DRAFT shipment (e.g. found leaking while packing)
export async function removeFromShipment(formData: FormData) {
  const user = await requireRole("LAB");
  const specimenId = id(formData.get("specimenId"));
  const no = tx(db, () => {
    const row = db
      .prepare(
        `SELECT sh.shipment_no FROM specimens s JOIN shipments sh ON sh.id = s.shipment_id
         WHERE s.id = ? AND sh.status = 'DRAFT'`,
      )
      .get(specimenId) as { shipment_no: string } | undefined;
    if (!row) throw new Error("Only DRAFT shipments can be edited");
    db.prepare("UPDATE specimens SET shipment_id = NULL WHERE id = ?").run(specimenId);
    audit(db, user.id, "UNSHIP", "specimen", specimenId, row.shipment_no);
    return row.shipment_no;
  });
  redirect(`/lab/shipments/${no}`);
}
