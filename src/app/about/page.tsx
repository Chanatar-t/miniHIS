import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import pkg from "../../../package.json";

export const metadata: Metadata = { title: "โครงสร้างระบบ · Mini HIS" };

// Public on purpose (portfolio): structure only, no patient data — row counts at most.
// In a real hospital this page would sit behind an IT/admin role.

type Col = { name: string; type: string; notnull: number; dflt_value: string | null; pk: number };
type Fk = { table: string; from: string; to: string };

const TABLES: Record<string, { group: string; about: string }> = {
  users: { group: "ผู้ใช้และสิทธิ์", about: "ผู้ใช้ระบบ บทบาท (role) และสิทธิ์อนุมัติค่าอ้างอิง" },
  audit_log: { group: "ผู้ใช้และสิทธิ์", about: "ทุกการเปิดดู/แก้ไข/ถูกปฏิเสธสิทธิ์ ใคร ทำอะไร กับอะไร เมื่อไร (PDPA)" },
  counters: { group: "HIS", about: "เลขรัน HN / VN / Accession / Shipment เพิ่มแบบ atomic" },
  patients: { group: "HIS", about: "ทะเบียนผู้ป่วย HN, เลขบัตรประชาชน (UNIQUE)" },
  visits: { group: "HIS", about: "การมารับบริการแต่ละครั้ง VN + สิทธิการรักษา วันละ 1 ครั้งต่อคน" },
  lab_tests: { group: "รายการตรวจ", about: "แคตตาล็อก test, LOINC, หลอด, ราคา, ปลายทาง, รหัส test ของ Outlab, เปิด/ปิดใช้" },
  test_ranges: { group: "รายการตรวจ", about: "ค่าปกติ/ค่าวิกฤต แยกเพศ-อายุ มีเวอร์ชัน วันเริ่มใช้ ผู้เสนอ ผู้อนุมัติ" },
  lab_orders: { group: "งาน Lab", about: "ใบสั่งตรวจของแพทย์ (STAT/Routine)" },
  lab_order_items: { group: "งาน Lab", about: "1 แถวต่อ 1 test: สถานะ ผล ธง ช่วงค่าที่ใช้ (snapshot) ผู้ลงผล ผู้ verify" },
  specimens: { group: "งาน Lab", about: "หลอดเลือด 1 หลอด = 1 Accession barcode เวลาเก็บ/รับเข้า/reject" },
  outlabs: { group: "Outlab", about: "ห้องปฏิบัติการภายนอก" },
  shipments: { group: "Outlab", about: "ใบนำส่งหลอดให้ Outlab (DRAFT → SENT)" },
  inbound_messages: { group: "Outlab", about: "ข้อความ HL7 ที่รับเข้า เก็บต้นฉบับ กันนำเข้าซ้ำด้วย control id" },
  result_amendments: { group: "คุณภาพและความปลอดภัย", about: "ประวัติการแก้ผลหลังรายงาน ค่าเดิม ค่าใหม่ เหตุผล" },
  critical_notifications: { group: "คุณภาพและความปลอดภัย", about: "บันทึกการแจ้งค่าวิกฤต แจ้งใคร ทางไหน โดยใคร" },
  uat_results: { group: "คุณภาพและความปลอดภัย", about: "ผลทดสอบ UAT จากหน้าคู่มือ" },
};
const GROUPS = ["HIS", "งาน Lab", "รายการตรวจ", "Outlab", "คุณภาพและความปลอดภัย", "ผู้ใช้และสิทธิ์"];

const R = { all: "ทุกบทบาท", pub: "ไม่ต้อง login" };
const ROUTES: { group: string; path: string; what: string; who: string }[] = [
  { group: "ทั่วไป", path: "/login", what: "เข้าสู่ระบบ (เดโม: เลือกผู้ใช้) + แนะนำโปรเจกต์", who: R.pub },
  { group: "ทั่วไป", path: "/about", what: "โครงสร้างระบบ (หน้านี้)", who: R.pub },
  { group: "ทั่วไป", path: "/", what: "พาไปหน้าแรกตามบทบาท", who: R.all },
  { group: "ผู้ป่วย", path: "/patients", what: "ค้นหา (live) แบ่งหน้า เปิด Visit, Visit วันนี้ + สถานะ, ลงทะเบียน (modal)", who: R.all },
  { group: "ผู้ป่วย", path: "/patients/new", what: "ลงทะเบียน (สำรองสำหรับลิงก์ตรง / ไม่มี JS)", who: "CLERK" },
  { group: "ผู้ป่วย", path: "/patients/[hn]", what: "ข้อมูลผู้ป่วย, Visit วันนี้, ผลตรวจครั้งนี้ (+ครั้งก่อน), AI สรุป, ประวัติ", who: R.all + " (CLERK ไม่เห็นค่าผล)" },
  { group: "แพทย์", path: "/visits/[vn]/order", what: "สั่ง Lab: autocomplete, ใช้บ่อย, เตือนสั่งซ้ำ 7 วัน", who: "DOCTOR" },
  { group: "แพทย์", path: "/visits/[vn]/report", what: "ใบรายงานผลรวมทั้ง Visit (พิมพ์ได้)", who: "DOCTOR, LAB" },
  { group: "แพทย์", path: "/reports/[orderId]", what: "ใบรายงานผลรายใบสั่ง + แก้ไขผล (LAB)", who: "DOCTOR, LAB" },
  { group: "Lab", path: "/lab", what: "พาไปขั้นแรกที่มีงานค้าง", who: "LAB" },
  { group: "Lab", path: "/lab/collect", what: "① เก็บสิ่งส่งตรวจ แยกหลอดอัตโนมัติ", who: "LAB" },
  { group: "Lab", path: "/lab/labels/[orderId]", what: "พิมพ์ฉลาก barcode Code128", who: "LAB" },
  { group: "Lab", path: "/lab/receive", what: "② สแกนรับเข้า / Reject → เจาะซ้ำอัตโนมัติ", who: "LAB" },
  { group: "Lab", path: "/lab/shipments", what: "③ สร้างใบนำส่งแยกตาม Outlab", who: "LAB" },
  { group: "Lab", path: "/lab/shipments/[no]", what: "ใบนำส่ง (พิมพ์), เอาหลอดออก, ยืนยันส่ง", who: "LAB" },
  { group: "Lab", path: "/lab/results", what: "④ ลงผล (ธงทันทีขณะพิมพ์) / นำเข้า HL7", who: "LAB" },
  { group: "Lab", path: "/lab/verify", what: "⑤ Verify แบบ four-eyes + บันทึกแจ้งค่าวิกฤต", who: "LAB" },
  { group: "ตั้งค่า", path: "/config", what: "รายการตรวจ + ค่าอ้างอิงที่ใช้อยู่ + รออนุมัติ", who: "LAB" },
  { group: "ตั้งค่า", path: "/config/[code]", what: "เสนอค่าใหม่, ผลกระทบ, อนุมัติ (สิทธิ์อนุมัติ), ประวัติเวอร์ชัน", who: "LAB" },
  { group: "ตั้งค่า", path: "/config/new", what: "เพิ่ม test ใหม่ (ใช้ได้หลังอนุมัติ)", who: "LAB" },
  { group: "ผู้ดูแล", path: "/admin/audit", what: "Audit log กรองตามการกระทำ / HN", who: "ADMIN" },
  { group: "คู่มือ", path: "/guide", what: "คู่มือตามบทบาท + UAT", who: R.pub },
  { group: "คู่มือ", path: "/guide/[role]", what: "ขั้นตอนงาน + test case + บันทึกผลทดสอบ", who: R.pub + " (บันทึกผลต้อง login)" },
  { group: "คู่มือ", path: "/guide/flow", what: "การไหลของข้อมูลและสถานะ (ภาษาคนทั่วไป)", who: R.pub },
  { group: "คู่มือ", path: "/guide/uat", what: "สรุปผล UAT (พิมพ์ได้)", who: R.all },
];

export default function AboutPage() {
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map(
    ({ name }) => ({
      name,
      cols: db.prepare(`PRAGMA table_info(${name})`).all() as Col[],
      fks: db.prepare(`PRAGMA foreign_key_list(${name})`).all() as Fk[],
      rows: (db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get() as { n: number }).n,
    }),
  );
  const sqlite = (db.prepare("SELECT sqlite_version() AS v").get() as { v: string }).v;
  const journal = (db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode;
  const d = pkg.dependencies as Record<string, string>;
  const dev = pkg.devDependencies as Record<string, string>;

  const STACK = [
    ["Runtime", "Node.js", process.version, "รัน Next.js และมี SQLite ในตัว (node:sqlite) ไม่ต้องติดตั้งฐานข้อมูลแยก"],
    ["Framework", "Next.js (App Router)", d.next, "หน้าเว็บ render ที่ server (Server Components) และแก้ข้อมูลผ่าน Server Actions ในโปรเจกต์เดียว"],
    ["UI", "React", d.react, "ส่วนที่ต้องโต้ตอบทันที: live search, modal, ธงผลขณะพิมพ์, autocomplete"],
    ["ภาษา", "TypeScript", dev.typescript, "ตรวจชนิดข้อมูลตอน build"],
    ["Styling", "Tailwind CSS", dev.tailwindcss, "สไตล์ + animation ด้วย CSS และ View Transitions"],
    ["Database", "SQLite (node:sqlite)", `${sqlite} · ${journal.toUpperCase()}`, "ไฟล์เดียว data/his.db, SQL ตรง, transaction BEGIN IMMEDIATE, foreign keys"],
    ["Validation", "Zod", d.zod, "ตรวจทุก input ที่ server ก่อนแตะฐานข้อมูล"],
    ["Barcode", "JsBarcode", d.jsbarcode, "ฉลากหลอดเลือด Code128"],
    ["AI (ไม่บังคับ)", "Claude API (@anthropic-ai/sdk)", d["@anthropic-ai/sdk"], "สรุปผล Lab ให้แพทย์ ส่งเฉพาะข้อมูลที่ลบตัวตนแล้ว ล่มแล้วใช้สรุปแบบกฎ"],
    ["Test", "node:test + smoke (HTTP)", "built-in", "unit test กฎทางการแพทย์ + end-to-end 100+ checks บน DB ชั่วคราว"],
    ["CI", "GitHub Actions", "ci.yml", "lint → unit → build → smoke ทุกครั้งที่ push"],
  ];

  return (
    <div className="space-y-10">
      <section className="rounded-2xl bg-gradient-to-br from-slate-800 via-slate-700 to-teal-800 px-6 py-10 text-white sm:px-10">
        <p className="text-sm text-teal-200">Mini HIS · LIS Outlab</p>
        <h1 className="mt-1 text-3xl font-semibold sm:text-4xl">โครงสร้างระบบ</h1>
        <p className="mt-3 max-w-2xl text-slate-200">เทคโนโลยีที่ใช้, การไหลของ request, ทุกหน้าในระบบ และโครงสร้างฐานข้อมูล ข้อมูลเวอร์ชันและ schema อ่านจากระบบที่รันอยู่จริงทุกครั้งที่เปิดหน้า</p>
        <div className="mt-6 flex flex-wrap gap-3 text-sm">
          {[
            [ROUTES.length, "หน้า"],
            [tables.length, "ตาราง"],
            [tables.reduce((n, t) => n + t.fks.length, 0), "ความสัมพันธ์ (FK)"],
            [Object.keys(d).length, "dependency หลัก"],
          ].map(([n, l]) => (
            <div key={l} className="rounded-xl bg-white/10 px-4 py-2 ring-1 ring-white/20">
              <span className="text-2xl font-semibold">{n}</span> <span className="text-slate-200">{l}</span>
            </div>
          ))}
        </div>
        <nav className="mt-6 flex flex-wrap gap-2 text-sm">
          {[
            ["#arch", "สถาปัตยกรรม"],
            ["#stack", "Server & Stack"],
            ["#request", "เส้นทางของ request"],
            ["#routes", "ทุกหน้า"],
            ["#schema", "Schema"],
            ["#security", "ความปลอดภัย"],
            ["#code", "โครงสร้างโค้ด"],
          ].map(([h, l]) => (
            <a key={h} href={h} className="rounded-full bg-white/15 px-3 py-1 hover:bg-white/25">
              {l}
            </a>
          ))}
        </nav>
      </section>

      {/* architecture */}
      <section id="arch" className="scroll-mt-6 space-y-4">
        <h2 className="text-xl font-semibold">สถาปัตยกรรม</h2>
        <div className="card overflow-x-auto">
          <div className="grid min-w-[760px] grid-cols-[1fr_auto_1.4fr_auto_1fr] items-center gap-3 text-sm">
            <Box title="🖥 เบราว์เซอร์" tone="sky" items={["HTML ที่ render จาก server", "React (client) เฉพาะส่วนโต้ตอบ", "เครื่องสแกน barcode = คีย์บอร์ด", "พิมพ์ฉลาก/ใบนำส่ง/ใบรายงาน"]} />
            <Arrow top="GET หน้า / POST Server Action" bottom="HTML / RSC payload" />
            <Box
              title={`⚙ Next.js ${d.next} บน Node ${process.version}`}
              tone="teal"
              items={["Server Components: query + render", "Server Actions: requireRole → Zod → transaction", "Audit log ทุกการกระทำ", "กฎทางการแพทย์ใน lib/rules.ts (unit test)"]}
            />
            <Arrow top="SQL (prepared) ใน transaction" bottom="rows" />
            <Box title={`🗄 SQLite ${sqlite}`} tone="violet" items={["ไฟล์ data/his.db", `${journal.toUpperCase()} journal`, "Foreign keys, UNIQUE, CHECK", "สร้าง/อัปเกรด schema เองตอนเปิด"]} />
          </div>
          <div className="mt-4 grid min-w-[760px] grid-cols-2 gap-3 text-sm">
            <Box title="🚚 Outlab (ภายนอก)" tone="amber" items={["ส่งผลกลับเป็นไฟล์ HL7 ORU^R01", "นำเข้าที่หน้า ลงผล → แท็บ Outlab", "ระบบติดธงใหม่ด้วยค่าอ้างอิงของเรา"]} />
            <Box title="✨ Claude API (ไม่บังคับ)" tone="slate" items={["เรียกเมื่อแพทย์กดสรุปเท่านั้น", "ส่งเพศ อายุ ผลที่ verify แล้ว ไม่ส่งชื่อ/HN/เลขบัตร", "ไม่มี key หรือล่ม → สรุปแบบกฎ"]} />
          </div>
        </div>
      </section>

      {/* stack */}
      <section id="stack" className="scroll-mt-6 space-y-4">
        <h2 className="text-xl font-semibold">Server & Stack</h2>
        <div className="card overflow-x-auto p-0">
          <table className="table min-w-[760px]">
            <thead>
              <tr>
                <th>ชั้น</th>
                <th>เทคโนโลยี</th>
                <th>เวอร์ชัน</th>
                <th>ใช้ทำอะไร / ทำไม</th>
              </tr>
            </thead>
            <tbody>
              {STACK.map(([layer, tech, ver, why]) => (
                <tr key={layer}>
                  <td className="whitespace-nowrap text-xs font-medium text-slate-500">{layer}</td>
                  <td className="font-medium">{tech}</td>
                  <td className="font-mono text-xs">{ver}</td>
                  <td className="text-sm text-slate-600">{why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500">
          ไม่มี server แยกสำหรับ API และไม่มี database server: เปิด <code className="rounded bg-slate-100 px-1">npm run dev</code> ก็ได้ทั้งระบบ ถ้าขึ้น production จริงจะย้ายไป PostgreSQL และ login ผ่าน SSO ของโรงพยาบาล
        </p>
      </section>

      {/* request lifecycle */}
      <section id="request" className="scroll-mt-6 space-y-4">
        <h2 className="text-xl font-semibold">เกิดอะไรขึ้นเมื่อกดปุ่ม (ตัวอย่าง: สแกนรับหลอดเข้า Lab)</h2>
        <ol className="stagger grid gap-3 md:grid-cols-3 lg:grid-cols-6">
          {[
            ["1", "ฟอร์มส่ง POST", "เบราว์เซอร์เรียก Server Action receiveSpecimen"],
            ["2", "ตรวจสิทธิ์", "requireRole('LAB') อ่าน cookie ที่ลงลายเซ็น HMAC ไม่ผ่าน → /forbidden + DENY ใน audit"],
            ["3", "ตรวจข้อมูล", "Zod / กฎธุรกิจ เช่น หลอดนี้ถูก reject หรือรับไปแล้วหรือยัง"],
            ["4", "Transaction", "BEGIN IMMEDIATE → UPDATE หลอด + test → audit → COMMIT ผิดพลาดตรงไหน rollback ทั้งหมด"],
            ["5", "ตอบกลับ", "redirect พร้อมข้อความ + ขั้นต่อไป หรือคืน error ในฟอร์มโดยข้อมูลไม่หาย"],
            ["6", "Render ใหม่", "Server Components query ใหม่ ส่ง RSC payload กลับ React อัปเดตเฉพาะส่วนที่เปลี่ยน"],
          ].map(([n, t, dsc]) => (
            <li key={n} className="card">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-600 text-sm font-semibold text-white">{n}</span>
              <div className="mt-2 font-semibold">{t}</div>
              <p className="text-xs text-slate-600">{dsc}</p>
            </li>
          ))}
        </ol>
        <p className="text-xs text-slate-500">
          ข้อมูลที่เห็นใน F12 → Network เป็น RSC payload (รูปแบบส่งข้อมูลของ React) ไม่ได้เข้ารหัส ความปลอดภัยจึงอยู่ที่ server ส่งเฉพาะข้อมูลที่ผู้ใช้มีสิทธิ์เห็น และตรวจสิทธิ์ทุก action
        </p>
      </section>

      {/* routes */}
      <section id="routes" className="scroll-mt-6 space-y-4">
        <h2 className="text-xl font-semibold">ทุกหน้าในระบบ ({ROUTES.length})</h2>
        <div className="card overflow-x-auto p-0">
          <table className="table min-w-[760px]">
            <thead>
              <tr>
                <th>กลุ่ม</th>
                <th>เส้นทาง</th>
                <th>ทำอะไร</th>
                <th>ใครเข้าได้</th>
              </tr>
            </thead>
            <tbody>
              {ROUTES.map((r, i) => (
                <tr key={r.path}>
                  <td className="text-xs text-slate-500">{ROUTES[i - 1]?.group === r.group ? "" : r.group}</td>
                  <td className="font-mono text-xs">{r.path}</td>
                  <td className="text-sm">{r.what}</td>
                  <td className="text-xs">
                    <span className={`rounded px-1.5 py-0.5 ${r.who.startsWith(R.pub) ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>{r.who}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500">ทุก Server Action ตรวจสิทธิ์ซ้ำที่ server เสมอ การซ่อนปุ่มในหน้าจอมีไว้เพื่อความสะดวกเท่านั้น</p>
      </section>

      {/* schema */}
      <section id="schema" className="scroll-mt-6 space-y-4">
        <div>
          <h2 className="text-xl font-semibold">Database schema ({tables.length} ตาราง)</h2>
          <p className="text-sm text-slate-500">
            อ่านจากฐานข้อมูลจริงด้วย <code className="rounded bg-slate-100 px-1">PRAGMA table_info</code> / <code className="rounded bg-slate-100 px-1">foreign_key_list</code> ไฟล์ต้นฉบับคือ{" "}
            <code className="rounded bg-slate-100 px-1">db/schema.sql</code>
          </p>
        </div>
        {GROUPS.map((g) => (
          <div key={g} className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{g}</h3>
            <div className="grid gap-4 lg:grid-cols-2">
              {tables
                .filter((t) => (TABLES[t.name]?.group ?? "อื่นๆ") === g)
                .map((t) => (
                  <article key={t.name} id={`t-${t.name}`} className="card scroll-mt-6 space-y-2 p-0">
                    <header className="flex items-baseline gap-2 border-b border-slate-100 px-4 pt-3 pb-2">
                      <span className="font-mono font-semibold">{t.name}</span>
                      <span className="ml-auto text-xs text-slate-400">{t.rows.toLocaleString()} แถว</span>
                    </header>
                    <p className="px-4 text-xs text-slate-600">{TABLES[t.name]?.about}</p>
                    <table className="w-full text-xs">
                      <tbody>
                        {t.cols.map((c) => {
                          const fk = t.fks.find((f) => f.from === c.name);
                          return (
                            <tr key={c.name} className="border-t border-slate-50">
                              <td className="px-4 py-1 font-mono">
                                {c.pk ? "🔑 " : ""}
                                {c.name}
                              </td>
                              <td className="py-1 font-mono text-slate-500">{c.type || "—"}</td>
                              <td className="space-x-1 py-1 pr-4 text-right">
                                {c.notnull && !c.pk ? <span className="rounded bg-slate-100 px-1 text-slate-600">NOT NULL</span> : null}
                                {c.dflt_value && <span className="rounded bg-slate-100 px-1 text-slate-600">= {c.dflt_value.length > 22 ? "…" : c.dflt_value}</span>}
                                {fk && (
                                  <a href={`#t-${fk.table}`} className="rounded bg-violet-50 px-1 text-violet-700 hover:underline">
                                    → {fk.table}.{fk.to ?? "id"}
                                  </a>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </article>
                ))}
            </div>
          </div>
        ))}
      </section>

      {/* security */}
      <section id="security" className="scroll-mt-6 space-y-4">
        <h2 className="text-xl font-semibold">ความปลอดภัยและ PDPA</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {[
            ["สิทธิ์ (RBAC + permission)", "4 บทบาท CLERK / DOCTOR / LAB / ADMIN และสิทธิ์อนุมัติค่าอ้างอิงแยกจากบทบาท ตรวจที่ server ทุกหน้าและทุก action"],
            ["Session", "เดโมเลือกผู้ใช้ไม่มีรหัสผ่าน cookie httpOnly ลงลายเซ็น HMAC-SHA256 ปลอม role ไม่ได้ อายุ 8 ชั่วโมง (1 กะ)"],
            ["ให้ข้อมูลเท่าที่จำเป็น", "เวชระเบียนไม่เห็นค่าผล Lab, รายการค้นหาปิดเลขบัตรบางหลัก, แพทย์ไม่เห็นผลที่ยังไม่ verify"],
            ["Audit log", "บันทึกการเปิดดูผู้ป่วย ใบรายงาน การแก้ผล การใช้ AI การเปลี่ยนค่าอ้างอิง และการถูกปฏิเสธสิทธิ์"],
            ["Four-eyes / maker-checker", "ผู้ลงผล verify เองไม่ได้ ผู้เสนอค่าอ้างอิงอนุมัติเองไม่ได้"],
            ["SQL injection", "ใช้ prepared statement ทุกคำสั่ง ชื่อตารางในหน้านี้มาจาก sqlite_master ไม่ใช่จากผู้ใช้"],
            ["ข้อมูลไม่หาย", "แก้ผลเก็บค่าเดิม, ค่าอ้างอิงมีเวอร์ชัน, ผลเก็บช่วงค่าที่ใช้ตอนนั้น, transaction rollback เมื่อผิดพลาด"],
            ["AI", "ส่งเฉพาะข้อมูลลบตัวตน ตรวจตัวเลขที่ AI เขียนว่ามีในข้อมูลจริง แพทย์อ่านผลจริงก่อนเสมอ"],
          ].map(([t, dsc]) => (
            <div key={t} className="card">
              <div className="font-semibold">{t}</div>
              <p className="mt-1 text-sm text-slate-600">{dsc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* code */}
      <section id="code" className="scroll-mt-6 space-y-4">
        <h2 className="text-xl font-semibold">โครงสร้างโค้ด</h2>
        <pre className="card overflow-x-auto font-mono text-xs leading-relaxed text-slate-700">{`db/schema.sql                 schema ทั้งหมด (IF NOT EXISTS, รันซ้ำได้)
src/lib/
  db.ts                       เปิด DB, transaction, เลขรัน, audit, อัปเกรด DB เก่า
  auth.ts                     session HMAC, requireRole
  rules.ts                    กฎล้วน (unit test): ธงผล, เลขบัตร, แยกหลอด, สถานะใบสั่ง, เลือกค่าอ้างอิง
  ranges.ts                   ค่าอ้างอิงที่ใช้กับผู้ป่วยคนนี้วันนี้
  hl7.ts                      parser HL7 ORU^R01
  ai.ts                       Claude + guardrail + สรุปแบบกฎ
  guide.ts                    เนื้อหาคู่มือ / UAT
src/app/                      หน้าเว็บ (1 โฟลเดอร์ = 1 เส้นทาง) + actions.ts ของแต่ละส่วน
  patients/ visits/ lab/ reports/ config/ admin/ guide/ about/ login/
src/components/               ส่วนที่ใช้ซ้ำ: ตารางผล, ฟอร์ม, ปุ่ม, modal helpers
tests/rules.test.ts           unit test
scripts/smoke.mjs             end-to-end ผ่าน HTTP บน DB ชั่วคราว
.github/workflows/ci.yml      CI`}</pre>
        <p className="text-center text-sm">
          <Link href="/login" className="text-teal-700 hover:underline">
            ← กลับหน้าเข้าสู่ระบบ
          </Link>
          <span className="mx-2 text-slate-300">·</span>
          <Link href="/guide" className="text-teal-700 hover:underline">
            คู่มือการใช้งาน →
          </Link>
        </p>
      </section>
    </div>
  );
}

const TONES = {
  sky: "border-sky-200 bg-sky-50",
  teal: "border-teal-300 bg-teal-50",
  violet: "border-violet-200 bg-violet-50",
  amber: "border-amber-200 bg-amber-50",
  slate: "border-slate-200 bg-slate-50",
};

function Box({ title, items, tone }: { title: string; items: string[]; tone: keyof typeof TONES }) {
  return (
    <div className={`rounded-xl border p-3 ${TONES[tone]}`}>
      <div className="font-semibold">{title}</div>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-slate-600">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  );
}

function Arrow({ top, bottom }: { top: string; bottom: string }) {
  return (
    <div className="flex flex-col items-center text-[11px] text-slate-500">
      <span>{top} →</span>
      <span className="my-1 h-px w-20 bg-slate-300" aria-hidden />
      <span>← {bottom}</span>
    </div>
  );
}
