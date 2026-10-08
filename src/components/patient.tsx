import Link from "next/link";
import { SCHEME, VISIT_STATUS, age, queueNo } from "@/lib/labels";
import type { TodayVisit } from "@/lib/visits";
import { bmi, bmiLabel, vitalAlerts } from "@/lib/rules";

// One back button style everywhere: pill with a chevron, says where it goes
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="no-print group inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white py-1 pl-1 pr-4 text-sm text-slate-600 shadow-sm transition hover:border-teal-300 hover:text-teal-700"
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 transition group-hover:bg-teal-50 group-hover:-translate-x-0.5">
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
          <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 0 1-.02 1.06L8.83 10l3.94 3.71a.75.75 0 1 1-1.04 1.08l-4.5-4.25a.75.75 0 0 1 0-1.08l4.5-4.25a.75.75 0 0 1 1.06.02Z" clipRule="evenodd" />
        </svg>
      </span>
      {children}
    </Link>
  );
}

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
export function TodayList({ visits, highlight, action }: { visits: TodayVisit[]; highlight?: string; action?: "order" | "vitals" }) {
  if (visits.length === 0)
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
        ยังไม่มีผู้ป่วยเปิด Visit วันนี้
      </div>
    );
  return (
    <ul className="stagger space-y-2">
      {visits.map((v) => (
        <li
          key={v.id}
          className={`flex items-center gap-3 rounded-lg border bg-white p-3 transition-shadow duration-200 hover:shadow-sm ${v.vn === highlight ? "border-emerald-400 ring-2 ring-emerald-200" : "border-slate-200"}`}
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
          {action === "vitals" && (
            <Link href={`/patients/${v.hn}`} className={`${v.status === "WAIT_SCREEN" ? "btn" : "btn-ghost"} whitespace-nowrap`}>
              ซักประวัติ
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

export type VitalsRow = {
  sbp: number | null; dbp: number | null; pulse: number | null; rr: number | null; temp: number | null; spo2: number | null;
  weight: number | null; height: number | null; cc: string | null;
};

// One line of vital signs + red chips for what's out of range (screening cues only)
export function VitalsLine({ v }: { v: VitalsRow }) {
  const b = bmi(v.weight, v.height);
  const parts = [
    v.sbp !== null && `BP ${v.sbp}/${v.dbp}`,
    v.pulse !== null && `P ${v.pulse}`,
    v.rr !== null && `RR ${v.rr}`,
    v.temp !== null && `T ${v.temp}°C`,
    v.spo2 !== null && `SpO2 ${v.spo2}%`,
    v.weight !== null && `นน. ${v.weight} kg`,
    v.height !== null && `สส. ${v.height} cm`,
    b !== null && `BMI ${b} (${bmiLabel(b)})`,
  ].filter(Boolean);
  return (
    <div className="space-y-1 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {parts.map((p) => (
          <span key={String(p)}>{p}</span>
        ))}
        {vitalAlerts(v).map((a) => (
          <span key={a} className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
            {a}
          </span>
        ))}
      </div>
      {v.cc && <div className="text-slate-600">อาการสำคัญ: {v.cc}</div>}
    </div>
  );
}
