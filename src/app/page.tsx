import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";

export default async function Home() {
  await requireRole();
  redirect("/patients");
}
