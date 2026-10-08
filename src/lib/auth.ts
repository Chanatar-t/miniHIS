import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { db, audit } from "./db";

export type Role = "CLERK" | "DOCTOR" | "LAB" | "ADMIN";
// canApprove: permission on top of the role (e.g. a pathologist who is LAB and may approve reference ranges)
export type User = { id: number; username: string; name: string; role: Role; canApprove: number };

// ponytail: demo login = pick a user, no password. Cookie is HMAC-signed so the role can't be forged.
// Real deployment: hospital SSO / LDAP + password policy.
const g = globalThis as unknown as { __secret?: string };
const SECRET = process.env.SESSION_SECRET ?? (g.__secret ??= randomBytes(32).toString("hex"));
const COOKIE = "session";

const sign = (id: string) => createHmac("sha256", SECRET).update(id).digest("hex");

export async function login(userId: number) {
  (await cookies()).set(COOKIE, `${userId}.${sign(String(userId))}`, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8, // one shift
  });
}

export async function logout() {
  (await cookies()).delete(COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const [id, mac] = raw.split(".");
  const expected = sign(id);
  if (!mac || mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  return (db.prepare("SELECT id, username, name, role, can_approve_config AS canApprove FROM users WHERE id = ?").get(Number(id)) as User) ?? null;
}

// Use in every page AND every server action: hiding a button is not access control.
export async function requireRole(...roles: Role[]): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (roles.length && !roles.includes(user.role)) {
    audit(db, user.id, "DENY", "role", null, `${user.role} needs ${roles.join("|")}`);
    redirect("/forbidden");
  }
  return user;
}
