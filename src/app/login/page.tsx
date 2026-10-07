import { redirect } from "next/navigation";
import { db, audit } from "@/lib/db";
import { login } from "@/lib/auth";

type U = { id: number; name: string; role: string };

async function signIn(formData: FormData) {
  "use server";
  const id = Number(formData.get("userId"));
  if (!db.prepare("SELECT 1 FROM users WHERE id = ?").get(id)) throw new Error("Unknown user");
  await login(id);
  audit(db, id, "LOGIN", "user", id);
  redirect("/");
}

export default function LoginPage() {
  const users = db.prepare("SELECT id, name, role FROM users ORDER BY id").all() as U[];
  return (
    <div className="mx-auto mt-16 max-w-sm card">
      <h1 className="text-lg font-semibold">เข้าสู่ระบบ</h1>
      <p className="mt-1 text-sm text-slate-500">เดโม: เลือกผู้ใช้ตามบทบาท (ข้อมูลทั้งหมดเป็นข้อมูลสมมติ)</p>
      <div className="mt-4 space-y-2">
        {users.map((u) => (
          <form key={u.id} action={signIn}>
            <input type="hidden" name="userId" value={u.id} />
            <button className="btn-ghost w-full justify-between">
              <span>{u.name}</span>
              <span className="text-xs text-slate-500">{u.role}</span>
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}
