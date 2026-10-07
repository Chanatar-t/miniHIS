import type { DatabaseSync } from "node:sqlite";
import { cidCheckDigit } from "./rules";

// All data is fictional.
export function seed(db: DatabaseSync) {
  const users = [
    ["clerk", "สมใจ เวชระเบียน", "CLERK"],
    ["doctor", "นพ.ธนา ใจดี", "DOCTOR"],
    ["lab", "นางสาวพิมพ์ แล็บ", "LAB"],
    ["admin", "ผู้ดูแลระบบ", "ADMIN"],
  ];
  const insUser = db.prepare("INSERT INTO users(username, name, role) VALUES (?, ?, ?)");
  for (const u of users) insUser.run(...u);

  const insOutlab = db.prepare("INSERT INTO outlabs(code, name) VALUES (?, ?)");
  const labA = insOutlab.run("OUT-A", "Outlab A (Central Reference Lab)").lastInsertRowid;
  const labB = insOutlab.run("OUT-B", "Outlab B (Specialty Lab)").lastInsertRowid;

  // code, name, loinc, specimen, container, unit, refL, refH, critL, critH, price, outlab, outlabCode, cost, tat
  const tests: unknown[][] = [
    ["FBS", "Fasting Blood Sugar", "1558-6", "Plasma", "Gray top (NaF)", "mg/dL", 70, 100, 40, 500, 40, null, null, null, 0],
    ["CREA", "Creatinine", "2160-0", "Serum", "Red top", "mg/dL", 0.7, 1.2, null, 10, 50, null, null, null, 0],
    ["HBA1C", "Hemoglobin A1c", "4548-4", "Whole blood", "Lavender top (EDTA)", "%", 4, 6, null, null, 180, labA, "A-1102", 90, 1],
    ["TSH", "Thyroid Stimulating Hormone", "3016-3", "Serum", "Red top", "mIU/L", 0.27, 4.2, null, null, 250, labA, "A-2010", 120, 2],
    ["FT4", "Free T4", "3024-7", "Serum", "Red top", "ng/dL", 0.93, 1.7, null, null, 250, labA, "A-2011", 120, 2],
    ["VITD", "Vitamin D (25-OH)", "1989-3", "Serum", "Red top", "ng/mL", 30, 100, null, null, 900, labB, "B-5501", 550, 5],
    ["PSA", "Prostate Specific Antigen", "2857-1", "Serum", "Red top", "ng/mL", 0, 4, null, null, 450, labA, "A-3301", 220, 2],
    ["CEA", "Carcinoembryonic Antigen", "2039-6", "Serum", "Red top", "ng/mL", 0, 5, null, null, 450, labA, "A-3302", 220, 2],
    ["AFP", "Alpha-Fetoprotein", "1834-1", "Serum", "Red top", "ng/mL", 0, 7, null, null, 450, labA, "A-3303", 220, 2],
    ["FERR", "Ferritin", "2276-4", "Serum", "Red top", "ng/mL", 30, 400, null, null, 400, labB, "B-4410", 200, 3],
    ["B12", "Vitamin B12", "2132-9", "Serum", "Red top", "pg/mL", 197, 771, null, null, 500, labB, "B-4420", 260, 3],
  ];
  const insTest = db.prepare(
    `INSERT INTO lab_tests(code, name, loinc, specimen_type, container, unit, ref_low, ref_high, crit_low, crit_high,
       price, outlab_id, outlab_code, outlab_cost, tat_days) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  for (const t of tests) insTest.run(...(t as never[]));

  const first = ["สมชาย", "สมหญิง", "วิชัย", "มาลี", "ประเสริฐ", "อรุณี", "สุรชัย", "กมลา", "ธีรพงษ์", "นงลักษณ์"];
  const last = ["ใจดี", "รักไทย", "ศรีสุข", "บุญมา", "แก้วกล้า", "ทองดี", "มั่นคง", "สายใจ"];
  const insPatient = db.prepare(
    "INSERT INTO patients(hn, cid, prefix, first_name, last_name, dob, sex, phone) VALUES (?,?,?,?,?,?,?,?)",
  );
  for (let i = 0; i < 30; i++) {
    const sex = i % 2 === 0 ? "M" : "F";
    const cid12 = "1" + String(100000000000 + i * 7919).slice(1);
    const year = 1950 + ((i * 7) % 55);
    insPatient.run(
      `HN${String(i + 1).padStart(7, "0")}`,
      cid12 + cidCheckDigit(cid12),
      sex === "M" ? "นาย" : "นาง",
      first[i % first.length],
      last[i % last.length],
      `${year}-${String((i % 12) + 1).padStart(2, "0")}-15`,
      sex,
      `08${String(10000000 + i * 1234567).slice(0, 8)}`,
    );
  }
  db.prepare("INSERT INTO counters(name, value) VALUES ('HN', 30)").run();
}
