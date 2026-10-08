import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { LAB_STEPS, labCounts } from "./steps";

// "งาน Lab" in the menu: jump to the first step that has work waiting (critical verifies first)
export default async function LabHome() {
  await requireRole("LAB");
  const c = labCounts();
  if (c.critical > 0) redirect("/lab/verify");
  redirect(LAB_STEPS.find((s) => c[s.key] > 0)?.href ?? "/lab/collect");
}
