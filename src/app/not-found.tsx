import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto mt-16 max-w-md card space-y-3 text-center">
      <h1 className="text-lg font-semibold">ไม่พบข้อมูล</h1>
      <p className="text-sm text-slate-600">ไม่พบหน้าหรือรายการที่ต้องการ อาจพิมพ์เลขผิด หรือรายการถูกลบไปแล้ว</p>
      <Link href="/" className="btn">
        กลับหน้าแรก
      </Link>
    </div>
  );
}
