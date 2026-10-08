import { Check, CircleSlash, Lightbulb, TriangleAlert, Wrench, X } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { GUIDES } from "@/lib/guide";
import { Rich, TONE, STATUS, Progress } from "../ui";
import { latestResults, tally } from "../data";
import { tryAs, recordUat } from "../actions";

export default async function RoleGuidePage({ params, searchParams }: PageProps<"/guide/[slug]">) {
  const { slug } = await params;
  const g = GUIDES.find((x) => x.slug === slug);
  if (!g) notFound();
  const saved = (await searchParams).saved;
  const user = await currentUser();
  const latest = latestResults();
  const t = TONE[g.tone];

  return (
    <div className="space-y-6">
      <nav className="text-sm text-slate-500">
        <Link href="/guide" className="hover:text-teal-700">
          คู่มือ
        </Link>{" "}
        / {g.name}
      </nav>

      {/* banner */}
      <header className={`rounded-2xl border p-6 ${t.soft}`}>
        <div className="flex flex-wrap items-start gap-4">
          <span className={`flex h-14 w-14 items-center justify-center rounded-2xl text-white ${t.solid}`} aria-hidden>
            <g.icon className="h-7 w-7" />
          </span>
          <div className="min-w-60 flex-1">
            <h1 className="text-2xl font-semibold">คู่มือ{g.name}</h1>
            <p className={`text-sm font-medium ${t.text}`}>{g.who}</p>
            <p className="mt-2 max-w-2xl text-slate-700">{g.summary}</p>
          </div>
          <div className="space-y-2">
            <div className="text-xs font-medium text-slate-500">ลองใช้งานจริงด้วยบัญชีทดลอง</div>
            {g.accounts.map((a) => (
              <form key={a.id} action={tryAs}>
                <input type="hidden" name="userId" value={a.id} />
                <input type="hidden" name="href" value={g.tasks[0].href ?? "/"} />
                <button className="btn-ghost w-full justify-between gap-4">
                  {a.name} <span aria-hidden>→</span>
                </button>
              </form>
            ))}
          </div>
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
        {/* table of contents */}
        <aside className="hidden lg:block">
          <div className="sticky top-6 space-y-4 text-sm">
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">งานหลัก</div>
              <ol className="space-y-1">
                {g.tasks.map((task, i) => (
                  <li key={task.title}>
                    <a href={`#task-${i + 1}`} className="text-slate-600 hover:text-teal-700">
                      {i + 1}. {task.title}
                    </a>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">ทดสอบ (UAT)</div>
              <ul className="space-y-1">
                {g.cases.map((c) => (
                  <li key={c.id}>
                    <a href={`#${c.id}`} className="flex items-center gap-2 text-slate-600 hover:text-teal-700">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS[latest.get(c.id)?.status ?? "NONE"].dot}`} />
                      <span className="truncate">{c.title}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </aside>

        <div className="min-w-0 space-y-10">
          {/* tasks */}
          <section className="stagger space-y-5">
            <h2 className="text-xl font-semibold">งานหลัก</h2>
            {g.tasks.map((task, i) => (
              <article key={task.title} id={`task-${i + 1}`} className="card scroll-mt-6 space-y-4">
                <div className="flex flex-wrap items-start gap-3">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-white ${t.solid}`}>{i + 1}</span>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold">{task.title}</h3>
                    <p className="text-sm text-slate-600">{task.goal}</p>
                  </div>
                  {task.href && (
                    <Link href={task.href} className={`text-sm font-medium ${t.text} hover:underline`}>
                      เปิดหน้านี้ →
                    </Link>
                  )}
                </div>
                <ol className="space-y-2">
                  {task.steps.map((s, n) => (
                    <li key={n} className="flex gap-3 text-sm leading-relaxed text-slate-700">
                      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ring-1 ${t.ring} ${t.text}`}>
                        {n + 1}
                      </span>
                      <span>
                        <Rich text={s} />
                      </span>
                    </li>
                  ))}
                </ol>
                <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                  <span className="font-semibold">ผลที่ได้: </span>
                  <Rich text={task.result} />
                </div>
                {task.tip && (
                  <div className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">
                    <Lightbulb className="mr-1 inline h-4 w-4" aria-hidden />
                    <Rich text={task.tip} />
                  </div>
                )}
                {task.warn && (
                  <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    <TriangleAlert className="mr-1 inline h-4 w-4" aria-hidden />
                    <Rich text={task.warn} />
                  </div>
                )}
              </article>
            ))}
          </section>

          {/* UAT */}
          <section className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-xl font-semibold">ทดสอบการใช้งาน (UAT)</h2>
                <p className="text-sm text-slate-600">ทำตามขั้นตอน เทียบกับผลที่คาดหวัง แล้วบันทึกผล ถ้าไม่ผ่านให้เขียนสิ่งที่เห็นจริงในหมายเหตุ</p>
              </div>
              <Link href="/guide/uat" className="text-sm font-medium text-teal-700 hover:underline">
                ดูสรุปทั้งระบบ →
              </Link>
            </div>
            <div className="card">
              <Progress {...tally(g.cases, latest)} />
            </div>

            {g.cases.map((c) => {
              const last = latest.get(c.id);
              const st = STATUS[last?.status ?? "NONE"];
              return (
                <article key={c.id} id={c.id} className={`card scroll-mt-6 space-y-3 ${saved === c.id ? "ring-2 ring-emerald-400" : ""}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-xs text-white">{c.id}</span>
                    <h3 className="font-semibold">{c.title}</h3>
                    {c.priority === "สูง" && <span className="rounded bg-rose-50 px-1.5 py-0.5 text-xs text-rose-700">สำคัญสูง</span>}
                    <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
                  </div>
                  <div className="grid gap-3 text-sm md:grid-cols-2">
                    <div>
                      {c.pre && (
                        <p className="mb-2 text-slate-500">
                          <span className="font-medium">เงื่อนไขก่อนเริ่ม:</span> {c.pre}
                        </p>
                      )}
                      {c.setup && (
                        <details className="mb-3 rounded-lg border border-sky-200 bg-sky-50">
                          <summary className="cursor-pointer px-3 py-1.5 font-medium text-sky-800"><Wrench className="mr-1 inline h-4 w-4" aria-hidden />วิธีเตรียมข้อมูล (ต้องสลับบัญชี)</summary>
                          <ol className="list-decimal space-y-1 px-3 pb-2 pl-8 text-slate-700">
                            {c.setup.map((s, n) => (
                              <li key={n}>
                                <Rich text={s} />
                              </li>
                            ))}
                          </ol>
                        </details>
                      )}
                      <div className="font-medium text-slate-500">ขั้นตอน</div>
                      <ol className="mt-1 list-decimal space-y-1 pl-5 text-slate-700">
                        {c.steps.map((s, n) => (
                          <li key={n}>
                            <Rich text={s} />
                          </li>
                        ))}
                      </ol>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <div className="font-medium text-slate-500">ผลที่คาดหวัง</div>
                      <p className="mt-1 text-slate-800">
                        <Rich text={c.expect} />
                      </p>
                    </div>
                  </div>
                  {last && (
                    <p className="text-xs text-slate-500">
                      ล่าสุด: <b>{st.label}</b> โดย {last.tester} · {last.at}
                      {last.note && <> · “{last.note}”</>} · ทดสอบแล้ว {last.runs} ครั้ง
                    </p>
                  )}
                  {saved === c.id && <p className="text-sm font-medium text-emerald-700"><Check className="mr-1 inline h-4 w-4" aria-hidden />บันทึกผลแล้ว</p>}
                  {user ? (
                    <form action={recordUat} className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                      <input type="hidden" name="caseId" value={c.id} />
                      <fieldset className="flex gap-1" aria-label={`ผลการทดสอบ ${c.id}`}>
                        {(
                          [
                            ["PASS", "ผ่าน", "has-checked:bg-emerald-600 has-checked:text-white has-checked:border-emerald-600"],
                            ["FAIL", "ไม่ผ่าน", "has-checked:bg-red-600 has-checked:text-white has-checked:border-red-600"],
                            ["BLOCKED", "ทดสอบไม่ได้", "has-checked:bg-amber-500 has-checked:text-white has-checked:border-amber-500"],
                          ] as const
                        ).map(([v, label, cls]) => (
                          <label key={v} className={`cursor-pointer rounded-md border border-slate-300 px-3 py-1.5 text-sm has-focus-visible:ring-2 has-focus-visible:ring-teal-500 ${cls}`}>
                            <input type="radio" name="status" value={v} required className="sr-only" />
                            {v === "PASS" ? <Check className="mr-1 inline h-4 w-4" aria-hidden /> : v === "FAIL" ? <X className="mr-1 inline h-4 w-4" aria-hidden /> : <CircleSlash className="mr-1 inline h-4 w-4" aria-hidden />}
                            {label}
                          </label>
                        ))}
                      </fieldset>
                      <input name="note" placeholder="หมายเหตุ (ถ้าไม่ผ่าน ให้ระบุสิ่งที่เห็น)" className="input min-w-48 flex-1" />
                      <button className="btn">บันทึกผล</button>
                    </form>
                  ) : (
                    <p className="border-t border-slate-100 pt-3 text-sm text-slate-500">
                      <Link href="/login" className="text-teal-700 hover:underline">
                        เข้าสู่ระบบ
                      </Link>{" "}
                      เพื่อบันทึกผลการทดสอบ
                    </p>
                  )}
                </article>
              );
            })}
          </section>
        </div>
      </div>
    </div>
  );
}
