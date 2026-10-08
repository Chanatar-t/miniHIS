"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { db, audit } from "@/lib/db";
import { login, requireRole } from "@/lib/auth";
import { ALL_CASES } from "@/lib/guide";

// "Try as this role" from the guide: demo login, then jump to the page being taught
export async function tryAs(formData: FormData) {
  const userId = z.coerce.number().int().positive().parse(formData.get("userId"));
  const href = String(formData.get("href") ?? "/");
  if (!href.startsWith("/") || href.startsWith("//")) throw new Error("Bad redirect"); // no open redirect
  if (!db.prepare("SELECT 1 FROM users WHERE id = ?").get(userId)) throw new Error("Unknown user");
  await login(userId);
  audit(db, userId, "LOGIN", "user", userId, "from guide");
  redirect(href);
}

export async function recordUat(formData: FormData) {
  const user = await requireRole();
  const caseId = String(formData.get("caseId"));
  const c = ALL_CASES.find((x) => x.id === caseId);
  if (!c) throw new Error("Unknown test case");
  const status = z.enum(["PASS", "FAIL", "BLOCKED"]).parse(formData.get("status"));
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);
  db.prepare("INSERT INTO uat_results(case_id, user_id, status, note) VALUES (?, ?, ?, ?)").run(caseId, user.id, status, note || null);
  redirect(`/guide/${c.guide.slug}?saved=${caseId}#${caseId}`);
}
