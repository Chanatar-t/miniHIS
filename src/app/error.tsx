"use client";

// Unexpected errors only; expected business errors are shown as flash messages (lib/flash.ts).
// In production the message is hidden by Next.js, only the digest is shown (matches the server log).
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="mx-auto mt-16 max-w-md card space-y-3 text-center">
      <h1 className="text-lg font-semibold">เกิดข้อผิดพลาด</h1>
      <p className="text-sm text-slate-600">ระบบไม่สามารถทำรายการนี้ได้ ข้อมูลไม่ถูกบันทึก กรุณาลองใหม่ หรือแจ้งผู้ดูแลระบบ</p>
      {error.digest && <p className="font-mono text-xs text-slate-400">รหัสอ้างอิง: {error.digest}</p>}
      <button onClick={() => retry()} className="btn">
        ลองใหม่
      </button>
    </div>
  );
}
