import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { ITEM_STATUS, ORDER_STATUS, FLAG, REJECT_REASONS, DUE_OFFSET } from "@/lib/labels";
import { orderStatus } from "@/lib/rules";

export const metadata: Metadata = { title: "การไหลของข้อมูลและสถานะ · Mini HIS" };

// Plain-language explanation of every status, for non-technical readers. Public, no patient data:
// only counts are read from the DB.

type Main = {
  key: string;
  step: number;
  icon: string;
  meaning: string;
  parcel: string; // parcel-tracking analogy
  enter: string;
  next: string;
  doctorSees: string;
  outlabOnly?: boolean;
  subs: { label: string; detail: string; count?: (r: ItemRow[]) => number }[];
};

type ItemRow = {
  order_id: number; status: string; priority: string; outlab: number; shipment_status: string | null;
  overdue: number; flag: string | null; amended: number; from_hl7: number;
};

const MAIN: Main[] = [
  {
    key: "ORDERED",
    step: 1,
    icon: "📝",
    meaning: "แพทย์สั่งตรวจแล้ว แต่ยังไม่ได้เจาะเลือด",
    parcel: "กดสั่งของในแอปแล้ว ร้านยังไม่ได้แพ็ก",
    enter: "แพทย์กด ยืนยันสั่ง Lab",
    next: "เจ้าหน้าที่ Lab เจาะเลือดแล้วกด เก็บแล้ว",
    doctorSees: "สถานะ รอเก็บสิ่งส่งตรวจ",
    subs: [
      { label: "ด่วน (STAT)", detail: "ขึ้นบนสุดของทุกคิว กรอบแดง", count: (r) => r.filter((x) => x.priority === "STAT").length },
      { label: "ปกติ (Routine)", detail: "ทำตามลำดับเวลา", count: (r) => r.filter((x) => x.priority !== "STAT").length },
      { label: "สั่งซ้ำจากการเจาะใหม่", detail: "ระบบสร้างให้เองเมื่อหลอดเดิมถูก Reject" },
    ],
  },
  {
    key: "COLLECTED",
    step: 2,
    icon: "🏷️",
    meaning: "เจาะเลือดแล้ว ติดฉลาก barcode แล้ว หลอดกำลังเดินทางมาห้อง Lab",
    parcel: "แพ็กกล่องแล้ว แปะเลขพัสดุแล้ว รอขนส่งมารับ",
    enter: "Lab กด เก็บแล้ว + พิมพ์ฉลาก (ระบบแยกหลอดให้)",
    next: "หลอดมาถึง Lab และถูกสแกนรับเข้า",
    doctorSees: "สถานะ เก็บแล้ว",
    subs: [{ label: "ยังไม่ถึง Lab นานผิดปกติ", detail: "แนวคิดต่อยอด: แจ้งเตือนเมื่อเกิน 2 ชั่วโมง ป้องกันหลอดหาย" }],
  },
  {
    key: "RECEIVED",
    step: 3,
    icon: "📥",
    meaning: "หลอดมาถึงห้อง Lab แล้ว จากนี้แยกเป็น 2 เส้นทาง",
    parcel: "พัสดุถึงศูนย์คัดแยก",
    enter: "สแกน barcode ที่หน้า รับเข้า Lab",
    next: "ตรวจในโรงพยาบาล → ลงผลได้เลย · ส่งตรวจภายนอก → ใส่ใบนำส่งแล้วส่งออก",
    doctorSees: "สถานะ Lab รับแล้ว",
    subs: [
      { label: "ตรวจในโรงพยาบาล รอลงผล", detail: "ข้ามขั้นที่ 4 ไปขั้นที่ 5 ได้เลย", count: (r) => r.filter((x) => !x.outlab).length },
      { label: "ส่ง Outlab รอจัดใบนำส่ง", detail: "นับรวมในตัวเลข หลอดรอส่ง", count: (r) => r.filter((x) => x.outlab && !x.shipment_status).length },
      { label: "อยู่ในใบนำส่งฉบับร่าง", detail: "จัดแล้วแต่ยังไม่กดยืนยันส่ง ยังเอาออกได้", count: (r) => r.filter((x) => x.shipment_status === "DRAFT").length },
    ],
  },
  {
    key: "SENT",
    step: 4,
    icon: "🚚",
    meaning: "ส่งหลอดออกไปตรวจที่ห้องปฏิบัติการภายนอก (Outlab) แล้ว",
    parcel: "ฝากต่อให้บริษัทขนส่งอีกเจ้า",
    enter: "Lab กด ยืนยันส่ง ในใบนำส่ง",
    next: "Outlab ส่งผลกลับมา (ไฟล์ HL7) หรือเจ้าหน้าที่คีย์ผลเอง",
    doctorSees: "สถานะ ส่ง Outlab",
    outlabOnly: true,
    subs: [
      { label: "ยังไม่ถึงกำหนดได้ผล", detail: "ภายในจำนวนวัน (TAT) ของ test นั้น", count: (r) => r.filter((x) => !x.overdue).length },
      { label: "เกินกำหนดได้ผล", detail: "ขึ้นตัวแดง ⚠ เกินกำหนด ที่หน้าลงผล ควรโทรตาม Outlab", count: (r) => r.filter((x) => x.overdue).length },
    ],
  },
  {
    key: "RESULTED",
    step: 5,
    icon: "🧾",
    meaning: "มีผลแล้ว แต่ยังไม่ได้ตรวจทาน แพทย์จึงยังไม่เห็นตัวเลข",
    parcel: "ของถึงแล้ว รอตรวจสภาพก่อนส่งมอบ",
    enter: "คีย์ผล หรือนำเข้าไฟล์ HL7 จาก Outlab (ระบบติดธงสูง/ต่ำให้อัตโนมัติ)",
    next: "เจ้าหน้าที่อีกคน (ไม่ใช่คนลงผล) กด Verify",
    doctorSees: "สถานะ รอ Verify (ยังไม่เห็นตัวเลข)",
    subs: [
      { label: "ผลปกติ", detail: "อยู่ในช่วงค่าอ้างอิง", count: (r) => r.filter((x) => x.flag === "N" || !x.flag).length },
      { label: "ผลผิดปกติ (H / L)", detail: "สูงหรือต่ำกว่าค่าอ้างอิง", count: (r) => r.filter((x) => x.flag === "H" || x.flag === "L").length },
      { label: "ค่าวิกฤต (HH / LL)", detail: "อยู่บนสุดของคิว ต้องโทรแจ้งและบันทึกก่อน verify", count: (r) => r.filter((x) => x.flag === "HH" || x.flag === "LL").length },
      { label: "ผลจากไฟล์ HL7", detail: "Outlab ส่งมา นับเป็นผู้ลงผลคนแรก", count: (r) => r.filter((x) => x.from_hl7).length },
    ],
  },
  {
    key: "VERIFIED",
    step: 6,
    icon: "✅",
    meaning: "ตรวจทานแล้ว รายงานผลให้แพทย์ จบงาน",
    parcel: "ส่งถึงมือผู้รับ เซ็นรับแล้ว",
    enter: "เจ้าหน้าที่คนที่สองกด Verify และรายงานผล",
    next: "ไม่มี (จุดสิ้นสุด) ถ้าผลผิดใช้ แก้ไขผล ได้โดยค่าเดิมยังเก็บไว้",
    doctorSees: "ตัวเลขผล ธงสูง/ต่ำ และใบรายงานผล",
    subs: [
      { label: "รายงานตามปกติ", detail: "", count: (r) => r.filter((x) => !x.amended).length },
      { label: "แก้ไขผลหลังรายงาน", detail: "ใบรายงานขึ้นคำว่า (แก้ไข) พร้อมเหตุผลและค่าเดิม", count: (r) => r.filter((x) => x.amended).length },
    ],
  },
];

const DATA_TRAIL = [
  ["ลงทะเบียนผู้ป่วย", "เวชระเบียน", "HN, เลขบัตรประชาชน, ชื่อ, วันเกิด, เพศ", "ระบุตัวผู้ป่วยได้ถูกคน ไม่ซ้ำ"],
  ["เปิด Visit", "เวชระเบียน", "VN, สิทธิการรักษา, เวลา", "รู้ว่ามาครั้งไหน ใช้สิทธิอะไร"],
  ["สั่ง Lab", "แพทย์", "เลขใบสั่ง, รายการ test, แพทย์ผู้สั่ง, ด่วน/ปกติ, หมายเหตุ", "เป็นใบงานของห้อง Lab"],
  ["เก็บสิ่งส่งตรวจ", "Lab", "เลข Accession ของแต่ละหลอด, ชนิดหลอด, ผู้เก็บ, เวลาเก็บ", "เริ่มนับเวลาได้ผล (TAT)"],
  ["รับเข้า Lab", "Lab", "ผู้รับ, เวลารับ", "รู้ว่าหลอดไม่หายระหว่างทาง"],
  ["ส่ง Outlab", "Lab", "เลขใบนำส่ง, Outlab ปลายทาง, เวลาส่ง, หลอดในใบ", "ติดตามของ และกระทบยอดค่าใช้จ่าย"],
  ["รับผล / ลงผล", "Lab / Outlab", "ค่าผล, ธงสูง/ต่ำ, ที่มา (คนหรือไฟล์ HL7), เวลา", "ผลพร้อมให้ตรวจทาน"],
  ["Verify", "Lab คนที่สอง", "ผู้ตรวจทาน, เวลา, การแจ้งค่าวิกฤต (แจ้งใคร ทางไหน)", "มีผู้รับผิดชอบผลชัดเจน"],
  ["ทุกขั้นตอน", "ระบบ", "Audit log: ใคร ทำอะไร กับข้อมูลไหน เมื่อไร (รวมการเปิดดู)", "ตรวจสอบย้อนหลังตาม PDPA"],
];

const FAQ = [
  ["Outlab ส่งผลมาแล้ว ทำไมแพทย์ยังไม่เห็น?", "ผลอยู่ในสถานะ รอ Verify ต้องให้เจ้าหน้าที่ตรวจทานก่อน ระบบไม่แสดงตัวเลขที่ยังไม่ตรวจทาน เพื่อป้องกันการรักษาจากผลที่ผิด"],
  ["หลอดแตกหรือเลือดไม่พอ ต้องสั่งใหม่ไหม?", "ไม่ต้อง กด Reject พร้อมเหตุผล ระบบสร้างรายการ รอเก็บสิ่งส่งตรวจ ให้ใหม่โดยอัตโนมัติ แพทย์ไม่ต้องสั่งซ้ำ"],
  ["แก้ผลแล้ว ค่าเดิมหายไหม?", "ไม่หาย ระบบเก็บค่าเดิม ค่าใหม่ เหตุผล ผู้แก้ และเวลาไว้ทุกครั้ง ใบรายงานแสดงว่าผลถูกแก้ไข"],
  ["ใบสั่งเดียวมี test หลายตัว สถานะต่างกันได้ไหม?", "ได้ และเป็นเรื่องปกติ เช่น ค่าน้ำตาลตรวจในโรงพยาบาลได้ผลก่อน ส่วน Vitamin D ส่ง Outlab ได้ผลอีก 5 วัน ใบสั่งจึงอยู่ในสถานะ ได้ผลบางส่วน"],
  ["ทำไมคนลงผลถึง verify เองไม่ได้?", "หลักสี่ตา (four-eyes) ให้คนสองคนดูงานเดียวกัน ลดโอกาสผิดพลาดจากคนเดียว เป็นแนวปฏิบัติด้านความปลอดภัยของผู้ป่วย"],
];

export default async function FlowPage() {
  const rows = db
    .prepare(
      `SELECT i.order_id, i.status, o.priority, t.outlab_id IS NOT NULL AS outlab, sh.status AS shipment_status,
              coalesce(datetime(s.collected_at, ${DUE_OFFSET}) < datetime('now','localtime'), 0) AS overdue,
              i.flag, EXISTS (SELECT 1 FROM result_amendments a WHERE a.item_id = i.id) AS amended, i.message_id IS NOT NULL AS from_hl7
       FROM lab_order_items i JOIN lab_orders o ON o.id = i.order_id JOIN lab_tests t ON t.id = i.test_id
       LEFT JOIN specimens s ON s.id = i.specimen_id LEFT JOIN shipments sh ON sh.id = s.shipment_id`,
    )
    .all() as ItemRow[];
  const byStatus = Map.groupBy(rows, (r) => r.status);
  const orders = [...Map.groupBy(rows, (r) => r.order_id).values()].map((items) => orderStatus(items.map((i) => i.status)));
  const shipments = Object.fromEntries(
    (db.prepare("SELECT status, COUNT(*) AS n FROM shipments GROUP BY status").all() as { status: string; n: number }[]).map((r) => [r.status, r.n]),
  );

  return (
    <div className="space-y-12">
      <nav className="text-sm text-slate-500">
        <Link href="/guide" className="hover:text-teal-700">
          คู่มือ
        </Link>{" "}
        / การไหลของข้อมูลและสถานะ
      </nav>

      {/* hero */}
      <section className="rounded-2xl bg-gradient-to-br from-indigo-700 via-violet-700 to-teal-700 px-6 py-10 text-white sm:px-10">
        <h1 className="text-3xl font-semibold sm:text-4xl">ข้อมูลเดินทางอย่างไร และตอนนี้อยู่สถานะไหน</h1>
        <p className="mt-3 max-w-2xl text-violet-50">
          อธิบายให้เข้าใจได้โดยไม่ต้องมีพื้นฐานไอที ทุกสถานะใช้ชื่อและสีเดียวกับบนหน้าจอจริง และตัวเลขในหน้านี้ดึงจากระบบตอนนี้
        </p>
        <div className="mt-6 max-w-2xl rounded-xl bg-white/10 p-4 ring-1 ring-white/30">
          <div className="font-semibold">📦 นึกถึงการติดตามพัสดุ</div>
          <p className="mt-1 text-sm text-violet-50">
            สั่งของ → แพ็ก → ถึงศูนย์คัดแยก → ส่งต่อ → ถึงปลายทาง → เซ็นรับ หลอดเลือดหนึ่งหลอดก็เดินทางแบบเดียวกัน
            และระบบบันทึกทุกจุดว่าใครทำ เมื่อไร เหมือนเลขพัสดุที่เช็กได้ตลอดทาง
          </p>
        </div>
      </section>

      {/* the four things */}
      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">ระบบติดตาม 4 อย่าง ซ้อนกันเป็นชั้น</h2>
          <p className="text-sm text-slate-600">ตัวอย่าง: แพทย์สั่ง 4 test ในใบเดียว</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-4">
          {[
            ["🗒️", "ใบสั่ง (Order)", "ที่แพทย์สั่งในครั้งเดียว", "1 ใบ"],
            ["🔬", "รายการตรวจ (Test)", "แต่ละรายการในใบสั่ง สถานะหลักอยู่ที่ระดับนี้", "4 รายการ"],
            ["🧪", "หลอด (Specimen)", "test ที่ใช้หลอดเดียวกันและไปที่เดียวกันใช้หลอดร่วมกัน", "3 หลอด"],
            ["📦", "ใบนำส่ง (Shipment)", "รวมหลอดที่ส่ง Outlab เดียวกันในรอบเดียว", "1 ใบ"],
          ].map(([icon, name, desc, ex]) => (
            <div key={name} className="card">
              <div className="text-2xl" aria-hidden>
                {icon}
              </div>
              <div className="mt-2 font-semibold">{name}</div>
              <p className="text-sm text-slate-600">{desc}</p>
              <div className="mt-2 text-xs font-medium text-violet-700">ในตัวอย่าง: {ex}</div>
            </div>
          ))}
        </div>

        {/* nested example */}
        <div className="card overflow-x-auto">
          <div className="min-w-[640px] space-y-3 text-sm">
            <div className="rounded-xl border-2 border-dashed border-slate-300 p-3">
              <div className="mb-2 font-semibold">🗒️ ใบสั่ง #1 · นพ.ธนา · STAT</div>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-violet-300 bg-violet-50 p-2">
                  <div className="font-medium">🧪 หลอดแดง → Outlab A</div>
                  <div className="mt-1 flex gap-1">
                    <span className="rounded bg-white px-1.5 ring-1 ring-violet-200">TSH</span>
                    <span className="rounded bg-white px-1.5 ring-1 ring-violet-200">FT4</span>
                  </div>
                  <div className="mt-2 text-xs text-violet-700">📦 อยู่ในใบนำส่ง SH...001</div>
                </div>
                <div className="rounded-lg border border-violet-300 bg-violet-50 p-2">
                  <div className="font-medium">🧪 หลอดม่วง → Outlab A</div>
                  <div className="mt-1 flex gap-1">
                    <span className="rounded bg-white px-1.5 ring-1 ring-violet-200">HbA1c</span>
                  </div>
                  <div className="mt-2 text-xs text-violet-700">📦 อยู่ในใบนำส่ง SH...001</div>
                </div>
                <div className="rounded-lg border border-teal-300 bg-teal-50 p-2">
                  <div className="font-medium">🧪 หลอดแดง → ตรวจในโรงพยาบาล</div>
                  <div className="mt-1 flex gap-1">
                    <span className="rounded bg-white px-1.5 ring-1 ring-teal-200">CREA</span>
                  </div>
                  <div className="mt-2 text-xs text-teal-700">ไม่ต้องส่งออก</div>
                </div>
              </div>
            </div>
            <p className="text-xs text-slate-500">TSH กับ FT4 ใช้หลอดแดงเหมือนกันและส่งที่เดียวกัน จึงรวมเป็นหลอดเดียว ส่วน CREA ก็ใช้หลอดแดงแต่ตรวจในโรงพยาบาล จึงต้องแยกหลอด</p>
          </div>
        </div>
      </section>

      {/* main journey */}
      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">สถานะหลักของรายการตรวจ: 6 ขั้น</h2>
          <p className="text-sm text-slate-600">
            ทุก test เดินไปข้างหน้าทีละขั้น ไม่ย้อนกลับ ยกเว้น test ที่ตรวจในโรงพยาบาลจะข้ามขั้นที่ 4 ตัวเลขในวงกลมคือจำนวนรายการในระบบตอนนี้
          </p>
        </div>
        <ol className="relative space-y-4 border-l-2 border-slate-200 pl-6 sm:pl-8">
          {MAIN.map((m) => {
            const st = ITEM_STATUS[m.key];
            const items = byStatus.get(m.key) ?? [];
            return (
              <li key={m.key} className="relative">
                <span className="absolute -left-[39px] top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white text-lg ring-2 ring-slate-200 sm:-left-[47px]" aria-hidden>
                  {m.icon}
                </span>
                <article className="card space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-slate-400">ขั้นที่ {m.step}</span>
                    <span className={`rounded-full px-3 py-1 text-sm font-semibold ${st.cls}`}>{st.label}</span>
                    {m.outlabOnly && <span className="rounded bg-violet-50 px-2 py-0.5 text-xs text-violet-700">เฉพาะ test ที่ส่ง Outlab</span>}
                    <span className="ml-auto flex items-center gap-1 text-xs text-slate-500">
                      ตอนนี้ <b className="rounded-full bg-slate-800 px-2 py-0.5 text-white">{items.length}</b> รายการ
                    </span>
                  </div>
                  <p className="text-lg font-medium">{m.meaning}</p>
                  <p className="text-sm text-slate-500">📦 เหมือน: {m.parcel}</p>
                  <dl className="grid gap-2 text-sm sm:grid-cols-3">
                    <div className="rounded-lg bg-slate-50 p-2">
                      <dt className="text-xs font-semibold text-slate-500">เข้าสถานะนี้เมื่อ</dt>
                      <dd>{m.enter}</dd>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-2">
                      <dt className="text-xs font-semibold text-slate-500">ไปขั้นต่อไปเมื่อ</dt>
                      <dd>{m.next}</dd>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-2">
                      <dt className="text-xs font-semibold text-slate-500">แพทย์เห็นอะไร</dt>
                      <dd>{m.doctorSees}</dd>
                    </div>
                  </dl>
                  {m.subs.length > 0 && (
                    <details className="group rounded-lg border border-slate-200">
                      <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium text-violet-700">
                        <span className="inline-block transition group-open:rotate-90">▸</span> แบ่งย่อยได้อีก {m.subs.length} แบบ
                      </summary>
                      <ul className="divide-y divide-slate-100 border-t border-slate-200">
                        {m.subs.map((s) => (
                          <li key={s.label} className="flex items-start gap-3 px-3 py-2 text-sm">
                            <div className="flex-1">
                              <div className="font-medium">{s.label}</div>
                              {s.detail && <div className="text-slate-500">{s.detail}</div>}
                            </div>
                            {s.count && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold">{s.count(items)}</span>}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </article>
              </li>
            );
          })}
        </ol>
      </section>

      {/* detours */}
      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">ทางแยก: เมื่อมีปัญหา</h2>
          <p className="text-sm text-slate-600">2 สถานะนี้ไม่อยู่ในเส้นทางปกติ แต่ต้องมีเพื่อให้ตามรอยได้ว่าเกิดอะไรขึ้น</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <article className="card space-y-3 border-red-200">
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-3 py-1 text-sm font-semibold ${ITEM_STATUS.REJECTED.cls}`}>{ITEM_STATUS.REJECTED.label}</span>
              <span className="ml-auto text-xs text-slate-500">
                ตอนนี้ <b>{byStatus.get("REJECTED")?.length ?? 0}</b> รายการ
              </span>
            </div>
            <p className="font-medium">หลอดใช้ตรวจไม่ได้ ต้องเจาะใหม่</p>
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-red-50 p-3 text-sm">
              <span className={`rounded-full px-2 py-0.5 text-xs ${ITEM_STATUS.RECEIVED.cls}`}>{ITEM_STATUS.RECEIVED.label}</span>→
              <span className={`rounded-full px-2 py-0.5 text-xs ${ITEM_STATUS.REJECTED.cls}`}>Reject</span>→
              <span className="text-xs">ระบบสร้างใหม่</span>→
              <span className={`rounded-full px-2 py-0.5 text-xs ${ITEM_STATUS.ORDERED.cls}`}>{ITEM_STATUS.ORDERED.label}</span>
            </div>
            <div className="text-sm">
              <div className="font-medium text-slate-500">เหตุผลที่เลือกได้ ({REJECT_REASONS.length})</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {REJECT_REASONS.map((r) => (
                  <span key={r} className="rounded bg-slate-100 px-2 py-0.5 text-xs">
                    {r}
                  </span>
                ))}
              </div>
            </div>
            <p className="text-xs text-slate-500">รายการเดิมไม่ถูกลบ เก็บไว้เป็นหลักฐานว่าเคยเจาะแล้วใช้ไม่ได้ด้วยเหตุผลอะไร</p>
          </article>
          <article className="card space-y-3">
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-3 py-1 text-sm font-semibold ${ITEM_STATUS.CANCELLED.cls}`}>{ITEM_STATUS.CANCELLED.label}</span>
              <span className="ml-auto rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-800">มีในฐานข้อมูล ยังไม่เปิดปุ่มในเดโม</span>
            </div>
            <p className="font-medium">แพทย์ยกเลิกคำสั่งตรวจ</p>
            <p className="text-sm text-slate-600">
              กติกาที่ออกแบบไว้: ยกเลิกได้เฉพาะก่อนส่ง Outlab เพราะเมื่อส่งไปแล้ว Outlab คิดค่าตรวจแน่นอน
            </p>
          </article>
        </div>
      </section>

      {/* order level */}
      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">สถานะของทั้งใบสั่ง: 5 แบบ</h2>
          <p className="text-sm text-slate-600">
            ระบบไม่เก็บสถานะของใบสั่งแยกไว้ แต่คำนวณจาก test ในใบทุกครั้ง จึงไม่มีทางที่ใบสั่งกับ test จะขัดแย้งกัน (test ที่ถูก Reject ไม่นับ เพราะมีรายการใหม่มาแทนแล้ว)
          </p>
        </div>
        <div className="card p-0">
          <table className="table">
            <thead>
              <tr>
                <th>สถานะใบสั่ง</th>
                <th>เงื่อนไข</th>
                <th className="text-right">ตอนนี้</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["WAITING", "ทุก test ยังรอเก็บสิ่งส่งตรวจ"],
                  ["IN_PROGRESS", "มีอย่างน้อย 1 test เริ่มแล้ว แต่ยังไม่มีผลที่รายงาน"],
                  ["PARTIAL", "บาง test รายงานผลแล้ว บางตัวยังรอ (พบบ่อยเมื่อมี test ส่ง Outlab)"],
                  ["COMPLETE", "ทุก test รายงานผลแล้ว"],
                  ["CANCELLED", "ทุก test ถูกยกเลิก"],
                ] as const
              ).map(([k, cond]) => (
                <tr key={k}>
                  <td>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ORDER_STATUS[k].cls}`}>{ORDER_STATUS[k].label}</span>
                  </td>
                  <td className="text-sm">{cond}</td>
                  <td className="text-right font-semibold">{orders.filter((o) => o === k).length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* other statuses */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">สถานะอื่นที่จะเห็นในระบบ</h2>
        <div className="grid gap-4 lg:grid-cols-3">
          <article className="card space-y-2">
            <h3 className="font-semibold">📦 ใบนำส่ง</h3>
            <div className="flex items-center gap-2 text-sm">
              <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">ร่าง (ยังไม่ส่ง)</span>→
              <span className="rounded bg-violet-100 px-2 py-0.5 text-xs text-violet-800">ส่งแล้ว</span>
            </div>
            <p className="text-sm text-slate-600">
              ร่าง: ยังเอาหลอดออกได้ ({shipments.DRAFT ?? 0} ใบ) · ส่งแล้ว: ล็อก แก้ไม่ได้ ({shipments.SENT ?? 0} ใบ)
            </p>
            <p className="text-xs text-slate-500">ต่อยอด: สถานะ Outlab ยืนยันรับของ (มีที่ไว้ในฐานข้อมูลแล้ว)</p>
          </article>
          <article className="card space-y-2">
            <h3 className="font-semibold">🚩 ธงของผลตรวจ</h3>
            <p className="text-sm text-slate-600">ตัวอย่างค่าน้ำตาล (ปกติ 70-100, วิกฤตต่ำกว่า 40 หรือสูงกว่า 500)</p>
            <ul className="space-y-1 text-sm">
              {(
                [
                  ["LL", "ต่ำกว่า 40", "ต่ำอันตราย"],
                  ["L", "40-69", "ต่ำกว่าปกติ"],
                  ["N", "70-100", "ปกติ (ไม่มีป้าย)"],
                  ["H", "101-500", "สูงกว่าปกติ"],
                  ["HH", "มากกว่า 500", "สูงอันตราย"],
                ] as const
              ).map(([f, range, txt]) => (
                <li key={f} className="flex items-center gap-2">
                  <span className={`w-20 rounded px-1.5 py-0.5 text-center text-xs ${f === "N" ? "bg-slate-100 text-slate-600" : FLAG[f].cls}`}>{f === "N" ? "ปกติ" : FLAG[f].label}</span>
                  <span className="w-24 font-mono text-xs">{range}</span>
                  <span className="text-slate-600">{txt}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-500">ระบบติดธงจากค่าอ้างอิงของโรงพยาบาลเราเอง ไม่ใช้ธงที่ Outlab ส่งมา</p>
          </article>
          <article className="card space-y-2">
            <h3 className="font-semibold">📨 ไฟล์ผลจาก Outlab (HL7)</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">รับครบ</span> ทุกผลจับคู่กับหลอดได้
              </li>
              <li>
                <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">รับบางส่วน</span> บางผลจับคู่ไม่ได้ ระบบแจ้งให้ลงผลเอง
              </li>
              <li>
                <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">ไม่รับ</span> ไฟล์ซ้ำ ไฟล์เสีย หรือไม่มีผลที่ตรงเลย
              </li>
            </ul>
          </article>
        </div>
      </section>

      {/* data trail */}
      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">แต่ละขั้น ระบบจดอะไรไว้บ้าง</h2>
          <p className="text-sm text-slate-600">เหมือนประวัติการสแกนพัสดุ ข้อมูลเหล่านี้ทำให้ตอบได้ว่า ใคร ทำอะไร เมื่อไร</p>
        </div>
        <div className="card overflow-x-auto p-0">
          <table className="table min-w-[720px]">
            <thead>
              <tr>
                <th>ขั้นตอน</th>
                <th>ใครทำ</th>
                <th>ข้อมูลที่ถูกบันทึก</th>
                <th>เอาไปใช้ทำอะไร</th>
              </tr>
            </thead>
            <tbody>
              {DATA_TRAIL.map(([step, who, data, why]) => (
                <tr key={step}>
                  <td className="font-medium">{step}</td>
                  <td className="text-slate-600">{who}</td>
                  <td>{data}</td>
                  <td className="text-slate-600">{why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* FAQ */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">คำถามที่พบบ่อย</h2>
        {FAQ.map(([q, a]) => (
          <details key={q} className="card group">
            <summary className="cursor-pointer list-none font-medium">
              <span className="mr-2 inline-block text-violet-600 transition group-open:rotate-90">▸</span>
              {q}
            </summary>
            <p className="mt-2 pl-5 text-sm text-slate-600">{a}</p>
          </details>
        ))}
      </section>
    </div>
  );
}
