import { Workflow } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";
import { currentUser } from "@/lib/auth";
import { GUIDES, FLOW, GLOSSARY, TEST_CIDS, ALL_CASES } from "@/lib/guide";
import { TONE, Progress } from "./ui";
import { latestResults, tally } from "./data";
import { tryAs } from "./actions";

export const metadata: Metadata = { title: "คู่มือการใช้งาน · Mini HIS" };

// Public on purpose: trainees read it before they have an account. Contains no patient data.
export default async function GuidePage() {
  const user = await currentUser();
  const latest = latestResults();
  const all = tally(ALL_CASES, latest);

  return (
    <div className="space-y-10">
      {/* hero */}
      <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-teal-700 via-teal-600 to-sky-700 px-6 py-10 text-white sm:px-10">
        <p className="text-sm font-medium text-teal-100">Mini HIS · LIS Outlab</p>
        <h1 className="mt-1 text-3xl font-semibold sm:text-4xl">คู่มือการใช้งานและทดสอบระบบ</h1>
        <p className="mt-3 max-w-2xl text-teal-50">
          เลือกบทบาทของคุณ ทำตามขั้นตอนทีละข้อ แล้วบันทึกผลการทดสอบ (UAT) ได้ในหน้าเดียวกัน ทุกปุ่มที่กล่าวถึงใช้ชื่อเดียวกับบนหน้าจอจริง
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a href="#roles" className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50">
            เริ่มตามบทบาท ↓
          </a>
          <Link href="/guide/uat" className="rounded-lg bg-white/15 px-4 py-2 text-sm font-semibold ring-1 ring-white/40 hover:bg-white/25">
            ผลการทดสอบ UAT →
          </Link>
          {!user && (
            <Link href="/login" className="rounded-lg px-4 py-2 text-sm font-semibold underline-offset-4 hover:underline">
              เข้าสู่ระบบ
            </Link>
          )}
        </div>
        <div className="mt-8 max-w-md rounded-xl bg-white/95 p-4 text-slate-800">
          <div className="mb-2 text-sm font-semibold">ความคืบหน้า UAT ทั้งระบบ</div>
          <Progress {...all} />
        </div>
      </section>

      <Link
        href="/guide/flow"
        className="group flex flex-wrap items-center gap-4 rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-50 to-white p-5 transition hover:shadow-md"
      >
        <span className="text-3xl" aria-hidden>
          <Workflow className="h-8 w-8 text-violet-600" aria-hidden />
        </span>
        <div className="flex-1">
          <div className="font-semibold">การไหลของข้อมูลและสถานะทั้งหมด</div>
          <p className="text-sm text-slate-600">มีกี่สถานะ แต่ละสถานะหมายถึงอะไร แบ่งย่อยอย่างไร อธิบายแบบไม่ต้องมีพื้นฐานไอที พร้อมตัวเลขจริงจากระบบ</p>
        </div>
        <span className="font-medium text-violet-700 group-hover:translate-x-1 transition">อ่าน →</span>
      </Link>

      {/* how to use this guide */}
      <section className="grid gap-4 sm:grid-cols-3">
        {[
          ["1", "เลือกบทบาท", "เปิดคู่มือของงานที่คุณทำ หรือกด ลองใช้เป็น… เพื่อเข้าระบบด้วยบัญชีทดลองของบทบาทนั้น"],
          ["2", "ทำตามขั้นตอน", "แต่ละงานบอกเป้าหมาย ขั้นตอน ผลที่ควรได้ และข้อควรระวัง พร้อมปุ่มเปิดหน้าจอจริง"],
          ["3", "บันทึกผลทดสอบ", "ท้ายคู่มือมี test case กด ผ่าน / ไม่ผ่าน / ทดสอบไม่ได้ พร้อมหมายเหตุ ทีมพัฒนาเห็นทันที"],
        ].map(([n, t, d]) => (
          <div key={n} className="card flex gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-600 text-sm font-semibold text-white">{n}</span>
            <div>
              <div className="font-semibold">{t}</div>
              <p className="mt-1 text-sm text-slate-600">{d}</p>
            </div>
          </div>
        ))}
      </section>

      {/* end-to-end flow */}
      <section>
        <h2 className="text-xl font-semibold">ภาพรวม: หลอดเลือดหนึ่งหลอดเดินทางอย่างไร</h2>
        <p className="mt-1 text-sm text-slate-600">ทุกบทบาททำงานต่อกันเป็นสายเดียว สีบอกว่าใครรับผิดชอบขั้นนั้น</p>
        <ol className="stagger mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-9">
          {FLOW.map((f, i) => {
            const g = GUIDES.find((x) => x.slug === f.by)!;
            return (
              <li key={f.title} className={`relative rounded-xl border p-3 ${TONE[g.tone].soft}`}>
                <div className="flex items-center justify-between">
                  <f.icon className={`h-6 w-6 ${TONE[g.tone].text}`} aria-hidden />
                  <span className="text-xs font-semibold text-slate-400">{i + 1}</span>
                </div>
                <div className="mt-2 text-sm font-semibold leading-snug">{f.title}</div>
                <div className={`mt-1 text-xs font-medium ${TONE[g.tone].text}`}>{g.name}</div>
              </li>
            );
          })}
        </ol>
      </section>

      {/* roles */}
      <section id="roles" className="scroll-mt-6">
        <h2 className="text-xl font-semibold">คู่มือตามบทบาท</h2>
        <div className="stagger mt-4 grid gap-4 md:grid-cols-2">
          {GUIDES.map((g) => {
            const t = TONE[g.tone];
            return (
              <article key={g.slug} className="card card-hover flex flex-col gap-4">
                <div className="flex items-start gap-4">
                  <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-2xl ${t.soft} border`} aria-hidden>
                    <g.icon className={`h-6 w-6 ${t.text}`} />
                  </span>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold">{g.name}</h3>
                    <p className={`text-xs font-medium ${t.text}`}>{g.who}</p>
                    <p className="mt-2 text-sm text-slate-600">{g.summary}</p>
                  </div>
                </div>
                <div className="text-xs text-slate-500">
                  {g.tasks.length} งานหลัก · {g.cases.length} test case · บัญชีทดลอง: {g.accounts.map((a) => a.name).join(", ")}
                </div>
                <Progress {...tally(g.cases, latest)} />
                <div className="mt-auto flex flex-wrap gap-2">
                  <Link href={`/guide/${g.slug}`} className={`rounded-md px-3 py-1.5 text-sm font-medium text-white ${t.solid} hover:opacity-90`}>
                    อ่านคู่มือ{g.name}
                  </Link>
                  <form action={tryAs}>
                    <input type="hidden" name="userId" value={g.accounts[0].id} />
                    <input type="hidden" name="href" value={g.tasks[0].href ?? "/"} />
                    <button className="btn-ghost">ลองใช้เป็น {g.accounts[0].name} →</button>
                  </form>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* test data + glossary */}
      <section className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        <div className="card h-fit space-y-3">
          <h2 className="font-semibold">ข้อมูลสำหรับทดสอบ</h2>
          <p className="text-sm text-slate-600">ข้อมูลในระบบเป็นข้อมูลสมมติทั้งหมด ใช้เลขบัตรเหล่านี้ลงทะเบียนผู้ป่วยใหม่ได้ (checksum ถูกต้อง):</p>
          <ul className="space-y-1">
            {TEST_CIDS.map((c) => (
              <li key={c}>
                <code className="rounded bg-slate-100 px-2 py-0.5 font-mono text-sm">{c}</code>
              </li>
            ))}
          </ul>
          <p className="text-sm text-slate-600">
            ผู้ป่วยตัวอย่าง: <code className="rounded bg-slate-100 px-1.5 font-mono">HN0000001</code> ถึง <code className="rounded bg-slate-100 px-1.5 font-mono">HN0000030</code>
          </p>
        </div>
        <div className="card">
          <h2 className="font-semibold">คำศัพท์ที่ควรรู้</h2>
          <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {GLOSSARY.map(([term, def]) => (
              <div key={term}>
                <dt className="text-sm font-semibold">{term}</dt>
                <dd className="text-sm text-slate-600">{def}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </div>
  );
}
