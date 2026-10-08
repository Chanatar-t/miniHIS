import Link from "next/link";
import { SCHEME, VISIT_STATUS, age, queueNo } from "@/lib/labels";
import type { TodayVisit } from "@/lib/visits";

export function Avatar({ name, sex, size = "md" }: { name: string; sex: string; size?: "md" | "lg" }) {
  const s = size === "lg" ? "h-16 w-16 text-2xl" : "h-10 w-10 text-base";
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${s} ${sex === "F" ? "bg-rose-100 text-rose-700" : "bg-sky-100 text-sky-700"}`}
    >
      {name.slice(0, 1)}
    </span>
  );
}

export const fullName = (p: { prefix: string; first_name: string; last_name: string }) => `${p.prefix}${p.first_name} ${p.last_name}`;

// "Visit วันนี้" list shared by the front desk and the doctor
export function TodayList({ visits, highlight, action }: { visits: TodayVisit[]; highlight?: string; action?: "order" }) {
  if (visits.length === 0)
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
        ยังไม่มีผู้ป่วยเปิด Visit วันนี้
      </div>
    );
  return (
    <ul className="space-y-2">
      {visits.map((v) => (
        <li
          key={v.id}
          className={`flex items-center gap-3 rounded-lg border bg-white p-3 ${v.vn === highlight ? "border-emerald-400 ring-2 ring-emerald-200" : "border-slate-200"}`}
        >
          <div className="w-12 text-center">
            <div className="text-[10px] text-slate-400">คิว</div>
            <div className="text-xl font-semibold leading-none">{queueNo(v.vn)}</div>
          </div>
          <div className="min-w-0 flex-1">
            <Link href={`/patients/${v.hn}`} className="block truncate font-medium hover:text-teal-700">
              {fullName(v)}
            </Link>
            <div className="text-xs text-slate-500">
              <span className="font-mono">{v.hn}</span> · {v.sex === "M" ? "ชาย" : "หญิง"} {age(v.dob)} ปี · {SCHEME[v.scheme]}
            </div>
          </div>
          <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${VISIT_STATUS[v.status].cls}`}>
            {VISIT_STATUS[v.status].label}
            {v.tests > 0 && ` · ${v.tests} test`}
          </span>
          {action === "order" && (
            <Link href={`/visits/${v.vn}/order`} className="btn whitespace-nowrap">
              สั่ง Lab
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}
