import { FLAG, ITEM_STATUS, isCritical, refRange, thDate } from "@/lib/labels";

export type ResultRow = {
  item_id: number; test_id: number; code: string; name: string; status: string; value: string | null; flag: string | null;
  unit: string | null; ref_low: number | null; ref_high: number | null; outlab: string | null; amended?: number;
  prev?: { value: string; date: string } | null;
};

// The source of truth a doctor reads: real values, units, reference range, flag, and last time's value.
// Unverified results are never shown as numbers.
export function ResultsTable({ rows }: { rows: ResultRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="table min-w-[640px]">
        <thead>
          <tr>
            <th>รายการตรวจ</th>
            <th className="text-right">ผล</th>
            <th />
            <th>หน่วย</th>
            <th>ค่าอ้างอิง</th>
            <th>ครั้งก่อน</th>
          </tr>
        </thead>
        <tbody className="stagger">
          {rows.map((r) => {
            const done = r.status === "VERIFIED";
            return (
              <tr key={r.item_id} className={done && isCritical(r.flag) ? "bg-red-50" : ""}>
                <td>
                  <span className="font-mono font-semibold">{r.code}</span> <span className="text-slate-600">{r.name}</span>
                  {r.outlab && <span className="ml-1 text-xs text-slate-400">· {r.outlab}</span>}
                </td>
                {done ? (
                  <>
                    <td className="text-right text-base font-semibold tabular-nums">
                      {r.value}
                      {r.amended ? <span className="ml-1 text-xs font-normal text-amber-700">(แก้ไข)</span> : null}
                    </td>
                    <td>
                      {r.flag && r.flag !== "N" && <span className={`rounded px-1.5 py-0.5 text-xs ${FLAG[r.flag].cls}`}>{FLAG[r.flag].label}</span>}
                    </td>
                  </>
                ) : (
                  <td colSpan={2} className="text-right">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${ITEM_STATUS[r.status].cls}`}>{ITEM_STATUS[r.status].label}</span>
                  </td>
                )}
                <td className="text-xs text-slate-500">{r.unit}</td>
                <td className="text-xs text-slate-500 tabular-nums">{refRange(r.ref_low, r.ref_high)}</td>
                <td className="text-xs text-slate-500">
                  {r.prev ? (
                    <span title={`ผลเมื่อ ${thDate(r.prev.date, false)}`}>
                      <span className="tabular-nums">{r.prev.value}</span> <Trend now={done ? r.value : null} before={r.prev.value} />
                      <span className="block text-[11px] text-slate-400">{thDate(r.prev.date, false)}</span>
                    </span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// direction only, deliberately neutral colour: whether "up" is good depends on the test
function Trend({ now, before }: { now: string | null; before: string }) {
  const a = Number(now), b = Number(before);
  if (now == null || Number.isNaN(a) || Number.isNaN(b)) return null;
  const [sym, label] = a > b ? ["↑", "สูงขึ้น"] : a < b ? ["↓", "ลดลง"] : ["→", "เท่าเดิม"];
  return (
    <span aria-label={`เทียบครั้งก่อน ${label}`} className="font-semibold text-slate-600">
      {sym}
    </span>
  );
}
