import { BadgeCheck, BookOpen, Blocks, FileInput, ShieldCheck, SlidersHorizontal, Stethoscope, TestTubeDiagonal, Workflow } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db, audit } from "@/lib/db";
import { login } from "@/lib/auth";

type U = { id: number; name: string; role: string; can_approve_config: number };

async function signIn(formData: FormData) {
  "use server";
  const id = Number(formData.get("userId"));
  if (!db.prepare("SELECT 1 FROM users WHERE id = ?").get(id)) throw new Error("Unknown user");
  await login(id);
  audit(db, id, "LOGIN", "user", id);
  redirect("/");
}

const ROLE: Record<string, { label: string; does: string; cls: string }> = {
  CLERK: { label: "เวชระเบียน", does: "ค้นหา/ลงทะเบียนผู้ป่วย เปิด Visit ออกเลขคิว", cls: "bg-sky-100 text-sky-800" },
  NURSE: { label: "พยาบาลคัดกรอง", does: "ซักประวัติ: ประวัติแพ้ยา ความดัน ชีพจร น้ำหนัก ส่วนสูง อาการสำคัญ", cls: "bg-amber-100 text-amber-800" },
  DOCTOR: { label: "แพทย์", does: "สั่ง Lab อ่านผลเทียบครั้งก่อน ใบรายงาน AI สรุป (ไม่บังคับ)", cls: "bg-teal-100 text-teal-800" },
  LAB: { label: "ห้อง Lab", does: "เก็บ → รับเข้า → ส่ง Outlab → ลงผล/HL7 → Verify", cls: "bg-violet-100 text-violet-800" },
  ADMIN: { label: "ผู้ดูแลระบบ", does: "Audit log: ใครเปิดดู/แก้ข้อมูลผู้ป่วยคนไหน", cls: "bg-slate-200 text-slate-700" },
};

const FLOW = ["ลงทะเบียน", "เปิด Visit", "ซักประวัติ", "แพทย์สั่ง Lab", "เจาะเลือด + barcode", "รับเข้า Lab", "ส่ง Outlab", "ผล HL7", "Verify 2 คน", "แพทย์อ่านผล"];

const HIGHLIGHTS = [
  [TestTubeDiagonal, "ตามรอยทุกหลอด", "Accession barcode, แยกหลอดอัตโนมัติ, ใบนำส่งแยกตาม Outlab, reject แล้วเจาะซ้ำให้เอง"],
  [FileInput, "รับผลจาก Outlab (HL7)", "จับคู่ด้วย Accession + รหัส test ของ Outlab, นำเข้าซ้ำไม่ได้, ติดธงด้วยค่าอ้างอิงของเราเอง"],
  [BadgeCheck, "ความปลอดภัยของผู้ป่วย", "Verify แบบ four-eyes, ค่าวิกฤตต้องบันทึกการแจ้ง, แพทย์ไม่เห็นผลที่ยังไม่ตรวจทาน"],
  [SlidersHorizontal, "ค่าอ้างอิงมีเวอร์ชัน", "แยกเพศ/อายุ, เสนอ → ดูผลกระทบ → อนุมัติโดยพยาธิแพทย์, ผลเก่าไม่เปลี่ยนตาม"],
  [Stethoscope, "แพทย์อ่านค่าจริงก่อน", "ผลครั้งนี้เทียบครั้งก่อน ↑↓, ใบรายงานรวมทั้ง Visit, AI เป็นตัวช่วยที่พับไว้"],
  [ShieldCheck, "PDPA & Audit", "สิทธิ์ตามบทบาทตรวจที่ server, ให้ข้อมูลเท่าที่จำเป็น, บันทึกทุกการเปิดดู"],
] as const;

export default function LoginPage() {
  const users = db.prepare("SELECT id, name, role, can_approve_config FROM users ORDER BY id").all() as U[];
  return (
    <div className="grid items-start gap-8 lg:grid-cols-[1.35fr_1fr]">
      {/* about the project */}
      <section className="space-y-6">
        <div>
          <p className="text-sm font-medium text-teal-700">Portfolio project · ข้อมูลทั้งหมดเป็นข้อมูลสมมติ</p>
          <h1 className="mt-1 text-3xl font-semibold sm:text-4xl">Mini HIS · LIS Outlab</h1>
          <p className="mt-3 text-slate-600">
            ระบบโรงพยาบาลขนาดเล็กที่เน้น <b>งานห้องปฏิบัติการส่งตรวจภายนอก (Outlab)</b> ครบวงจร ตั้งแต่ลงทะเบียนผู้ป่วย แพทย์สั่ง Lab เจาะเลือด ส่งหลอดให้ Outlab
            รับผลกลับทาง HL7 ตรวจทานโดยเจ้าหน้าที่สองคน จนแพทย์อ่านผลและพิมพ์ใบรายงาน
          </p>
          <p className="mt-2 text-sm text-slate-500">
            โจทย์จากงานจริง: ช่วงที่หลอดเลือดออกจากโรงพยาบาลไปแล้วคือจุดที่ข้อมูลหายง่ายที่สุด หลอดอยู่ไหน ส่งไปกับใบไหน ผลกลับมาครบหรือยัง ตรงกับหลอดไหน
          </p>
        </div>

        <ol className="stagger flex flex-wrap items-center gap-1.5 text-xs">
          {FLOW.map((s, i) => (
            <li key={s} className="flex items-center gap-1.5">
              <span className="rounded-full bg-white px-2.5 py-1 shadow-sm ring-1 ring-slate-200">
                <span className="mr-1 font-semibold text-teal-700">{i + 1}</span>
                {s}
              </span>
              {i < FLOW.length - 1 && <span className="text-slate-300">›</span>}
            </li>
          ))}
        </ol>

        <div className="stagger grid gap-3 sm:grid-cols-2">
          {HIGHLIGHTS.map(([Icon, title, desc]) => (
            <div key={title} className="card flex gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <div className="font-semibold">{title}</div>
                <p className="text-xs text-slate-600">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <Link href="/about" className="btn">
            <Blocks className="h-4 w-4" aria-hidden /> โครงสร้างระบบ (stack · schema · ทุกหน้า)
          </Link>
          <Link href="/guide/flow" className="btn-ghost">
            <Workflow className="h-4 w-4" aria-hidden /> การไหลของข้อมูล
          </Link>
          <Link href="/guide" className="btn-ghost">
            <BookOpen className="h-4 w-4" aria-hidden /> คู่มือ / UAT
          </Link>
        </div>
        <p className="text-xs text-slate-500">Next.js 16 · React 19 · TypeScript · SQLite (node:sqlite) · Tailwind CSS · Zod · Claude API (ไม่บังคับ)</p>
      </section>

      {/* sign in */}
      <section className="card space-y-4 lg:sticky lg:top-6">
        <div>
          <h2 className="text-lg font-semibold">เข้าสู่ระบบ</h2>
          <p className="text-sm text-slate-500">เดโม: เลือกผู้ใช้ตามบทบาท ไม่ต้องใช้รหัสผ่าน (ระบบจริงใช้ SSO ของโรงพยาบาล)</p>
        </div>
        <div className="stagger space-y-2">
          {users.map((u) => {
            const r = ROLE[u.role];
            return (
              <form key={u.id} action={signIn}>
                <input type="hidden" name="userId" value={u.id} />
                <button className="group w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left transition hover:-translate-y-px hover:border-teal-300 hover:shadow-md active:scale-[0.99]">
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{u.name}</span>
                    <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${r.cls}`}>{r.label}</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {r.does}
                    {u.can_approve_config ? " · อนุมัติค่าอ้างอิง" : ""}
                  </span>
                </button>
              </form>
            );
          })}
        </div>
        <p className="text-xs text-slate-500">
          ลอง flow ครบ: เวชระเบียนเปิด Visit → แพทย์สั่ง Lab → Lab (2 คน: คนหนึ่งลงผล อีกคน verify) → แพทย์อ่านผล ดูขั้นตอนละเอียดได้ใน{" "}
          <Link href="/guide" className="text-teal-700 hover:underline">
            คู่มือ
          </Link>
        </p>
      </section>
    </div>
  );
}
