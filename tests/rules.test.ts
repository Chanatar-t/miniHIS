import { test } from "node:test";
import assert from "node:assert/strict";
import { flagResult, isValidCid, cidCheckDigit, groupIntoTubes, ungroundedNumbers, orderStatus, withPrevious } from "../src/lib/rules.ts";

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

test("isValidCid", () => {
  const first12 = "110370012345";
  assert.ok(isValidCid(first12 + cidCheckDigit(first12)));
  assert.ok(!isValidCid(first12 + ((Number(cidCheckDigit(first12)) + 1) % 10)));
  assert.ok(!isValidCid("12345"));
  assert.ok(!isValidCid("abcdefghijklm"));
});
