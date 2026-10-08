import { CircleCheck, CircleX } from "lucide-react";
// Result message passed back via ?msg= / ?err= after a server action redirect
export function Flash({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  if (sp.err) return <p role="alert" className="animate-fade-up flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"><CircleX className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><span>{sp.err}</span></p>;
  if (sp.msg) return <p role="status" className="animate-fade-up flex items-start gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800"><CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><span>{sp.msg}</span></p>;
  return null;
}
