import { test } from "node:test";
import assert from "node:assert/strict";
import { flagResult, isValidCid, cidCheckDigit, groupIntoTubes, ungroundedNumbers } from "../src/lib/rules.ts";

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

test("isValidCid", () => {
  const first12 = "110370012345";
  assert.ok(isValidCid(first12 + cidCheckDigit(first12)));
  assert.ok(!isValidCid(first12 + ((Number(cidCheckDigit(first12)) + 1) % 10)));
  assert.ok(!isValidCid("12345"));
  assert.ok(!isValidCid("abcdefghijklm"));
});
