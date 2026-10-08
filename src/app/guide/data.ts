import { db } from "@/lib/db";
import type { UatCase } from "@/lib/guide";

export type Latest = { case_id: string; status: string; note: string | null; at: string; tester: string; runs: number };

// latest result per case (any tester) + how many times it was run
export function latestResults(): Map<string, Latest> {
  const rows = db
    .prepare(
      `SELECT r.case_id, r.status, r.note, r.at, u.name AS tester,
              (SELECT COUNT(*) FROM uat_results x WHERE x.case_id = r.case_id) AS runs
       FROM uat_results r JOIN users u ON u.id = r.user_id
       WHERE r.id IN (SELECT MAX(id) FROM uat_results GROUP BY case_id)`,
    )
    .all() as Latest[];
  return new Map(rows.map((r) => [r.case_id, { ...r }]));
}

export function tally(cases: UatCase[], latest: Map<string, Latest>) {
  const s = (st: string) => cases.filter((c) => latest.get(c.id)?.status === st).length;
  return { pass: s("PASS"), fail: s("FAIL"), blocked: s("BLOCKED"), total: cases.length };
}
