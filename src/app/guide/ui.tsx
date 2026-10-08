import { Check, CircleSlash, X } from "lucide-react";
import type { RoleGuide } from "@/lib/guide";

// **bold** = on-screen label, `code` = something to type
export function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
        part.startsWith("**") ? (
          <b key={i} className="font-semibold text-slate-900">
            {part.slice(2, -2)}
          </b>
        ) : part.startsWith("`") ? (
          <code key={i} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.85em] text-slate-800">
            {part.slice(1, -1)}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}

// literal class names so Tailwind can see them
export const TONE: Record<RoleGuide["tone"], { solid: string; soft: string; text: string; ring: string; bar: string }> = {
  sky: { solid: "bg-sky-600", soft: "bg-sky-50 border-sky-200", text: "text-sky-700", ring: "ring-sky-200", bar: "bg-sky-500" },
  teal: { solid: "bg-teal-600", soft: "bg-teal-50 border-teal-200", text: "text-teal-700", ring: "ring-teal-200", bar: "bg-teal-500" },
  violet: { solid: "bg-violet-600", soft: "bg-violet-50 border-violet-200", text: "text-violet-700", ring: "ring-violet-200", bar: "bg-violet-500" },
  amber: { solid: "bg-amber-600", soft: "bg-amber-50 border-amber-200", text: "text-amber-800", ring: "ring-amber-200", bar: "bg-amber-500" },
  rose: { solid: "bg-rose-600", soft: "bg-rose-50 border-rose-200", text: "text-rose-700", ring: "ring-rose-200", bar: "bg-rose-500" },
  slate: { solid: "bg-slate-700", soft: "bg-slate-50 border-slate-200", text: "text-slate-700", ring: "ring-slate-200", bar: "bg-slate-500" },
};

export const STATUS: Record<string, { label: string; cls: string; dot: string }> = {
  PASS: { label: "ผ่าน", cls: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-500" },
  FAIL: { label: "ไม่ผ่าน", cls: "bg-red-100 text-red-700", dot: "bg-red-500" },
  BLOCKED: { label: "ทดสอบไม่ได้", cls: "bg-amber-100 text-amber-800", dot: "bg-amber-500" },
  NONE: { label: "ยังไม่ทดสอบ", cls: "bg-slate-100 text-slate-500", dot: "bg-slate-300" },
};

export function Progress({ pass, fail, blocked, total }: { pass: number; fail: number; blocked: number; total: number }) {
  const pct = (n: number) => `${total ? (n / total) * 100 : 0}%`;
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-slate-200" role="img" aria-label={`ผ่าน ${pass} ไม่ผ่าน ${fail} ทดสอบไม่ได้ ${blocked} จาก ${total}`}>
        <div className="bg-emerald-500" style={{ width: pct(pass) }} />
        <div className="bg-red-500" style={{ width: pct(fail) }} />
        <div className="bg-amber-400" style={{ width: pct(blocked) }} />
      </div>
      <div className="mt-1 flex gap-3 text-xs text-slate-500">
        <span className="inline-flex items-center gap-0.5"><Check className="h-3 w-3" aria-hidden /> ผ่าน {pass}</span>
        {fail > 0 && <span className="inline-flex items-center gap-0.5 text-red-600"><X className="h-3 w-3" aria-hidden /> ไม่ผ่าน {fail}</span>}
        {blocked > 0 && <span className="inline-flex items-center gap-0.5 text-amber-700"><CircleSlash className="h-3 w-3" aria-hidden /> ทดสอบไม่ได้ {blocked}</span>}
        <span className="ml-auto">
          {pass + fail + blocked}/{total} ทดสอบแล้ว
        </span>
      </div>
    </div>
  );
}
