"use client";

import { useState } from "react";
import { createOrder } from "./actions";

export type CatalogTest = {
  id: number; code: string; name: string; loinc: string | null; specimen_type: string; container: string;
  price: number; tat_days: number; outlab: string | null; used: number;
};

export function OrderForm({ visitId, catalog, recentIds }: { visitId: number; catalog: CatalogTest[]; recentIds: number[] }) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<CatalogTest[]>([]);

  const s = q.trim().toLowerCase();
  const matches = s
    ? catalog.filter(
        (t) => !picked.includes(t) && (t.code.toLowerCase().startsWith(s) || t.name.toLowerCase().includes(s) || t.loinc === s),
      )
    : [];
  const add = (t: CatalogTest) => {
    setPicked([...picked, t]);
    setQ("");
  };
  const total = picked.reduce((sum, t) => sum + t.price, 0);

  return (
    <form action={createOrder} className="grid gap-4 md:grid-cols-[1fr_320px]">
      <input type="hidden" name="visitId" value={visitId} />
      {picked.map((t) => (
        <input key={t.id} type="hidden" name="testId" value={t.id} />
      ))}

      <div className="card space-y-3">
        <div className="relative">
          <label className="label">ค้นหา Test (รหัส / ชื่อ / LOINC) แล้วกด Enter</label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault(); // Enter picks the top match instead of submitting
                if (matches[0]) add(matches[0]);
              }
            }}
            autoFocus
            className="input"
            placeholder="เช่น tsh, vitamin, 4548-4"
          />
          {matches.length > 0 && (
            <ul className="animate-fade-up absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
              {matches.map((t, i) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => add(t)}
                    className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-teal-50 ${i === 0 ? "bg-teal-50" : ""}`}
                  >
                    <span className="w-14 font-mono font-semibold">{t.code}</span>
                    <span className="flex-1">{t.name}</span>
                    <span className="text-xs text-slate-500">{t.outlab ?? "In-house"}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <div className="label">ใช้บ่อย</div>
          <div className="flex flex-wrap gap-2">
            {catalog
              .filter((t) => !picked.includes(t))
              .slice(0, 6)
              .map((t) => (
                <button key={t.id} type="button" onClick={() => add(t)} className="btn-ghost">
                  + {t.code}
                </button>
              ))}
          </div>
        </div>

        <table className="table">
          <thead>
            <tr>
              <th>Test</th>
              <th>สิ่งส่งตรวจ / หลอด</th>
              <th>ส่งตรวจที่</th>
              <th>TAT</th>
              <th className="text-right">ราคา</th>
              <th />
            </tr>
          </thead>
          <tbody className="stagger">
            {picked.map((t) => (
              <tr key={t.id}>
                <td>
                  <span className="font-mono font-semibold">{t.code}</span> {t.name}
                  {recentIds.includes(t.id) && (
                    <div className="text-xs text-amber-700">⚠ ผู้ป่วยได้รับการสั่ง test นี้แล้วภายใน 7 วัน</div>
                  )}
                </td>
                <td className="text-xs">
                  {t.specimen_type}
                  <br />
                  {t.container}
                </td>
                <td>{t.outlab ?? "In-house"}</td>
                <td>{t.tat_days === 0 ? "วันเดียวกัน" : `${t.tat_days} วัน`}</td>
                <td className="text-right">{t.price.toLocaleString()}</td>
                <td>
                  <button type="button" onClick={() => setPicked(picked.filter((x) => x !== t))} className="text-slate-400 hover:text-red-600" aria-label={`ลบ ${t.code}`}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {picked.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-slate-500">
                  ยังไม่ได้เลือก Test
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card h-fit space-y-4">
        <fieldset>
          <legend className="label">ความเร่งด่วน</legend>
          <label className="mr-4 text-sm">
            <input type="radio" name="priority" value="ROUTINE" defaultChecked /> Routine
          </label>
          <label className="text-sm text-red-700">
            <input type="radio" name="priority" value="STAT" /> STAT
          </label>
        </fieldset>
        <div>
          <label className="label">หมายเหตุถึง Lab</label>
          <textarea name="note" rows={3} className="input" />
        </div>
        <div className="flex justify-between border-t border-slate-200 pt-3 text-sm">
          <span>รวม {picked.length} รายการ</span>
          <span className="font-semibold">{total.toLocaleString()} บาท</span>
        </div>
        <button disabled={picked.length === 0} className="btn w-full justify-center">
          ยืนยันสั่ง Lab
        </button>
      </div>
    </form>
  );
}
