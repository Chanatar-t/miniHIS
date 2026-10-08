import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { AutoSubmitSelect } from "@/components/client";

type Row = { id: number; at: string; user: string | null; role: string | null; action: string; entity: string; entity_id: number | null; detail: string | null; hn: string | null };

const ACTION_CLS: Record<string, string> = {
  DENY: "bg-red-100 text-red-700",
  AI_SUMMARY: "bg-violet-100 text-violet-800",
  AMEND: "bg-amber-100 text-amber-800",
  VIEW: "bg-slate-100 text-slate-600",
};

export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  await requireRole("ADMIN");
  const sp = await searchParams;
  const action = typeof sp.action === "string" ? sp.action : "";
  const hn = typeof sp.hn === "string" ? sp.hn.trim().toUpperCase() : "";

  // "who looked at / changed this patient" — the PDPA question
  const rows = db
    .prepare(
      `SELECT a.id, a.at, u.name AS user, u.role, a.action, a.entity, a.entity_id, a.detail, p.hn
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN patients p ON a.entity = 'patient' AND p.id = a.entity_id
       WHERE (? = '' OR a.action = ?) AND (? = '' OR p.hn = ?)
       ORDER BY a.id DESC LIMIT 300`,
    )
    .all(action, action, hn, hn) as Row[];
  const actions = (db.prepare("SELECT DISTINCT action FROM audit_log ORDER BY action").all() as { action: string }[]).map((r) => r.action);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Audit log</h1>
      <form className="card flex flex-wrap items-end gap-2">
        <div>
          <label className="label">การกระทำ</label>
          <AutoSubmitSelect name="action" defaultValue={action} className="input">
            <option value="">ทั้งหมด</option>
            {actions.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </AutoSubmitSelect>
        </div>
        <div>
          <label className="label">HN ผู้ป่วย (ใครเปิดดูข้อมูลคนนี้บ้าง)</label>
          <input name="hn" defaultValue={hn} className="input font-mono" placeholder="HN0000001" />
        </div>
        <button className="btn">กรอง</button>
        {(action || hn) && (
          <a href="/admin/audit" className="btn-ghost">
            ล้างตัวกรอง
          </a>
        )}
      </form>
      <div className="card p-0">
        <table className="table">
          <thead>
            <tr>
              <th>เวลา</th>
              <th>ผู้ใช้</th>
              <th>การกระทำ</th>
              <th>รายการ</th>
              <th>รายละเอียด</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap text-xs">{r.at}</td>
                <td className="text-xs">
                  {r.user ?? "-"} <span className="text-slate-400">{r.role}</span>
                </td>
                <td>
                  <span className={`rounded px-1.5 py-0.5 text-xs ${ACTION_CLS[r.action] ?? "bg-teal-50 text-teal-800"}`}>{r.action}</span>
                </td>
                <td className="font-mono text-xs">
                  {r.entity} {r.hn ?? r.entity_id ?? ""}
                </td>
                <td className="text-xs text-slate-600">{r.detail}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-slate-500">
                  ไม่มีรายการ
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
