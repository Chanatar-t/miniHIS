import { db } from "./db";
import { orderStatus } from "./rules";

export type TodayVisit = {
  id: number; vn: string; scheme: string; created_at: string; patient_id: number;
  hn: string; prefix: string; first_name: string; last_name: string; sex: string; dob: string;
  tests: number; status: string; // NO_ORDER or an order status from orderStatus()
};

// Visits opened today, newest first, with where each one is in the flow
export function todayVisits(patientId?: number): TodayVisit[] {
  const rows = db
    .prepare(
      `SELECT v.id, v.vn, v.scheme, v.created_at, p.id AS patient_id, p.hn, p.prefix, p.first_name, p.last_name, p.sex, p.dob,
              group_concat(i.status) AS statuses
       FROM visits v JOIN patients p ON p.id = v.patient_id
       LEFT JOIN lab_orders o ON o.visit_id = v.id LEFT JOIN lab_order_items i ON i.order_id = o.id
       WHERE date(v.created_at) = date('now','localtime') AND (? IS NULL OR v.patient_id = ?)
       GROUP BY v.id ORDER BY v.id DESC`,
    )
    .all(patientId ?? null, patientId ?? null) as (Omit<TodayVisit, "tests" | "status"> & { statuses: string | null })[];
  return rows.map(({ statuses, ...v }) => {
    const s = statuses ? statuses.split(",") : [];
    return { ...v, tests: s.filter((x) => x !== "REJECTED" && x !== "CANCELLED").length, status: s.length ? orderStatus(s) : "NO_ORDER" };
  });
}
