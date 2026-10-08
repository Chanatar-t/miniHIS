import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";

export default async function Home() {
  const user = await requireRole();
  redirect(user.role === "LAB" ? "/lab" : user.role === "ADMIN" ? "/admin/audit" : "/patients");
}
