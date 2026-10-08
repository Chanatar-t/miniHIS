import Link from "next/link";
import { notFound } from "next/navigation";
import { db, audit } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { SCHEME, ITEM_STATUS, ORDER_STATUS, VISIT_STATUS, FLAG, age, thDate, queueNo } from "@/lib/labels";
import { orderStatus } from "@/lib/rules";
import { todayVisits } from "@/lib/visits";
import { Avatar, BackLink, fullName } from "@/components/patient";
import { openVisit } from "../actions";
import { AiSummaryCard } from "./ai-card";

type Patient = {
  id: number; hn: string; cid: string; prefix: string; first_name: string; last_name: string;
  dob: string; sex: string; phone: string | null; created_at: string;
};
type Visit = { id: number; vn: string; scheme: string; created_at: string };
type Item = {
  item_id: number; visit_id: number; order_id: number; priority: string; ordered_at: string; doctor: string;
  code: string; name: string; status: string; outlab: string | null; accession_no: string | null; shipment_no: string | null;
  value: string | null; flag: string | null; unit: string | null;
};

export default async function PatientPage({ params, searchParams }: PageProps<"/patients/[hn]">) {
  const user = await requireRole();
  const { hn } = await params;
  const sp = await searchParams;
  const p = db.prepare("SELECT * FROM patients WHERE hn = ?").get(hn) as Patient | undefined;
  if (!p) notFound();
  audit(db, user.id, "VIEW", "patient", p.id); // PDPA: who looked at whom

  const visits = db.prepare("SELECT id, vn, scheme, created_at FROM visits WHERE patient_id = ? ORDER BY id DESC").all(p.id) as Visit[];
  // least privilege: the front desk sees visits, not lab results
  const seesLab = user.role === "DOCTOR" || user.role === "LAB";
  const items = seesLab
    ? (db
        .prepare(
          `SELECT o.visit_id, o.id AS order_id, o.priority, o.ordered_at, u.name AS doctor,
                  i.id AS item_id, t.code, t.name, i.status, ol.code AS outlab, s.accession_no, sh.shipment_no, i.value, i.flag, t.unit
           FROM lab_orders o JOIN visits v ON v.id = o.visit_id JOIN users u ON u.id = o.ordered_by
           JOIN lab_order_items i ON i.order_id = o.id JOIN lab_tests t ON t.id = i.test_id
           LEFT JOIN outlabs ol ON ol.id = t.outlab_id LEFT JOIN specimens s ON s.id = i.specimen_id
           LEFT JOIN shipments sh ON sh.id = s.shipment_id
           WHERE v.patient_id = ? ORDER BY o.id DESC, i.id`,
        )
        .all(p.id) as Item[])
    : [];
  const testCount = new Map(
    (
      db
        .prepare(
          `SELECT o.visit_id, COUNT(*) AS n FROM lab_orders o JOIN lab_order_items i ON i.order_id = o.id JOIN visits v ON v.id = o.visit_id
           WHERE v.patient_id = ? AND i.status NOT IN ('REJECTED','CANCELLED') GROUP BY o.visit_id`,
        )
        .all(p.id) as { visit_id: number; n: number }[]
    ).map((r) => [r.visit_id, r.n]),
  );
  const today = todayVisits(p.id)[0];

  return (
    <div className="space-y-5">
      <BackLink href="/patients">รายชื่อผู้ป่วย</BackLink>

      {sp.registered && (
        <p className="animate-fade-up rounded-lg bg-emerald-50 px-4 py-3 text-emerald-900">
          ✓ ลงทะเบียนสำเร็จ ได้ <b className="font-mono">{p.hn}</b> {!today && "· ขั้นต่อไป: เลือกสิทธิแล้วกด เปิด Visit วันนี้ ด้านขวา"}
        </p>
      )}
      {sp.existed && <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">มี Visit วันนี้อยู่แล้ว ไม่ได้เปิดซ้ำ</p>}

      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        {/* who */}
        <section className="card flex gap-5">
          <Avatar name={p.first_name} sex={p.sex} size="lg" />
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <h1 className="text-2xl font-semibold">{fullName(p)}</h1>
              <div className="mt-1 flex flex-wrap gap-2 text-sm">
                <span className="rounded-md bg-slate-800 px-2 py-0.5 font-mono text-white">{p.hn}</span>
                <span className="rounded-md bg-slate-100 px-2 py-0.5">
                  {p.sex === "M" ? "ชาย" : "หญิง"} {age(p.dob)} ปี
                </span>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div>
                <dt className="text-xs text-slate-500">วันเกิด</dt>
                <dd>{thDate(p.dob, false)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">เบอร์โทร</dt>
                <dd>{p.phone ?? "-"}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">เลขบัตรประชาชน</dt>
                <dd className="font-mono">{p.cid}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">มารับบริการ</dt>
                <dd>{visits.length} ครั้ง</dd>
              </div>
            </dl>
          </div>
        </section>

        {/* today: the one thing to do next */}
        <section className={`rounded-xl border p-4 ${today ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}>
          <h2 className="text-sm font-semibold text-slate-600">Visit วันนี้</h2>
          {today ? (
            <div className="mt-2 flex items-center gap-4">
              <div className="flex h-16 w-16 flex-col items-center justify-center rounded-xl bg-emerald-600 text-white">
                <span className="text-[10px]">คิวที่</span>
                <span className="text-2xl font-bold leading-none">{queueNo(today.vn)}</span>
              </div>
              <div className="flex-1 space-y-1 text-sm">
                <div className="font-mono">{today.vn}</div>
                <div>{SCHEME[today.scheme]}</div>
                <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${VISIT_STATUS[today.status].cls}`}>{VISIT_STATUS[today.status].label}</span>
              </div>
              {user.role === "DOCTOR" && (
                <Link href={`/visits/${today.vn}/order`} className="btn px-4 py-2">
                  สั่ง Lab
                </Link>
              )}
            </div>
          ) : user.role === "CLERK" ? (
            <form action={openVisit} className="mt-2 space-y-2">
              <input type="hidden" name="patientId" value={p.id} />
              <label className="label" htmlFor="scheme">
                สิทธิการรักษา
              </label>
              <select id="scheme" name="scheme" className="input">
                {Object.entries(SCHEME).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <button className="btn w-full justify-center py-2 text-base">เปิด Visit วันนี้</button>
            </form>
          ) : (
            <p className="mt-2 text-sm text-slate-500">ยังไม่มี Visit วันนี้ เวชระเบียนเป็นผู้เปิด Visit ก่อนพบแพทย์</p>
          )}
        </section>
      </div>

      {user.role === "DOCTOR" && <AiSummaryCard patientId={p.id} />}

      <section className="stagger space-y-3">
        <h2 className="text-lg font-semibold">ประวัติการมารับบริการ</h2>
        {visits.length === 0 && <p className="text-sm text-slate-500">ยังไม่เคยมารับบริการ</p>}
        {visits.map((v) => {
          const orders = [...Map.groupBy(items.filter((i) => i.visit_id === v.id), (i) => i.order_id).values()];
          return (
            <article key={v.id} className="card space-y-3">
              <header className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="font-semibold">{thDate(v.created_at)}</span>
                <span className="text-sm text-slate-500">
                  คิว {queueNo(v.vn)} · <span className="font-mono">{v.vn}</span>
                </span>
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs">{SCHEME[v.scheme]}</span>
                <span className="ml-auto text-sm text-slate-500">ตรวจ Lab {testCount.get(v.id) ?? 0} รายการ</span>
              </header>
              {orders.map((its) => {
                const o = its[0];
                const st = ORDER_STATUS[orderStatus(its.map((i) => i.status))];
                return (
                  <div key={o.order_id} className="rounded-lg border border-slate-200">
                    <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                      <Link href={`/reports/${o.order_id}`} className="font-medium text-teal-700 hover:underline">
                        ใบสั่ง #{o.order_id} · ดูใบรายงาน
                      </Link>
                      {o.priority === "STAT" && <b className="text-red-600">STAT</b>}
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
                      <span className="ml-auto text-xs text-slate-500">
                        {o.doctor} · {thDate(o.ordered_at)}
                      </span>
                    </div>
                    <ul className="divide-y divide-slate-100">
                      {its.map((i) => (
                        <li key={i.item_id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
                          <div className="min-w-48 flex-1">
                            <span className="font-mono font-semibold">{i.code}</span> <span className="text-slate-600">{i.name}</span>
                            {user.role === "LAB" && i.accession_no && (
                              <div className="font-mono text-xs text-slate-400">
                                {i.accession_no}
                                {i.shipment_no && ` · ${i.shipment_no}`}
                              </div>
                            )}
                          </div>
                          <span className="w-24 text-xs text-slate-500">{i.outlab ?? "ในโรงพยาบาล"}</span>
                          <div className="w-48 text-right">
                            {/* value only once verified: unverified results are never shown to clinicians */}
                            {i.status === "VERIFIED" ? (
                              <span className="font-semibold">
                                {i.value} <span className="text-xs font-normal text-slate-500">{i.unit}</span>{" "}
                                {i.flag && i.flag !== "N" && <span className={`rounded px-1.5 py-0.5 text-xs ${FLAG[i.flag].cls}`}>{FLAG[i.flag].label}</span>}
                              </span>
                            ) : (
                              <span className={`rounded-full px-2 py-0.5 text-xs ${ITEM_STATUS[i.status].cls}`}>{ITEM_STATUS[i.status].label}</span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </article>
          );
        })}
      </section>
    </div>
  );
}
