// Result message passed back via ?msg= / ?err= after a server action redirect
export function Flash({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  if (sp.err) return <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{sp.err}</p>;
  if (sp.msg) return <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{sp.msg}</p>;
  return null;
}
