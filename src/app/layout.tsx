import { BookOpen, Hospital, LogOut, ScrollText, SlidersHorizontal, TestTubeDiagonal, Users, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { IBM_Plex_Sans_Thai } from "next/font/google";
import { currentUser, logout, type Role } from "@/lib/auth";
import { NavLink, PageTransition } from "@/components/client";
import { db } from "@/lib/db";
import { labCounts } from "./lab/steps";
import "./globals.css";

const font = IBM_Plex_Sans_Thai({
  variable: "--font-thai",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Mini HIS · LIS Outlab",
  description: "Portfolio demo: hospital lab ordering and outlab specimen tracking",
};

const NAV: { href: string; label: string; icon: LucideIcon; roles: Role[] }[] = [
  { href: "/patients", label: "ผู้ป่วย / Visit วันนี้", icon: Users, roles: ["CLERK", "DOCTOR", "LAB", "ADMIN"] },
  // one entry: the lab pages carry their own step bar (collect > receive > ship > results > verify)
  { href: "/lab", label: "งาน Lab", icon: TestTubeDiagonal, roles: ["LAB"] },
  { href: "/config", label: "ค่าอ้างอิง", icon: SlidersHorizontal, roles: ["LAB"] },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText, roles: ["ADMIN"] },
  { href: "/guide", label: "คู่มือ / UAT", icon: BookOpen, roles: ["CLERK", "DOCTOR", "LAB", "ADMIN"] },
];

async function signOut() {
  "use server";
  await logout();
  redirect("/login");
}

const ROLE_TH: Record<Role, string> = { CLERK: "เวชระเบียน", DOCTOR: "แพทย์", LAB: "ห้องปฏิบัติการ", ADMIN: "ผู้ดูแลระบบ" };

// work waiting behind a menu item, so the header itself says where to go next
function badges(user: { role: Role; canApprove: number }) {
  const out: Record<string, { n: number; urgent?: boolean; title: string }> = {};
  if (user.role === "LAB") {
    const c = labCounts();
    const n = c.collect + c.receive + c.ship + c.results + c.verify;
    if (n) out["/lab"] = { n, urgent: c.critical > 0, title: c.critical ? `มีค่าวิกฤตรอ Verify ${c.critical} รายการ` : `งานค้าง ${n}` };
    const pending = (db.prepare("SELECT COUNT(*) AS n FROM test_ranges WHERE status = 'PENDING'").get() as { n: number }).n;
    if (pending) out["/config"] = { n: pending, title: user.canApprove ? `รอคุณอนุมัติ ${pending}` : `รออนุมัติ ${pending}` };
  }
  return out;
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await currentUser();
  const badge = user ? badges(user) : {};
  return (
    <html lang="th" className={`${font.variable} h-full antialiased`}>
      <body className="min-h-full bg-slate-50 text-slate-900">
        {user && (
          <header
            className="no-print sticky top-0 z-40 bg-gradient-to-r from-teal-900 via-teal-800 to-teal-700 text-white shadow-md shadow-teal-900/10"
            style={{ viewTransitionName: "site-header" }}
          >
            <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
              <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="Mini HIS หน้าแรก">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-teal-700 shadow-sm">
                  <Hospital className="h-5 w-5" aria-hidden />
                </span>
                <span className="hidden leading-tight sm:block">
                  <span className="block text-sm font-semibold">Mini HIS</span>
                  <span className="block text-[10px] tracking-wide text-teal-200">LIS OUTLAB</span>
                </span>
              </Link>
              <span className="hidden h-6 w-px bg-white/15 sm:block" aria-hidden />
              {/* scrolls sideways on small screens instead of wrapping */}
              <nav aria-label="เมนูหลัก" className="-my-2 flex min-w-0 flex-1 gap-1 overflow-x-auto py-2 text-sm [scrollbar-width:none]">
                {NAV.filter((n) => n.roles.includes(user.role)).map((n) => {
                  const b = badge[n.href];
                  return (
                    <NavLink key={n.href} href={n.href} label={n.label}>
                      <n.icon className="h-4 w-4 shrink-0" aria-hidden />
                      <span className="hidden md:inline">{n.label}</span>
                      {b && (
                        <span
                          title={b.title}
                          className={`min-w-5 rounded-full px-1.5 text-center text-[11px] font-bold leading-5 ${b.urgent ? "bg-red-500 text-white" : "bg-amber-400 text-amber-950"}`}
                        >
                          {b.n}
                        </span>
                      )}
                    </NavLink>
                  );
                })}
              </nav>
              <div className="flex min-w-0 shrink-0 items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15 text-sm font-semibold ring-1 ring-white/25" aria-hidden>
                  {user.name.replace(/^(นพ\.|พญ\.|ทนพ\.|นาย|นาง|นางสาว)/, "").trim().slice(0, 1)}
                </span>
                <span className="hidden min-w-0 leading-tight lg:block">
                  <span className="block max-w-44 truncate text-sm font-medium" title={user.name}>
                    {user.name}
                  </span>
                  <span className="block text-[11px] text-teal-200">
                    {ROLE_TH[user.role]}
                    {user.canApprove ? " · ผู้อนุมัติค่าอ้างอิง" : ""}
                  </span>
                </span>
                <form action={signOut}>
                  <button
                    title="ออกจากระบบ"
                    aria-label={`ออกจากระบบ (${user.name})`}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-teal-100 transition hover:bg-white/15 hover:text-white active:scale-95"
                  >
                    <LogOut className="h-4 w-4" aria-hidden />
                  </button>
                </form>
              </div>
            </div>
          </header>
        )}
        <main className="mx-auto max-w-6xl px-4 py-6">
          <PageTransition>{children}</PageTransition>
        </main>
      </body>
    </html>
  );
}
