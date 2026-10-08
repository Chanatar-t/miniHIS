"use client";
import { Printer } from "lucide-react";

import { useEffect, useRef, ViewTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import JsBarcode from "jsbarcode";

// Search as you type: updates ?q= after a short pause. Inside a GET form, so Enter / no-JS still work.
export function LiveSearch({ defaultValue, placeholder }: { defaultValue: string; placeholder: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  return (
    <input
      name="q"
      type="search"
      defaultValue={defaultValue}
      placeholder={placeholder}
      autoFocus
      autoComplete="off"
      aria-label={placeholder}
      className="input py-3 text-lg"
      onChange={(e) => {
        const q = e.target.value;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => router.replace(q ? `?q=${encodeURIComponent(q)}` : "?", { scroll: false }), 250);
      }}
    />
  );
}

// Page transition only when the PATH changes (real navigation). Same-path updates — a form action returning an
// error, live search (?q=), paging — re-render in place with no animation, so nothing flickers behind a modal.
export function PageTransition({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <ViewTransition key={path} enter="page-in" exit="page-out" default="none">
      {children}
    </ViewTransition>
  );
}

// top-nav link that shows where you are
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const path = usePathname();
  const active = path === href || path.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 ${active ? "bg-teal-50 font-medium text-teal-800" : "text-slate-600 hover:bg-slate-50 hover:text-teal-700"} transition-colors duration-150`}
    >
      {children}
    </Link>
  );
}

export function Barcode({ value, height = 40 }: { value: string; height?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (ref.current) JsBarcode(ref.current, value, { format: "CODE128", height, width: 1.6, fontSize: 12, margin: 0 });
  }, [value, height]);
  return <svg ref={ref} />;
}

// <select> inside a GET filter form: apply as soon as the value changes (still works as a plain form without JS)
export function AutoSubmitSelect(props: React.ComponentProps<"select">) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}

export function PrintButton({ label = "พิมพ์" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="btn no-print">
      <Printer className="h-4 w-4" aria-hidden /> {label}
    </button>
  );
}
