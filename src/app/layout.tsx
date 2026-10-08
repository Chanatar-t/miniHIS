import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { IBM_Plex_Sans_Thai } from "next/font/google";
import { currentUser, logout, type Role } from "@/lib/auth";
import { NavLink, PageTransition } from "@/components/client";
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

const NAV: { href: string; label: string; roles: Role[] }[] = [
  { href: "/patients", label: "ผู้ป่วย / Visit วันนี้", roles: ["CLERK", "DOCTOR", "LAB", "ADMIN"] },
  // one entry: the lab pages carry their own step bar (collect > receive > ship > results > verify)
  { href: "/lab", label: "🧪 งาน Lab", roles: ["LAB"] },
  { href: "/config", label: "⚙ ค่าอ้างอิง", roles: ["LAB"] },
  { href: "/admin/audit", label: "Audit log", roles: ["ADMIN"] },
  { href: "/guide", label: "📘 คู่มือ / UAT", roles: ["CLERK", "DOCTOR", "LAB", "ADMIN"] },
];

async function signOut() {
  "use server";
  await logout();
  redirect("/login");
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await currentUser();
  return (
    <html lang="th" className={`${font.variable} h-full antialiased`}>
      <body className="min-h-full bg-slate-50 text-slate-900">
        {user && (
          <header className="no-print border-b border-slate-200 bg-white" style={{ viewTransitionName: "site-header" }}>
            <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-2">
              <Link href="/" className="shrink-0 whitespace-nowrap font-semibold text-teal-700">
                Mini HIS
              </Link>
              <nav className="flex flex-wrap gap-1 text-sm">
                {NAV.filter((n) => n.roles.includes(user.role)).map((n) => (
                  <NavLink key={n.href} href={n.href}>
                    {n.label}
                  </NavLink>
                ))}
              </nav>
              <form action={signOut} className="ml-auto flex min-w-0 items-center gap-3 text-sm">
                <span className="min-w-0 truncate" title={user.name}>
                  {user.name} <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{user.role}</span>
                </span>
                <button className="btn-ghost shrink-0 whitespace-nowrap">ออกจากระบบ</button>
              </form>
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
