import Link from "next/link";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";

type Row = { hn: string; cid: string; prefix: string; first_name: string; last_name: string; dob: string; sex: string };

export default async function PatientsPage({ searchParams }: PageProps<"/patients">) {
  const user = await requireRole();
  const q = String((await searchParams).q ?? "").trim();

  // ponytail: LIKE scan, fine for thousands of rows; FTS5 / pg_trgm when it gets slow
  const like = `%${q}%`;
  const rows = db
    .prepare(
      `SELECT hn, cid, prefix, first_name, last_name, dob, sex FROM patients
       WHERE ? = '' OR hn = ? OR cid = ? OR first_name || ' ' || last_name LIKE ?
       ORDER BY id DESC LIMIT 50`,
    )
    .all(q, q.toUpperCase(), q, like) as Row[];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">ผู้ป่วย</h1>
        {["CLERK", "ADMIN"].includes(user.role) && (
          <Link href="/patients/new" className="btn">
            + ลงทะเบียนผู้ป่วยใหม่
          </Link>
        )}
      </div>

      {/* plain GET form: search state lives in the URL, works without JS */}
      <form className="flex gap-2">
        <input name="q" defaultValue={q} autoFocus className="input" placeholder="HN, เลขบัตรประชาชน หรือ ชื่อ-นามสกุล" />
        <button className="btn">ค้นหา</button>
      </form>

      <div className="card p-0">
        <table className="table">
          <thead>
            <tr>
              <th>HN</th>
              <th>ชื่อ-นามสกุล</th>
              <th>เลขบัตรประชาชน</th>
              <th>วันเกิด</th>
              <th>เพศ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.hn} className="hover:bg-slate-50">
                <td>
                  <Link href={`/patients/${p.hn}`} className="font-mono text-teal-700 hover:underline">
                    {p.hn}
                  </Link>
                </td>
                <td>
                  {p.prefix}
                  {p.first_name} {p.last_name}
                </td>
                <td className="font-mono">{maskCid(p.cid)}</td>
                <td>{p.dob}</td>
                <td>{p.sex === "M" ? "ชาย" : "หญิง"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-slate-500">
                  ไม่พบผู้ป่วย
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// PDPA: list shows masked national ID, full value only on the patient page
const maskCid = (c: string) => `${c.slice(0, 1)}-XXXX-XXXXX-${c.slice(10, 12)}-${c.slice(12)}`;
