import { test } from "node:test";
import assert from "node:assert/strict";
import { flagResult, isValidCid, cidCheckDigit, groupIntoTubes, ungroundedNumbers, orderStatus, withPrevious, pickRange, rangeProblem } from "../src/lib/rules.ts";

const glucose = { ref_low: 70, ref_high: 100, crit_low: 40, crit_high: 500 };

test("flagResult", () => {
  assert.equal(flagResult("85", glucose), "N");
  assert.equal(flagResult("65", glucose), "L");
  assert.equal(flagResult("120", glucose), "H");
  assert.equal(flagResult("30", glucose), "LL");
  assert.equal(flagResult("600", glucose), "HH");
  assert.equal(flagResult("100", glucose), "N"); // boundary is normal
  assert.equal(flagResult("Non-reactive", glucose), null);
  assert.equal(flagResult("", glucose), null);
  assert.equal(flagResult("5", { ref_low: null, ref_high: 4, crit_low: null, crit_high: null }), "H");
});

test("groupIntoTubes", () => {
  const serum = { specimen_type: "Serum", container: "Red top" };
  const tubes = groupIntoTubes([
    { id: "TSH", ...serum, outlab_id: 1 },
    { id: "FT4", ...serum, outlab_id: 1 }, // same tube as TSH
    { id: "VITD", ...serum, outlab_id: 2 }, // other outlab -> own tube
    { id: "CREA", ...serum, outlab_id: null }, // in-house -> own tube
    { id: "HBA1C", specimen_type: "Whole blood", container: "Lavender top (EDTA)", outlab_id: 1 },
  ]);
  assert.deepEqual(tubes.map((t) => t.map((i) => i.id)), [["TSH", "FT4"], ["VITD"], ["CREA"], ["HBA1C"]]);
});

test("ungroundedNumbers", () => {
  const src = JSON.stringify({ results: [{ test: "HBA1C", value: "7.20", ref: "4 - 6" }] });
  assert.deepEqual(ungroundedNumbers("HbA1c 7.2 สูงกว่า 6", src), []);
  assert.deepEqual(ungroundedNumbers("HbA1c 8.1 สูงกว่า 6", src), ["8.1"]);
});

test("orderStatus", () => {
  assert.equal(orderStatus(["ORDERED", "ORDERED"]), "WAITING");
  assert.equal(orderStatus(["COLLECTED", "ORDERED"]), "IN_PROGRESS");
  assert.equal(orderStatus(["VERIFIED", "SENT"]), "PARTIAL");
  assert.equal(orderStatus(["VERIFIED", "VERIFIED"]), "COMPLETE");
  assert.equal(orderStatus(["VERIFIED", "REJECTED"]), "COMPLETE"); // rejected tube, its re-collect already verified
  assert.equal(orderStatus(["REJECTED", "ORDERED"]), "WAITING"); // waiting for re-collection
  assert.equal(orderStatus(["CANCELLED"]), "CANCELLED");
});

test("withPrevious", () => {
  // visit 9 was back-entered later (higher id) but happened in May: ordering must follow visit time, not id
  const history = [
    { test_id: 3, visit_id: 1, visit_at: "2026-01-10 09:00:00", value: "6.1", date: "2026-01-10" },
    { test_id: 3, visit_id: 9, visit_at: "2026-05-10 09:00:00", value: "6.8", date: "2026-05-10" },
    { test_id: 3, visit_id: 3, visit_at: "2026-10-08 09:00:00", value: "7.2", date: "2026-10-08" }, // same visit: not "previous"
    { test_id: 4, visit_id: 1, visit_at: "2026-01-10 09:00:00", value: "2.0", date: "2026-01-10" },
  ];
  const out = withPrevious(
    [
      { test_id: 3, visit_id: 3, visit_at: "2026-10-08 09:00:00" },
      { test_id: 4, visit_id: 1, visit_at: "2026-01-10 09:00:00" },
      { test_id: 9, visit_id: 3, visit_at: "2026-10-08 09:00:00" },
      { test_id: 3, visit_id: 9, visit_at: "2026-05-10 09:00:00" },
    ],
    history,
  );
  assert.deepEqual(out[0].prev, { value: "6.8", date: "2026-05-10" }); // latest earlier visit, despite its higher id
  assert.equal(out[1].prev, null); // first time
  assert.equal(out[2].prev, null); // never done
  assert.deepEqual(out[3].prev, { value: "6.1", date: "2026-01-10" }); // October is later, not previous
});

test("pickRange", () => {
  const base = { test_id: 2, age_min: null, age_max: null, crit_low: null, crit_high: 10, status: "APPROVED" };
  const rows = [
    { ...base, id: 1, sex: null, ref_low: 0.7, ref_high: 1.2, effective_from: "2026-01-01" },
    { ...base, id: 2, sex: "F" as const, ref_low: 0.5, ref_high: 0.9, effective_from: "2026-01-01" },
    { ...base, id: 3, sex: "F" as const, ref_low: 0.45, ref_high: 0.95, effective_from: "2026-11-01" }, // approved, not yet in effect
    { ...base, id: 4, sex: "M" as const, ref_low: 0.6, ref_high: 1.1, effective_from: "2026-06-01", status: "PENDING" }, // not approved
    { ...base, id: 5, sex: null, ref_low: 0.3, ref_high: 0.7, age_max: 12, effective_from: "2026-01-01" }, // children
  ];
  assert.equal(pickRange(rows, 2, "F", 40, "2026-10-08")?.id, 2); // sex-specific beats any-sex
  assert.equal(pickRange(rows, 2, "M", 40, "2026-10-08")?.id, 1); // pending ignored -> falls back to any-sex
  assert.equal(pickRange(rows, 2, "F", 40, "2026-11-02")?.id, 3); // newer version once in effect
  assert.equal(pickRange(rows, 2, "M", 8, "2026-10-08")?.id, 5); // age-bounded beats unbounded
  assert.equal(pickRange(rows, 2, "F", 8, "2026-10-08")?.id, 2); // sex outranks age bounds
  assert.equal(pickRange(rows, 99, "F", 40, "2026-10-08"), null);
});

test("rangeProblem", () => {
  const ok = { ref_low: 70, ref_high: 100, crit_low: 40, crit_high: 500, age_min: null, age_max: null };
  assert.equal(rangeProblem(ok), null);
  assert.match(rangeProblem({ ...ok, ref_low: 120 })!, /น้อยกว่าค่าสูงสุด/);
  assert.match(rangeProblem({ ...ok, crit_low: 80 })!, /วิกฤตต่ำ/);
  assert.match(rangeProblem({ ...ok, crit_high: 90 })!, /วิกฤตสูง/);
  assert.match(rangeProblem({ ...ok, ref_low: null, ref_high: null })!, /อย่างน้อยหนึ่งค่า/);
  assert.match(rangeProblem({ ...ok, age_min: 60, age_max: 18 })!, /อายุเริ่ม/);
  assert.equal(rangeProblem({ ...ok, ref_low: null, crit_low: null }), null); // upper bound only (e.g. PSA < 4)
});

test("isValidCid", () => {
  const first12 = "110370012345";
  assert.ok(isValidCid(first12 + cidCheckDigit(first12)));
  assert.ok(!isValidCid(first12 + ((Number(cidCheckDigit(first12)) + 1) % 10)));
  assert.ok(!isValidCid("12345"));
  assert.ok(!isValidCid("abcdefghijklm"));
});

test("bmi + vitalAlerts", async () => {
  const { bmi, bmiLabel, vitalAlerts } = await import("../src/lib/rules.ts");
  assert.equal(bmi(70, 170), 24.2);
  assert.equal(bmi(null, 170), null);
  assert.equal(bmiLabel(22.9), "ปกติ");
  assert.equal(bmiLabel(23), "น้ำหนักเกิน");
  assert.equal(bmiLabel(25), "อ้วน");
  const none = { sbp: null, dbp: null, pulse: null, rr: null, temp: null, spo2: null };
  assert.deepEqual(vitalAlerts(none), []);
  assert.deepEqual(vitalAlerts({ ...none, sbp: 120, dbp: 80, temp: 36.8, spo2: 98, pulse: 80, rr: 16 }), []);
  assert.deepEqual(vitalAlerts({ ...none, sbp: 150, dbp: 85 }), ["ความดันสูง"]);
  assert.deepEqual(vitalAlerts({ ...none, sbp: 130, dbp: 112 }), ["ความดันสูงมาก"]);
  assert.deepEqual(vitalAlerts({ ...none, sbp: 85, dbp: 50, temp: 38.2, spo2: 92 }), ["ความดันต่ำ", "มีไข้", "SpO2 ต่ำ"]);
});

test("vitalsErrors", async () => {
  const { vitalsErrors } = await import("../src/lib/rules.ts");
  assert.deepEqual(vitalsErrors({ sbp: "120", dbp: "80", temp: "36.8" }, true), {});
  assert.deepEqual(vitalsErrors({ sbp: "", dbp: "" }, true), {});
  assert.ok(vitalsErrors({ sbp: "1200", dbp: "80" }).sbp?.includes("50–300"));
  assert.ok(vitalsErrors({ sbp: "80", dbp: "120" }).dbp?.includes("สลับช่อง"));
  assert.deepEqual(vitalsErrors({ sbp: "120" }), {}); // still typing: no nag yet
  assert.ok(vitalsErrors({ sbp: "120" }, true).dbp?.includes("ครบ"));
  assert.equal(vitalsErrors({ temp: "abc" }).temp, "ต้องเป็นตัวเลข");
});
