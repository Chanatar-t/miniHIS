"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { db, tx, audit } from "@/lib/db";
import { requireRole } from "@/lib/auth";

const OrderInput = z.object({
  visitId: z.coerce.number().int().positive(),
  testIds: z.array(z.coerce.number().int().positive()).min(1, "เลือกอย่างน้อย 1 รายการ"),
  priority: z.enum(["ROUTINE", "STAT"]),
  note: z.string().trim().max(500),
});

export async function createOrder(formData: FormData) {
  const user = await requireRole("DOCTOR");
  const o = OrderInput.parse({
    visitId: formData.get("visitId"),
    testIds: [...new Set(formData.getAll("testId"))],
    priority: formData.get("priority"),
    note: formData.get("note") ?? "",
  });

  const hn = tx(db, () => {
    const v = db
      .prepare("SELECT p.hn FROM visits v JOIN patients p ON p.id = v.patient_id WHERE v.id = ?")
      .get(o.visitId) as { hn: string } | undefined;
    if (!v) throw new Error("Visit not found");
    const { lastInsertRowid: orderId } = db
      .prepare("INSERT INTO lab_orders(visit_id, ordered_by, priority, note) VALUES (?, ?, ?, ?)")
      .run(o.visitId, user.id, o.priority, o.note || null);
    const ins = db.prepare("INSERT INTO lab_order_items(order_id, test_id) VALUES (?, ?)");
    const active = db.prepare("SELECT 1 FROM lab_tests WHERE id = ? AND active = 1");
    for (const t of o.testIds) {
      if (!active.get(t)) throw new Error(`Test ${t} is not orderable`); // unknown or not yet approved -> whole tx rolls back
      ins.run(orderId, t);
    }
    audit(db, user.id, "CREATE", "lab_order", orderId, `tests=${o.testIds.join(",")}`);
    return v.hn;
  });
  redirect(`/patients/${hn}`);
}
