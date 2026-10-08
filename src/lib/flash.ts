import { redirect } from "next/navigation";

// Expected business-rule failure ("already received", "nothing to ship"): show it to the user, don't 500.
// Throw inside tx() so the transaction rolls back first.
export class UserError extends Error {}
// function declaration (not arrow) so TypeScript narrows after `if (!x) fail(...)`
export function fail(msg: string): never {
  throw new UserError(msg);
}

export const back = (path: string, msg: string, ok = true): never =>
  redirect(`${path}${path.includes("?") ? "&" : "?"}${new URLSearchParams({ [ok ? "msg" : "err"]: msg })}`);

// Run an action body; UserError -> ?err= on `path`, returned string -> ?msg=. Anything else still throws (real bug).
export async function withFlash(path: string, fn: () => Promise<string | void>) {
  let msg: string | void;
  try {
    msg = await fn();
  } catch (e) {
    if (e instanceof UserError) back(path, e.message, false);
    throw e;
  }
  if (msg) back(path, msg);
}
