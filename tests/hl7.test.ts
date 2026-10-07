import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOru } from "../src/lib/hl7.ts";

const msg = [
  "MSH|^~\\&|OUTLAB-A|LAB|MINIHIS|HOSP|20261007103000||ORU^R01|MSG0001|P|2.5",
  "PID|1||HN0000001||ใจดี^สมชาย",
  "OBR|1|L2610070001||A-2010^TSH",
  "OBX|1|NM|A-2010^TSH||12.5|mIU/L|0.27-4.2|H|||F",
  "OBX|2|NM|A-2011^FT4||0.8|ng/dL|0.93-1.7|L|||F",
  "OBR|2|L2610070002||A-1102^HbA1c",
  "OBX|1|NM|A-1102^HbA1c||7.2|%|4-6|H|||C",
].join("\r");

test("parses results across multiple OBR groups", () => {
  const m = parseOru(msg);
  assert.equal(m.controlId, "MSG0001");
  assert.equal(m.sendingApp, "OUTLAB-A");
  assert.equal(m.results.length, 3);
  assert.deepEqual(m.results[0], { accession: "L2610070001", code: "A-2010", value: "12.5", unit: "mIU/L", refRange: "0.27-4.2", status: "F" });
  assert.equal(m.results[2].accession, "L2610070002");
  assert.equal(m.results[2].status, "C");
});

test("accepts \\n line endings", () => {
  assert.equal(parseOru(msg.replaceAll("\r", "\n")).results.length, 3);
});

test("rejects bad messages", () => {
  assert.throws(() => parseOru("PID|1"), /MSH/);
  assert.throws(() => parseOru(msg.replace("ORU^R01", "ADT^A01")), /Unsupported/);
  assert.throws(() => parseOru(msg.replace("MSG0001", "")), /control id/);
  const head = "MSH|^~\\&|X||||||ORU^R01|M1"; // MSH-9 = ORU^R01, MSH-10 = M1
  assert.throws(() => parseOru(`${head}\rOBX|1|NM|A^B||1`), /OBX before OBR/);
  assert.throws(() => parseOru(`${head}\rOBR|1|L1`), /No OBX/);
});
