// Minimal HL7 v2 ORU^R01 parser: outlab result message -> flat result rows.
// Only the fields we use. Escape sequences (\F\, \S\ ...) not decoded. ponytail: add when an outlab sends them.

export type Hl7Result = {
  accession: string; // OBR-2: our accession number, echoed back by the outlab
  code: string; // OBX-3.1: outlab's test code
  value: string; // OBX-5
  unit: string; // OBX-6
  refRange: string; // OBX-7 (informational; we flag using OUR ranges)
  status: string; // OBX-11: F final, C corrected, P preliminary
};

export type Oru = { sendingApp: string; controlId: string; results: Hl7Result[] };

export function parseOru(raw: string): Oru {
  const segs = raw.split(/\r\n|\r|\n/).filter((s) => s.trim()).map((s) => s.split("|"));
  const msh = segs[0];
  if (!msh || msh[0] !== "MSH") throw new Error("Message must start with MSH");
  // MSH-1 is the field separator itself, so MSH-n sits at index n-1
  const type = msh[8] ?? "";
  if (!type.startsWith("ORU^R01")) throw new Error(`Unsupported message type: ${type || "(empty)"}`);
  const controlId = msh[9]?.trim();
  if (!controlId) throw new Error("MSH-10 control id is required");

  const results: Hl7Result[] = [];
  let accession = "";
  for (const f of segs.slice(1)) {
    if (f[0] === "OBR") {
      accession = (f[2] ?? "").split("^")[0].trim();
      if (!accession) throw new Error("OBR-2 accession is required");
    } else if (f[0] === "OBX") {
      if (!accession) throw new Error("OBX before OBR");
      const code = (f[3] ?? "").split("^")[0].trim();
      if (!code) throw new Error("OBX-3 test code is required");
      results.push({
        accession,
        code,
        value: (f[5] ?? "").trim(),
        unit: f[6] ?? "",
        refRange: f[7] ?? "",
        status: f[11] ?? "F",
      });
    }
  }
  if (results.length === 0) throw new Error("No OBX results in message");
  return { sendingApp: (msh[2] ?? "").split("^")[0], controlId, results };
}
