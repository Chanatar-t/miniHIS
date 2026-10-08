import { RESULT_RANGE_SQL } from "./ranges";
import { db } from "./db";
import { orderStatus, withPrevious } from "./rules";

// All tests of one visit (every order), with last time's verified value for comparison.
export function visitResults(visitId: number, patientId: number) {
  const rows = db
    .prepare(
      `SELECT i.id AS item_id, i.test_id, o.visit_id, v.created_at AS visit_at, t.code, t.name, i.status, i.value, i.flag, t.unit, ${RESULT_RANGE_SQL},
              ol.code AS outlab, EXISTS (SELECT 1 FROM result_amendments a WHERE a.item_id = i.id) AS amended
       FROM lab_order_items i JOIN lab_orders o ON o.id = i.order_id JOIN visits v ON v.id = o.visit_id JOIN lab_tests t ON t.id = i.test_id
       LEFT JOIN outlabs ol ON ol.id = t.outlab_id
       WHERE o.visit_id = ? AND i.status NOT IN ('REJECTED','CANCELLED')
       ORDER BY t.outlab_id IS NOT NULL, t.code`,
    )
    .all(visitId) as {
    item_id: number; test_id: number; visit_id: number; visit_at: string; code: string; name: string; status: string; value: string | null;
    flag: string | null; unit: string | null; ref_low: number | null; ref_high: number | null; outlab: string | null; amended: number;
  }[];
  const history = db
    .prepare(
      `SELECT i.test_id, o.visit_id, v.created_at AS visit_at, i.value, date(coalesce(i.verified_at, o.ordered_at)) AS date
       FROM lab_order_items i JOIN lab_orders o ON o.id = i.order_id JOIN visits v ON v.id = o.visit_id
       WHERE v.patient_id = ? AND i.status = 'VERIFIED'`,
    )
    .all(patientId) as { test_id: number; visit_id: number; visit_at: string; value: string; date: string }[];
  return withPrevious(rows.map((r) => ({ ...r })), history);
}

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
