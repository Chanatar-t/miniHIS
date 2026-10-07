import Link from "next/link";
import { currentUser } from "@/lib/auth";

export default async function ForbiddenPage() {
  const user = await currentUser();
  return (
    <div className="mx-auto mt-16 max-w-md card space-y-3 text-center">
      <h1 className="text-lg font-semibold">ไม่มีสิทธิ์เข้าถึง</h1>
      <p className="text-sm text-slate-600">
        บทบาท <b>{user?.role ?? "-"}</b> ไม่มีสิทธิ์ทำรายการนี้ การพยายามเข้าถึงถูกบันทึกไว้ใน Audit log แล้ว
      </p>
      <Link href="/" className="btn">
        กลับหน้าแรก
      </Link>
    </div>
  );
}
