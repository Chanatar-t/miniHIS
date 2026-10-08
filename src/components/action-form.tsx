"use client";

import { startTransition, useActionState } from "react";

export type ActionState = { error?: string };

// Form for server actions that must not lose what was typed:
// - errors render inside the form (no redirect), values stay put
// - submits itself instead of <form action>, so React does not run form.reset() afterwards
//   (that reset silently snaps <select>s back to their first option)
// - action={...} kept as the no-JS fallback
export function ActionForm({
  action,
  className,
  children,
}: {
  action: (prev: ActionState, data: FormData) => Promise<ActionState>;
  className?: string;
  children: React.ReactNode;
}) {
  const [state, run, pending] = useActionState(action, {});
  return (
    <form
      action={run}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => run(data));
      }}
      aria-busy={pending}
      className={className}
    >
      {children}
      {state.error && (
        <p role="alert" className="animate-fade-up col-span-full rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
    </form>
  );
}
