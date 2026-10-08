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
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
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
  let r = await submit("/patients/new", clerk, 1, { cid: "1234567890123", prefix: "นาย", sex: "M", first_name: "ก", last_name: "ข", dob: "1990-01-01", phone: "" });
  ok(r.status === 200 && one("SELECT COUNT(*) n FROM patients").n === 30, "bad CID checksum rejected");
  r = await submit("/patients/new", clerk, 1, { cid: "1100000000008", prefix: "นาย", sex: "M", first_name: "ก", last_name: "ข", dob: "1990-01-01", phone: "" });
  ok(r.loc.endsWith("/patients/HN0000031"), "register patient -> HN0000031");
  r = await submit("/patients/new", clerk, 1, { cid: "1100000000008", prefix: "นาย", sex: "M", first_name: "ซ้ำ", last_name: "ซ้ำ", dob: "1990-01-01", phone: "" });
  ok(r.status === 200 && one("SELECT COUNT(*) n FROM patients").n === 31, "duplicate CID blocked");
  await submit("/patients/HN0000031", clerk, 1, { scheme: "UC" });
  const vn = one("SELECT vn FROM visits").vn;
  ok(/^VN\d{10}$/.test(vn), `visit opened ${vn}`);
  await submit(`/visits/${vn}/order`, doc, 1, { testId: [4, 5, 3, 2], priority: "STAT", note: "" }); // order 1: TSH FT4 HBA1C CREA
  await submit(`/visits/${vn}/order`, doc, 1, { testId: [6], priority: "ROUTINE", note: "" }); // order 2: VITD
  ok(one("SELECT COUNT(*) n FROM lab_order_items").n === 5, "2 orders, 5 tests");

  console.log("# collect");
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
  let g = await get("/lab/collect", clerk);
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
  ok([1, 2, 3, 4].every((i) => resPage.includes(`name="value_${i}"`)), "worklist: 3 outlab SENT + in-house CREA");
  const creaForm = forms(resPage).find((f) => f.includes('name="value_4"'));
  r = await post("/lab/results", lab, creaForm, { value_4: "12" });
  const crea = one("SELECT status, flag, resulted_by FROM lab_order_items WHERE id = 4");
  ok(r.loc.includes("msg=") && crea.status === "RESULTED" && crea.flag === "HH" && crea.resulted_by === 3, "manual CREA=12 -> HH critical");
  r = await post("/lab/results", lab, creaForm, { value_4: "13" }); // stale form
  ok(r.loc.includes("err=") && one("SELECT value FROM lab_order_items WHERE id = 4").value === "12", "re-submit stale result form -> error, value kept");

  const textarea = (h) => decode(h.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/)?.[1] ?? "");
  const oru = textarea(await html("/lab/results?sample=OUT-A", lab));
  ok(oru.startsWith("MSH|^~\\&|OUT-A") && (oru.match(/OBX/g) || []).length === 3, "sample ORU generated for 3 sent tests");
  const importForm = forms(resPage).find((f) => f.includes('name="raw"'));
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
  const rep = await html("/reports/1", doc);
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
