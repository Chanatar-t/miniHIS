import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { GUIDES, ALL_CASES } from "@/lib/guide";
import { PrintButton } from "@/components/client";
import { STATUS, TONE, Progress } from "../ui";
import { latestResults, tally } from "../data";

export default async function UatSummaryPage() {
  await requireRole();
  const latest = latestResults();
  const all = tally(ALL_CASES, latest);
  const failing = ALL_CASES.filter((c) => latest.get(c.id)?.status === "FAIL");

  return (
    <div className="space-y-6">
      <nav className="no-print text-sm text-slate-500">
        <Link href="/guide" className="hover:text-teal-700">
          คู่มือ
        </Link>{" "}
        / สรุปผล UAT
      </nav>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">สรุปผลการทดสอบ UAT</h1>
        <div className="ml-auto">
          <PrintButton label="พิมพ์รายงาน" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        {[
          ["ทั้งหมด", all.total, "text-slate-900"],
          ["ผ่าน", all.pass, "text-emerald-700"],
          ["ไม่ผ่าน", all.fail, "text-red-600"],
          ["ยังไม่ทดสอบ", all.total - all.pass - all.fail - all.blocked, "text-slate-500"],
        ].map(([label, n, cls]) => (
          <div key={label} className="card">
            <div className="text-sm text-slate-500">{label}</div>
            <div className={`text-3xl font-semibold ${cls}`}>{n}</div>
          </div>
        ))}
      </div>
      <div className="card">
        <Progress {...all} />
      </div>

      {failing.length > 0 && (
        <div className="card border-red-300 bg-red-50">
          <h2 className="font-semibold text-red-800">ต้องแก้ไข ({failing.length})</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {failing.map((c) => (
              <li key={c.id}>
                <Link href={`/guide/${c.guide.slug}#${c.id}`} className="font-mono text-red-700 hover:underline">
                  {c.id}
                </Link>{" "}
                {c.title} — {latest.get(c.id)?.note ?? "ไม่มีหมายเหตุ"}
              </li>
            ))}
          </ul>
        </div>
      )}

      {GUIDES.map((g) => (
        <section key={g.slug} className="card p-0">
          <div className="flex items-center gap-3 px-4 pt-4">
            <span className={`h-3 w-3 rounded-full ${TONE[g.tone].solid}`} />
            <h2 className="font-semibold">{g.name}</h2>
            <div className="ml-auto w-64">
              <Progress {...tally(g.cases, latest)} />
            </div>
          </div>
          <table className="table mt-2">
            <thead>
              <tr>
                <th className="w-28">Case</th>
                <th>รายการ</th>
                <th className="w-28">ผล</th>
                <th>ผู้ทดสอบ / เวลา</th>
                <th>หมายเหตุ</th>
              </tr>
            </thead>
            <tbody>
              {g.cases.map((c) => {
                const l = latest.get(c.id);
                const st = STATUS[l?.status ?? "NONE"];
                return (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/guide/${g.slug}#${c.id}`} className="font-mono text-xs text-teal-700 hover:underline">
                        {c.id}
                      </Link>
                    </td>
                    <td>
                      {c.title}
                      {c.priority === "สูง" && <span className="ml-1 text-xs text-rose-600">●</span>}
                    </td>
                    <td>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
                    </td>
                    <td className="text-xs text-slate-600">{l ? `${l.tester} · ${l.at}` : "-"}</td>
                    <td className="text-xs text-slate-600">{l?.note ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}
      <p className="text-xs text-slate-500">● = สำคัญสูง · ผลที่แสดงเป็นผลล่าสุดของแต่ละ case ประวัติทั้งหมดเก็บไว้ในฐานข้อมูล</p>
    </div>
  );
}
