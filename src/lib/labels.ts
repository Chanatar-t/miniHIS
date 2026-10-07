export const SCHEME: Record<string, string> = {
  UC: "บัตรทอง (UC)",
  SSS: "ประกันสังคม",
  CSMBS: "ข้าราชการ",
  SELF: "ชำระเงินเอง",
};

export const ITEM_STATUS: Record<string, { label: string; cls: string }> = {
  ORDERED: { label: "รอเก็บสิ่งส่งตรวจ", cls: "bg-slate-100 text-slate-700" },
  COLLECTED: { label: "เก็บแล้ว", cls: "bg-sky-100 text-sky-800" },
  RECEIVED: { label: "Lab รับแล้ว", cls: "bg-indigo-100 text-indigo-800" },
  SENT: { label: "ส่ง Outlab", cls: "bg-violet-100 text-violet-800" },
  RESULTED: { label: "รอ Verify", cls: "bg-amber-100 text-amber-800" },
  VERIFIED: { label: "รายงานผลแล้ว", cls: "bg-emerald-100 text-emerald-800" },
  REJECTED: { label: "Reject", cls: "bg-red-100 text-red-700" },
  CANCELLED: { label: "ยกเลิก", cls: "bg-slate-100 text-slate-400 line-through" },
};

export const REJECT_REASONS = [
  "Hemolyzed",
  "Clotted",
  "QNS (ปริมาณไม่พอ)",
  "ติดฉลากผิด/ไม่มีฉลาก",
  "เกินเวลาที่กำหนด",
  "สูญหายระหว่างขนส่ง",
] as const;

export function age(dob: string, at = new Date()) {
  const d = new Date(dob);
  let y = at.getFullYear() - d.getFullYear();
  if (at < new Date(at.getFullYear(), d.getMonth(), d.getDate())) y--;
  return y;
}
