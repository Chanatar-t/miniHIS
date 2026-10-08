// End-to-end smoke test over HTTP, no browser: submits forms exactly like a no-JS browser would.
// Starts its own `next start` on a throwaway DB. Run `npm run build` first.
//   npm run smoke
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const PORT = 3123;
const B = `http://localhost:${PORT}`;
const SECRET = "smoke";
const dir = mkdtempSync(path.join(tmpdir(), "his-smoke-"));
const DB_FILE = path.join(dir, "his.db");

const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], {
  // AI points at a dead port: the test exercises the fallback path and never spends API credits
  env: { ...process.env, DB_FILE, SESSION_SECRET: SECRET, NODE_NO_WARNINGS: "1", ANTHROPIC_API_KEY: "smoke", ANTHROPIC_BASE_URL: "http://127.0.0.1:9" },
  stdio: ["ignore", "ignore", "inherit"],
});
// wait for the server to exit before deleting its DB (Windows keeps the file locked)
const stop = () =>
  new Promise((done) => {
    server.once("exit", () => {
      // KEEP_DB=1 leaves the populated DB behind (useful for screenshots / demo data)
      if (process.env.KEEP_DB) console.log(`DB kept at ${DB_FILE}`);
      else rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      done();
    });
    server.kill();
  });

let fails = 0;
let db; // opened after the server seeds it
const ok = (cond, msg) => {
  if (!cond) fails++;
  console.log(cond ? "PASS" : "FAIL", msg);
};

// ---- helpers
const ck = (id) => `session=${id}.${createHmac("sha256", SECRET).update(String(id)).digest("hex")}`;
const get = (p, c) => fetch(B + p, { headers: { cookie: c }, redirect: "manual" });
// React splits adjacent text with <!-- --> markers; drop them so assertions can match plain text
const html = (p, c) => get(p, c).then((r) => r.text()).then((t) => t.replaceAll("<!-- -->", ""));
const forms = (h) => [...h.matchAll(/<form[^>]*>([\s\S]*?)<\/form>/g)].map((m) => m[1]);
const hidden = (f, onlyActionFields = false) =>
  [...f.matchAll(/<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?/g)]
    .filter(([, n]) => !onlyActionFields || n.startsWith("$ACTION"))
    .map(([, n, v]) => [n, (v ?? "").replaceAll("&quot;", '"').replaceAll("&amp;", "&")]);
const locOf = (r) => decodeURIComponent((r.headers.get("location") ?? "").replaceAll("+", " "));

// POST a form. `form` is the form's inner HTML; `fields` are added/override user inputs.
async function post(page, cookie, form, fields = {}, onlyActionFields = false) {
  const body = new FormData();
  for (const [n, v] of hidden(form, onlyActionFields)) body.append(n, v);
  for (const [k, v] of Object.entries(fields)) [].concat(v).forEach((x) => body.append(k, String(x)));
  const r = await fetch(B + page, { method: "POST", body, headers: { cookie, origin: B }, redirect: "manual" }); // origin: Next checks it (CSRF)
  return { status: r.status, loc: locOf(r) };
}
async function submit(page, cookie, pick, fields = {}) {
  const fs = forms(await html(page, cookie));
  const f = typeof pick === "number" ? fs[pick] : fs.find(pick);
  if (!f) throw new Error(`form not found on ${page}`);
  return post(page, cookie, f, fields);
}

async function main() {
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${B}/login`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  await fetch(`${B}/login`); // first request creates + seeds the DB
  db = new DatabaseSync(DB_FILE);
  const q = (sql, ...a) => db.prepare(sql).all(...a);
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const itemStatus = (id) => one("SELECT status FROM lab_order_items WHERE id = ?", id)?.status;
  const clerk = ck(1), doc = ck(2), lab = ck(3);

  console.log("# registration & ordering");
  let g;
  let r = await submit("/patients/new", clerk, 1, { cid: "1234567890123", prefix: "นาย", sex: "M", first_name: "ก", last_name: "ข", dob: "1990-01-01", phone: "" });
  ok(r.status === 200 && one("SELECT COUNT(*) n FROM patients").n === 30, "bad CID checksum rejected");
  r = await submit("/patients/new", clerk, 1, { cid: "1100000000008", prefix: "นาย", sex: "M", first_name: "ก", last_name: "ข", dob: "1990-01-01", phone: "" });
  ok(r.loc.includes("/patients/HN0000031?registered=1"), "register patient -> HN0000031 with success banner");
  r = await submit("/patients/new", clerk, 1, { cid: "1100000000008", prefix: "นาย", sex: "M", first_name: "ซ้ำ", last_name: "ซ้ำ", dob: "1990-01-01", phone: "" });
  ok(r.status === 200 && one("SELECT COUNT(*) n FROM patients").n === 31, "duplicate CID blocked");
  const isVisitForm = (f) => f.includes('name="scheme"');
  await submit("/patients/HN0000031", clerk, isVisitForm, { scheme: "UC" });
  const vn = one("SELECT vn FROM visits").vn;
  ok(/^VN\d{10}$/.test(vn), `visit opened from patient page ${vn}`);

  console.log("# front desk");
  const deskForms = forms(await html("/patients", clerk));
  const deskRows = ((await html("/patients", clerk)).match(/class="card flex flex-wrap items-center gap-4[^"]*"/g) ?? []).length;
  ok(deskRows === 10 && deskForms.filter(isVisitForm).length >= 5, `desk lists 10 recent patients before typing (got ${deskRows})`);
  const rowsOf = (h) => [...h.matchAll(/class="text-lg[^"]*" href="\/patients\/(HN\d{7})"/g)].map((m) => m[1]);
  const [p1, p2, p4, p99] = await Promise.all(["", "?page=2", "?page=4", "?page=99"].map((s) => html(`/patients${s}`, clerk)));
  ok(rowsOf(p2).length === 10 && !rowsOf(p2).some((hn) => rowsOf(p1).includes(hn)), "page 2 shows the next 10, no overlap");
  ok(rowsOf(p4).length === 1 && p4.includes("แสดง 31–31 จาก 31 คน") && rowsOf(p99).join() === rowsOf(p4).join(), "last page has the remainder; out-of-range page clamps to last");
  const qp = await html("/patients?q=%E0%B8%AA&page=2", clerk); // "ส" matches more than one page
  ok(qp.includes('href="/patients?q=%E0%B8%AA"') && qp.includes('aria-current="page"'), "paging keeps the search text");
  const nf = await html("/patients?q=1100000000024", clerk);
  ok((await html("/patients?q=HN9999999", clerk)).includes("ไม่พบผู้ป่วย") && nf.includes("ลงทะเบียนผู้ป่วยใหม่ ด้วยเลขบัตรนี้") && /<dialog[\s\S]*value="1100000000024"/.test(nf), "not found -> register modal pre-filled with the typed CID");
  r = await submit("/patients?q=1100000000024", clerk, (f) => f.includes('name="first_name"'), { cid: "1100000000024", prefix: "นาง", sex: "F", first_name: "โมดอล", last_name: "ทดสอบ", dob: "1985-05-05", phone: "" });
  ok(r.loc.includes("?registered=1") && one("SELECT COUNT(*) n FROM patients WHERE first_name = 'โมดอล'").n === 1, "register through the modal");
  ok((await html("/patients/new?cid=1100000000024", clerk)).includes('value="1100000000024"'), "registration form pre-filled");
  r = await submit("/patients?q=HN0000005", clerk, isVisitForm, { scheme: "SSS" });
  const vn5 = one("SELECT v.vn FROM visits v JOIN patients p ON p.id = v.patient_id WHERE p.hn = 'HN0000005'")?.vn;
  ok(vn5 && r.loc === `/patients?opened=${vn5}`, "open visit straight from search result -> back to desk with queue banner");
  const desk = await html(`/patients?opened=${vn5}`, clerk);
  ok(desk.includes("เปิด Visit ให้") && desk.includes("คิวที่") && desk.includes("รอซักประวัติ"), "desk shows queue number and today's list");
  ok(!forms(await html("/patients?q=HN0000005", clerk)).some(isVisitForm), "patient with a visit today has no open-visit button");
  r = await submit("/patients?q=HN0000006", clerk, isVisitForm, { scheme: "UC" });
  const staleDesk = forms(await html("/patients?q=HN0000006", clerk)); // already opened: no form, so replay the earlier one
  ok(!staleDesk.some(isVisitForm), "second open hidden in UI");
  const p6 = one("SELECT id FROM patients WHERE hn = 'HN0000006'").id;
  const visitFormAny = forms(await html("/patients?q=HN0000007", clerk)).find(isVisitForm);
  r = await post("/patients", clerk, visitFormAny, { patientId: p6, scheme: "UC", back: "list" }, true);
  ok(r.loc.startsWith("/patients?existed=") && one("SELECT COUNT(*) n FROM visits WHERE patient_id = ?", p6).n === 1, "duplicate visit same day blocked server-side");
  ok((await html("/patients", doc)).includes(`/visits/${vn5}/order`), "doctor's today list links straight to ordering");
  await submit(`/visits/${vn}/order`, doc, 1, { testId: [4, 5, 3, 2], priority: "STAT", note: "" }); // order 1: TSH FT4 HBA1C CREA
  await submit(`/visits/${vn}/order`, doc, 1, { testId: [6], priority: "ROUTINE", note: "" }); // order 2: VITD
  ok(one("SELECT COUNT(*) n FROM lab_order_items").n === 5, "2 orders, 5 tests");

  console.log("# nurse screening");
  const nurse = ck(one("SELECT id FROM users WHERE username = 'nurse'").id);
  const p5 = one("SELECT id FROM patients WHERE hn = 'HN0000005'").id;
  const P5 = "/patients/HN0000005";
  ok((await html("/patients", nurse)).includes(`href="${P5}"`) && (await html(P5, nurse)).includes("vitals-title"), "nurse: today list -> patient page with screening modal");
  ok((await html(P5, nurse)).includes("ยังไม่ได้ซักประวัติแพ้ยา"), "never asked about allergy shows as not asked (not as safe)");
  const isAllergyForm = (f) => f.includes('name="drug"');
  r = await submit(P5, nurse, isAllergyForm, { drug: "Penicillin", reaction: "ผื่น" });
  ok(r.loc.startsWith(`${P5}?msg=`) && one("SELECT COUNT(*) n FROM allergies WHERE patient_id = ?", p5).n === 1, "nurse records a drug allergy");
  r = await submit(P5, nurse, isAllergyForm, { drug: "penicillin", reaction: "" });
  ok(r.loc.includes("err=") && one("SELECT COUNT(*) n FROM allergies WHERE patient_id = ?", p5).n === 1, "same drug twice blocked");
  ok((await html(P5, clerk)).includes("แพ้ยา 1 รายการ"), "allergy banner visible to the front desk too");
  const isVitalsForm = (f) => f.includes('name="sbp"');
  r = await submit(P5, nurse, isVitalsForm, { sbp: "80", dbp: "120", weight: "60", height: "160", cc: "" });
  ok(r.status === 200 && !one("SELECT 1 FROM vitals"), "swapped BP (dbp > sbp) rejected, stays on the form");
  r = await submit(P5, nurse, isVitalsForm, { sbp: "1500", dbp: "90" });
  ok(r.status === 200 && !one("SELECT 1 FROM vitals"), "implausible BP rejected");
  r = await submit(P5, nurse, isVitalsForm, { sbp: "150", dbp: "95", pulse: "88", temp: "36.9", spo2: "98", weight: "70", height: "170", cc: "ปวดหัว" });
  ok(r.loc.startsWith(`${P5}?msg=`), "vitals saved -> patient page");
  const pp = await html(P5, doc);
  ok(pp.includes("BP 150/95") && pp.includes("BMI 24.2 (น้ำหนักเกิน)") && pp.includes("ความดันสูง") && pp.includes("ปวดหัว"), "doctor sees vitals, BMI and BP alert");
  const clerkP5 = await html(P5, clerk);
  ok(!clerkP5.includes("BP 150/95") && !clerkP5.includes("vitals-title"), "front desk sees neither vital signs nor the screening form");
  ok((await html("/patients", doc)).includes("รอพบแพทย์"), "screened visit moves to waiting for doctor");
  const nurseP5 = await html(P5, nurse);
  ok(nurseP5.includes("แก้ซักประวัติ") && nurseP5.includes('value="150"'), "re-open: form pre-filled with today's values");
  const vitalsForm = forms(nurseP5).find(isVitalsForm);
  r = await post(P5, nurse, vitalsForm, { sbp: "130", dbp: "85", weight: "70", height: "170" });
  ok(one("SELECT sbp FROM vitals").sbp === 130 && one("SELECT COUNT(*) n FROM audit_log WHERE entity = 'vitals'").n === 2, "re-measure overwrites, audit keeps both");
  r = await post(P5, clerk, vitalsForm, { vn: vn5, sbp: "100", dbp: "60" }, true);
  ok(r.loc.endsWith("/forbidden") && one("SELECT sbp FROM vitals").sbp === 130, "front desk POSTing vitals directly -> blocked");

  console.log("# collect");
  g = await get("/lab", lab);
  ok(g.status === 200 && (await g.text()).includes("เริ่มที่นี่"), "/lab is an overview page (no redirect: browser back works)");
  for (const step of ["collect", "receive", "shipments", "results", "verify"]) {
    const h = await html(`/lab/${step}`, lab);
    ok(h.includes('href="/lab"') && h.includes("ภาพรวมงาน Lab") && h.includes('aria-label="ขั้นตอนงาน Lab"') && h.includes('aria-current="step"'), `/lab/${step}: back link + step bar with current step`);
  }
  const collectPage = await html("/lab/collect", lab);
  ok(collectPage.indexOf("STAT") < collectPage.indexOf("VITD"), "STAT order listed first");
  const collectForm1 = forms(collectPage).find((f) => f.includes('name="orderId" value="1"'));
  r = await post("/lab/collect", lab, collectForm1);
  ok(r.loc.endsWith("/lab/labels/1"), "collect order 1 -> labels");
  const tubes = q("SELECT accession_no a FROM specimens WHERE order_id = 1").map((x) => x.a);
  ok(tubes.length === 3, `auto-split into 3 tubes ${tubes.join(" ")}`);
  r = await post("/lab/collect", lab, collectForm1); // stale page / double click
  ok(r.status === 303 && one("SELECT COUNT(*) n FROM specimens").n === 3, "double-click collect creates no extra tubes");
  await submit("/lab/collect", lab, (f) => f.includes('name="orderId" value="2"'));
  const vitd = one("SELECT id, accession_no a FROM specimens WHERE order_id = 2");

  const emptyRes = await html("/lab/results", lab);
  ok(emptyRes.includes("ไม่มีผลที่รอคีย์") && emptyRes.includes('href="/lab/receive"') && emptyRes.includes("ยังไม่ได้สแกนรับเข้า"), "empty results page explains why and links to the blocking step");

  console.log("# reject & receive");
  const recvPage = await html("/lab/receive", lab);
  const rejectForm = forms(recvPage).find((f) => f.includes(`name="specimenId" value="${vitd.id}"`));
  r = await post("/lab/receive", lab, rejectForm, { reason: "Hemolyzed" });
  ok(r.loc.includes("msg=") && itemStatus(5) === "REJECTED", "reject before receive (at counter)");
  ok(one("SELECT COUNT(*) n FROM lab_order_items WHERE order_id = 2 AND status = 'ORDERED'").n === 1, "rejected test requeued for recollect");
  r = await post("/lab/receive", lab, rejectForm, { reason: "Clotted" }); // stale page
  ok(r.loc.includes("err=") && one("SELECT reject_reason r FROM specimens WHERE id = ?", vitd.id).r === "Hemolyzed", "double reject -> error, original reason kept");
  ok(one("SELECT COUNT(*) n FROM lab_order_items WHERE order_id = 2").n === 2, "double reject creates no extra requeue");

  const scan = (a) => submit("/lab/receive", lab, (f) => f.includes('name="accession"'), { accession: a });
  r = await scan(vitd.a);
  ok(r.loc.includes("err="), "scan a rejected tube -> error");
  r = await scan(`  ${tubes[0].toLowerCase()} `);
  ok(r.loc.includes("msg="), "scan tolerates spaces / lowercase");
  r = await scan(tubes[0]);
  ok(r.loc.includes("รับเข้าแล้วเมื่อ"), "duplicate scan -> error");
  r = await scan("");
  ok(r.loc.includes("err="), "empty scan -> error");
  for (const a of tubes.slice(1)) await scan(a);
  ok([1, 2, 3, 4].every((i) => itemStatus(i) === "RECEIVED"), "all order-1 tests RECEIVED");

  console.log("# shipments");
  r = await submit("/lab/shipments", lab, (f) => f.includes('name="outlabId" value="2"'));
  ok(r.loc.includes("/lab/shipments?err="), "OUT-B has nothing to ship -> error flash");
  r = await submit("/lab/shipments", lab, (f) => f.includes('name="outlabId" value="1"'));
  const sh1 = r.loc;
  ok(/\/lab\/shipments\/SH\d+$/.test(sh1), `create OUT-A shipment ${sh1}`);
  ok(one("SELECT COUNT(*) n FROM specimens WHERE shipment_id IS NOT NULL").n === 2, "2 OUT-A tubes in it, in-house CREA excluded");
  const shippedId = one("SELECT id FROM specimens WHERE shipment_id IS NOT NULL").id;
  ok(!(await html("/lab/receive", lab)).includes(`name="specimenId" value="${shippedId}"`), "tube in a shipment has no reject button");
  for (let i = 0; i < 2; i++) await submit(sh1, lab, (f) => f.includes("specimenId"));
  ok(one("SELECT COUNT(*) n FROM specimens WHERE shipment_id IS NOT NULL").n === 0, "remove both tubes from draft");
  ok(!(await html(sh1, lab)).includes("ยืนยันส่ง"), "send button hidden on empty draft");

  r = await submit("/lab/shipments", lab, (f) => f.includes('name="outlabId" value="1"'));
  const sh2 = r.loc;
  const manifest = await html(sh2, lab);
  ok(manifest.includes("A-2010") && manifest.includes("A-1102"), "manifest shows outlab test codes");
  const sendForm = forms(manifest).find((f) => f.includes("shipmentNo") && !f.includes("specimenId"));
  r = await post(sh2, lab, sendForm);
  ok(r.loc.includes("msg="), "send shipment");
  r = await post(sh2, lab, sendForm); // double click
  ok(r.loc.includes("ส่งไปแล้ว"), "second send -> error flash, not 500");
  ok([1, 2, 3].every((i) => itemStatus(i) === "SENT") && itemStatus(4) === "RECEIVED", "TSH FT4 HBA1C SENT, CREA stays in-house");

  console.log("# access control");
  g = await get("/lab/collect", clerk);
  ok(g.status === 307 && g.headers.get("location").endsWith("/forbidden"), "clerk opens lab page -> /forbidden");
  const before = one("SELECT COUNT(*) n FROM specimens").n;
  const fakeCollect = forms(await html("/lab/collect", lab)).find((f) => f.includes("orderId"));
  r = await post("/lab/collect", clerk, fakeCollect, { orderId: 2 }, true);
  ok(r.loc.endsWith("/forbidden") && one("SELECT COUNT(*) n FROM specimens").n === before, "clerk POSTs lab action directly -> blocked");
  r = await post("/lab/collect", "session=3.forged", fakeCollect, { orderId: 2 }, true);
  ok(r.loc.endsWith("/login") && one("SELECT COUNT(*) n FROM specimens").n === before, "forged cookie -> /login");
  ok(one("SELECT COUNT(*) n FROM audit_log WHERE action = 'DENY'").n >= 2, "denied attempts are audited");

  console.log("# results");
  const lab2 = ck(5);
  const decode = (s) => s.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&amp;", "&");
  let resPage = await html("/lab/results", lab);
  const outPage = await html("/lab/results?tab=out", lab);
  ok(resPage.includes(`name="value_4"`) && !resPage.includes(`name="value_1"`) && [1, 2, 3].every((i) => outPage.includes(`name="value_${i}"`)), "results split: in-house CREA tab, 3 outlab SENT on the outlab tab");
  ok(resPage.includes("ลงผล / รับผล") && /aria-current="step"/.test(resPage), "lab pipeline bar marks the current step");
  ok(resPage.includes("กำหนดได้ผล") && !resPage.includes("เกินกำหนด"), "same-day in-house test is not flagged overdue right after collection");
  const creaForm = forms(resPage).find((f) => f.includes('name="value_4"'));
  r = await post("/lab/results", lab, creaForm, { value_4: "12" });
  const crea = one("SELECT status, flag, resulted_by FROM lab_order_items WHERE id = 4");
  ok(r.loc.includes("msg=") && crea.status === "RESULTED" && crea.flag === "HH" && crea.resulted_by === 3, "manual CREA=12 -> HH critical");
  const docView = await html("/patients/HN0000031", doc);
  ok(docView.includes("รอ Verify") && !docView.includes("HH วิกฤต"), "UAT-DOC-05: doctor sees 'waiting for verify', not the unverified value");
  r = await post("/lab/results", lab, creaForm, { value_4: "13" }); // stale form
  ok(r.loc.includes("err=") && one("SELECT value FROM lab_order_items WHERE id = 4").value === "12", "re-submit stale result form -> error, value kept");

  const textarea = (h) => decode(h.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/)?.[1] ?? "");
  const oru = textarea(await html("/lab/results?tab=out&sample=OUT-A", lab));
  ok(oru.startsWith("MSH|^~\\&|OUT-A") && (oru.match(/OBX/g) || []).length === 3, "sample ORU generated for 3 sent tests");
  const importForm = forms(outPage).find((f) => f.includes('name="raw"'));
  r = await post("/lab/results", lab, importForm, { raw: oru });
  ok(r.loc.includes("msg=") && r.loc.includes("3 ผล"), "import HL7: " + r.loc.split("msg=")[1]);
  const tsh = one("SELECT status, flag, resulted_by, message_id FROM lab_order_items WHERE id = 1");
  ok(tsh.status === "RESULTED" && tsh.flag === "H" && tsh.resulted_by === null && tsh.message_id, "TSH from HL7: RESULTED, flagged H by our range, source recorded");
  r = await post("/lab/results", lab, importForm, { raw: oru });
  ok(r.loc.includes("เคย import แล้ว"), "same message again -> idempotent, rejected");
  const spoof = oru.replace("|OUT-A|OUT-A|", "|OUT-B|OUT-B|").replace(/\|ORU\^R01\|[^|]+\|/, "|ORU^R01|SPOOF1|");
  r = await post("/lab/results", lab, importForm, { raw: spoof });
  ok(r.loc.includes("err=") && !one("SELECT 1 x FROM inbound_messages WHERE control_id = 'SPOOF1'"), "OUT-B cannot post OUT-A results; nothing stored");
  r = await post("/lab/results", lab, importForm, { raw: "hello" });
  ok(r.loc.includes("HL7 ไม่ถูกต้อง"), "garbage HL7 -> error");

  console.log("# verify (four-eyes, critical)");
  const verifyPage = await html("/lab/verify", lab);
  ok(verifyPage.includes("four-eyes") && !forms(verifyPage).some((f) => f.includes("Verify และรายงานผล")), "own result: no verify button for lab");
  const verifyForm = forms(await html("/lab/verify", lab2)).find((f) => f.includes('name="itemId"'));
  r = await post("/lab/verify", lab, verifyForm, { notifiedTo: "x", method: "โทรศัพท์" });
  ok(r.loc.includes("four-eyes") && itemStatus(4) === "RESULTED", "lab verifying own CREA -> blocked");
  r = await post("/lab/verify", lab2, verifyForm, { method: "โทรศัพท์" });
  ok(r.loc.includes("ค่าวิกฤต") && itemStatus(4) === "RESULTED", "critical without notification -> blocked");
  r = await post("/lab/verify", lab2, verifyForm, { notifiedTo: "นพ.ธนา", method: "โทรศัพท์" });
  ok([1, 2, 3, 4].every((i) => itemStatus(i) === "VERIFIED"), "lab2 verifies order 1");
  ok(one("SELECT COUNT(*) n FROM critical_notifications WHERE item_id = 4 AND notified_to = 'นพ.ธนา'").n === 1, "critical call logged");
  r = await post("/lab/verify", lab2, verifyForm, { notifiedTo: "x", method: "โทรศัพท์" });
  ok(r.loc.includes("err="), "verify twice -> error");

  console.log("# report & amend");
  const pt = await html("/patients/HN0000031", doc);
  ok(pt.includes("HH วิกฤต") && pt.includes('href="/reports/1"'), "doctor sees verified critical result + report link");
  ok((pt.match(/รายงานผลครบ/g) || []).length >= 1, "patient page shows derived order status (order 1 complete)");
  const clerkView = await html("/patients/HN0000031", clerk);
  ok(!clerkView.includes("HH วิกฤต") && !clerkView.includes("/reports/1") && clerkView.includes("ตรวจ Lab 5 รายการ"), "front desk sees visit + test count, not lab values");
  const rep = await html("/reports/1", doc);
  ok(rep.includes("รายงานผลครบ"), "report header shows order status");
  ok(rep.includes("แจ้ง นพ.ธนา ทางโทรศัพท์") && rep.includes("LOINC 3016-3"), "report shows critical notification and LOINC");
  ok(one("SELECT COUNT(*) n FROM audit_log WHERE action = 'VIEW' AND entity = 'lab_report'").n >= 1, "report view audited");
  const amendForm = forms(await html("/reports/1", lab2)).find((f) => f.includes('name="itemId" value="1"'));
  r = await post("/reports/1", lab2, amendForm, { value: "2.1", reason: "" });
  ok(r.loc.includes("เหตุผล"), "amend without reason -> blocked");
  const oldTsh = one("SELECT value FROM lab_order_items WHERE id = 1").value;
  r = await post("/reports/1", lab2, amendForm, { value: "2.1", reason: "outlab แจ้งแก้ผล" });
  const am = one("SELECT old_value, new_value FROM result_amendments WHERE item_id = 1");
  ok(am?.old_value === oldTsh && am.new_value === "2.1" && one("SELECT flag FROM lab_order_items WHERE id = 1").flag === "N", `amend TSH ${oldTsh} -> 2.1, old kept, re-flagged N`);
  ok((await get("/reports/1", clerk)).headers.get("location")?.endsWith("/forbidden"), "clerk cannot open lab report");

  console.log("# results first, AI optional");
  const docPt = await html("/patients/HN0000031", doc);
  const resultsAt = docPt.indexOf("ผลตรวจครั้งนี้"), aiAt = docPt.indexOf("ตัวช่วยสรุปด้วย AI");
  ok(resultsAt > 0 && aiAt > resultsAt && docPt.includes("ไม่บังคับ"), "patient page: real results come first, AI is below and marked optional");
  ok(/<details[^>]*>[\s\S]*ตัวช่วยสรุปด้วย AI/.test(docPt) && !/<details[^>]*open/.test(docPt.slice(aiAt - 400, aiAt)), "AI helper is collapsed by default");
  ok(docPt.includes(`/visits/${vn}/report`) && docPt.includes("4/5") && docPt.includes(">2.1<"), "this-visit table shows verified values and links to the visit report");
  const vrep = await html(`/visits/${vn}/report`, doc);
  ok(vrep.includes("รายงานแล้ว 4/5") && vrep.includes("HH วิกฤต") && vrep.includes("(แก้ไข)") && vrep.includes("แจ้ง นพ.ธนา"), "visit report: all orders, flags, amendment mark, critical call log");
  ok(!vrep.includes(">12.6<") && vrep.includes("12.6 → 2.1"), "visit report shows the amended value, old value only in history");
  ok((await get(`/visits/${vn}/report`, clerk)).headers.get("location")?.endsWith("/forbidden"), "clerk cannot open the visit report");

  console.log("# AI summary & audit");
  const aiForm = forms(await html("/patients/HN0000031", doc)).find((f) => f.includes("สรุปด้วย AI"));
  ok(aiForm, "doctor sees AI summary button");
  ok(!(await html("/patients/HN0000031", lab)).includes("สรุปด้วย AI"), "lab does not");
  const aiBody = new FormData();
  for (const [n, v] of hidden(aiForm)) aiBody.append(n, v);
  // useActionState form without JS: Next re-renders the page with the action's returned state
  const aiRes = await fetch(`${B}/patients/HN0000031`, { method: "POST", body: aiBody, headers: { cookie: doc, origin: B } });
  const aiHtml = (await aiRes.text()).replaceAll("<!-- -->", "");
  ok(aiHtml.includes("สรุปแบบกฎ") && aiHtml.includes("CREA"), "AI unavailable -> rule-based summary still shown");
  const aiAudit = one("SELECT detail FROM audit_log WHERE action = 'AI_SUMMARY'");
  ok(aiAudit && !aiAudit.detail.includes("HN") && aiAudit.detail.includes("4 results"), "AI use audited without patient content: " + aiAudit?.detail);
  const audit = await html("/admin/audit?hn=HN0000031", ck(4));
  ok(audit.includes("AI_SUMMARY") && audit.includes("VIEW") && !audit.includes("HN0000002"), "admin filters audit by patient HN");
  ok((await get("/admin/audit", doc)).headers.get("location")?.endsWith("/forbidden"), "doctor cannot open audit log");

  console.log("# guide & UAT");
  let gp = await get("/guide");
  ok(gp.status === 200 && (await gp.text()).includes("คู่มือการใช้งานและทดสอบระบบ"), "guide is public (no login)");
  ok((await html("/guide/lab")).includes("เพื่อบันทึกผลการทดสอบ"), "anonymous reader sees guide but not the UAT form");
  ok((await get("/guide/nope")).status === 404, "unknown guide -> 404");
  const ng = await html("/guide/nurse");
  ok(ng.includes("ซักประวัติผู้ป่วยในคิว") && ng.includes("UAT-NUR-08") && (await html("/guide")).includes("ซักประวัติ + แพ้ยา"), "nurse guide + UAT cases + flow step render");
  const tryForm = forms(await html("/guide/lab")).find((f) => f.includes('name="userId" value="3"'));
  const tr = await fetch(`${B}/guide/lab`, { method: "POST", body: (() => { const b = new FormData(); for (const [n, v] of hidden(tryForm)) b.append(n, v); return b; })(), headers: { origin: B }, redirect: "manual" });
  ok(tr.headers.get("location")?.endsWith("/lab/collect") && (tr.headers.get("set-cookie") ?? "").includes("session=3."), "'try as' logs in as lab and opens the first task page");
  const evil = new FormData();
  for (const [n, v] of hidden(tryForm, true)) evil.append(n, v);
  evil.append("userId", "4");
  evil.append("href", "//evil.example");
  const ev = await fetch(`${B}/guide/lab`, { method: "POST", body: evil, headers: { origin: B }, redirect: "manual" });
  ok(!(ev.headers.get("location") ?? "").includes("evil"), "'try as' refuses open redirect");
  const uatForm = forms(await html("/guide/lab", lab2)).find((f) => f.includes('value="UAT-LAB-02"'));
  r = await post("/guide/lab", lab2, uatForm, { status: "FAIL", note: "ไม่ขึ้นแถบแดง" });
  ok(r.loc.includes("/guide/lab?saved=UAT-LAB-02"), "record UAT result");
  r = await post("/guide/lab", lab2, uatForm, { status: "PASS", note: "" });
  const uat = await html("/guide/uat", lab2);
  ok(one("SELECT COUNT(*) n FROM uat_results WHERE case_id = 'UAT-LAB-02'").n === 2 && !uat.includes("ต้องแก้ไข ("), "re-test PASS supersedes FAIL; history kept");
  r = await post("/guide/lab", lab2, uatForm, { caseId: "UAT-FAKE-99", status: "PASS" }, true);
  ok(one("SELECT COUNT(*) n FROM uat_results").n === 2, "unknown case id rejected");

  const flow = await get("/guide/flow");
  ok(flow.status === 200 && (await flow.text()).includes("สถานะของทั้งใบสั่ง"), "status/flow explainer is public");

  console.log("# reference ranges (versioned, maker-checker)");
  const path = ck(6); // pathologist: LAB + can approve
  ok((await get("/config", doc)).headers.get("location")?.endsWith("/forbidden"), "doctor cannot open range configuration");
  const cfg = await html("/config", lab);
  ok(cfg.includes("CREA") && cfg.includes("หญิง · ทุกอายุ") && cfg.includes("0.5 - 0.9"), "config lists sex-specific CREA ranges");
  // female patient: CREA flagged with the female range and the range is stored with the result
  await submit("/patients/HN0000002", clerk, isVisitForm, { scheme: "UC" });
  const vnF = one("SELECT v.vn FROM visits v JOIN patients p ON p.id = v.patient_id WHERE p.hn = 'HN0000002'").vn;
  await submit(`/visits/${vnF}/order`, doc, 1, { testId: [2], priority: "ROUTINE", note: "" });
  const ordF = one("SELECT max(id) id FROM lab_orders").id;
  await submit("/lab/collect", lab, (f) => f.includes(`name="orderId" value="${ordF}"`));
  await scan(one("SELECT accession_no a FROM specimens WHERE order_id = ?", ordF).a);
  const itemF = one("SELECT id FROM lab_order_items WHERE order_id = ?", ordF).id;
  ok((await html("/lab/results", lab)).includes("ปกติ 0.5 - 0.9"), "result entry shows the patient's own (female) range");
  r = await submit("/lab/results", lab, (f) => f.includes(`name="value_${itemF}"`), { [`value_${itemF}`]: "1.0" });
  let snapF = one("SELECT flag, ref_low, ref_high FROM lab_order_items WHERE id = ?", itemF);
  ok(snapF.flag === "H" && snapF.ref_high === 0.9, "CREA 1.0 in a woman -> H (0.5-0.9); range stored with the result");
  await post("/lab/verify", lab2, forms(await html("/lab/verify", lab2)).find((f) => f.includes(`name="itemId" value="${itemF}"`)));
  ok(one("SELECT status FROM lab_order_items WHERE id = ?", itemF).status === "VERIFIED", "female CREA verified (impact analysis uses verified results)");
  // propose a revised female range
  const proposeForm = (h) => forms(h).find((f) => f.includes('name="reason"'));
  r = await post("/config/CREA", lab, proposeForm(await html("/config/CREA", lab)), { sex: "F", age_min: "", age_max: "", ref_low: "0.9", ref_high: "0.5", crit_low: "", crit_high: "10", effective_from: new Date().toLocaleDateString("sv-SE"), reason: "ทดสอบค่าผิด" });
  ok(r.status === 200 && one("SELECT COUNT(*) n FROM test_ranges WHERE status = 'PENDING'").n === 0, "invalid proposal (low > high) rejected, nothing stored");
  r = await post("/config/CREA", lab, proposeForm(await html("/config/CREA", lab)), { sex: "F", age_min: "", age_max: "", ref_low: "0.45", ref_high: "1.05", crit_low: "", crit_high: "10", effective_from: new Date().toLocaleDateString("sv-SE"), reason: "ปรับตามคู่มือน้ำยาล็อตใหม่ 2026" });
  const prop = one("SELECT id, status FROM test_ranges WHERE status = 'PENDING'");
  ok(r.loc.includes("/config/CREA?msg=") && prop, "lab proposes a new female range -> pending");
  const crPage = await html("/config/CREA", path);
  ok(crPage.includes("ธงเปลี่ยน 1 ผล") && crPage.includes("H → ปกติ: 1"), "approver sees impact: last result would go H -> normal");
  const reviewOf = (h) => forms(h).find((f) => f.includes(`name="rangeId" value="${prop.id}"`));
  ok(!reviewOf(await html("/config/CREA", lab)), "proposer gets no approve button");
  const rv = reviewOf(crPage);
  r = await post("/config/CREA", lab, rv, { decision: "APPROVED" });
  ok(r.loc.includes("err=") && one("SELECT status FROM test_ranges WHERE id = ?", prop.id).status === "PENDING", "lab without permission cannot approve");
  r = await post("/config/CREA", lab2, rv, { decision: "REJECTED", note: "" });
  ok(r.loc.includes("err="), "reject needs a reason (and lab2 has no permission anyway)");
  r = await post("/config/CREA", path, rv, { decision: "APPROVED" });
  ok(one("SELECT status FROM test_ranges WHERE id = ?", prop.id).status === "APPROVED", "pathologist approves");
  ok((await html("/config/CREA", path)).includes("ถูกแทนที่"), "old female range kept in history as superseded");
  snapF = one("SELECT flag, ref_low, ref_high FROM lab_order_items WHERE id = ?", itemF);
  ok(snapF.flag === "H" && snapF.ref_high === 0.9, "existing result unchanged after the revision (still H, 0.5-0.9)");
  ok(one("SELECT COUNT(*) n FROM audit_log WHERE action IN ('PROPOSE_RANGE','APPROVE_RANGE')").n === 2, "proposal and approval audited");
  // new test: not orderable until its first range is approved
  r = await post("/config/new", lab, forms(await html("/config/new", lab)).find((f) => f.includes('name="code"')), {
    code: "k", name: "Potassium", loinc: "2823-3", specimen_type: "Serum", container: "Red top", unit: "mmol/L", price: "60",
    outlab_id: "", outlab_code: "", outlab_cost: "", tat_days: "0", ref_low: "3.5", ref_high: "5.1", crit_low: "2.5", crit_high: "6.5",
    effective_from: new Date().toLocaleDateString("sv-SE"), reason: "เปิดบริการตรวจใหม่",
  });
  const kTest = one("SELECT id, active FROM lab_tests WHERE code = 'K'");
  ok(r.loc.startsWith("/config/K") && kTest?.active === 0, "new test K created, inactive");
  ok(!(await html(`/visits/${vnF}/order`, doc)).includes("Potassium"), "inactive test hidden from ordering");
  await post(`/visits/${vnF}/order`, doc, forms(await html(`/visits/${vnF}/order`, doc))[1], { testId: [kTest.id], priority: "ROUTINE", note: "" });
  ok(one("SELECT COUNT(*) n FROM lab_order_items WHERE test_id = ?", kTest.id).n === 0, "ordering an inactive test directly is refused");
  const kr = one("SELECT id FROM test_ranges WHERE test_id = ?", kTest.id).id;
  await post("/config/K", path, forms(await html("/config/K", path)).find((f) => f.includes(`name="rangeId" value="${kr}"`)), { decision: "APPROVED" });
  ok(one("SELECT active FROM lab_tests WHERE id = ?", kTest.id).active === 1 && (await html(`/visits/${vnF}/order`, doc)).includes("Potassium"), "approving its first range makes K orderable");

  console.log("# project pages");
  const lg = await html("/login");
  ok(lg.includes("Mini HIS · LIS Outlab") && lg.includes('href="/about"') && lg.includes("อนุมัติค่าอ้างอิง"), "login page explains the project, links to the structure page");
  const ab = await get("/about");
  const abHtml = (await ab.text()).replaceAll("<!-- -->", "");
  ok(ab.status === 200 && ["lab_order_items", "test_ranges", "→ lab_orders.id", "/lab/verify", "Database schema"].every((s) => abHtml.includes(s)), "/about is public and shows live schema, routes and stack");
  ok(!abHtml.includes("1100000000008") && !abHtml.includes("นายก ข"), "/about exposes no patient data");

  console.log("# not found");
  g = await get("/patients/HN9999999", doc);
  ok(g.status === 404 && (await g.text()).includes("ไม่พบข้อมูล"), "unknown HN -> Thai 404");
  ok((await get("/lab/labels/abc", lab)).status === 404, "labels of bad order id -> 404");
  ok((await get("/lab/shipments/SHXXX", lab)).status === 404, "unknown shipment -> 404");


}

main()
  .catch((e) => {
    fails++;
    console.error(e);
  })
  .finally(async () => {
    db?.close();
    await stop();
    console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
    process.exitCode = fails ? 1 : 0;
  });
