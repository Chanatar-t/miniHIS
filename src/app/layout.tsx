import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { IBM_Plex_Sans_Thai } from "next/font/google";
import { currentUser, logout, type Role } from "@/lib/auth";
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
  { href: "/patients", label: "ผู้ป่วย", roles: ["CLERK", "DOCTOR", "LAB", "ADMIN"] },
  { href: "/lab/collect", label: "เก็บสิ่งส่งตรวจ", roles: ["LAB"] },
  { href: "/lab/receive", label: "รับเข้า Lab", roles: ["LAB"] },
  { href: "/lab/shipments", label: "ส่ง Outlab", roles: ["LAB"] },
  { href: "/lab/results", label: "ลงผล", roles: ["LAB"] },
  { href: "/lab/verify", label: "Verify", roles: ["LAB"] },
  { href: "/admin/audit", label: "Audit log", roles: ["ADMIN"] },
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
          <header className="no-print border-b border-slate-200 bg-white">
            <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-2">
              <Link href="/" className="font-semibold text-teal-700">
                Mini HIS
              </Link>
              <nav className="flex gap-4 text-sm">
                {NAV.filter((n) => n.roles.includes(user.role)).map((n) => (
                  <Link key={n.href} href={n.href} className="text-slate-600 hover:text-teal-700">
                    {n.label}
                  </Link>
                ))}
              </nav>
              <form action={signOut} className="ml-auto flex items-center gap-3 text-sm">
                <span>
                  {user.name} <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{user.role}</span>
                </span>
                <button className="btn-ghost">ออกจากระบบ</button>
              </form>
            </div>
          </header>
        )}
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
