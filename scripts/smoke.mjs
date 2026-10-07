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
  env: { ...process.env, DB_FILE, SESSION_SECRET: SECRET, NODE_NO_WARNINGS: "1" },
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
const html = (p, c) => get(p, c).then((r) => r.text());
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
