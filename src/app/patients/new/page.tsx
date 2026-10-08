import { BackLink } from "@/components/patient";
import { requireRole } from "@/lib/auth";
import { PatientForm } from "./form";

export default async function NewPatientPage({ searchParams }: PageProps<"/patients/new">) {
  await requireRole("CLERK");
  const sp = await searchParams;
  // carried over from the search box: 13 digits -> CID, otherwise "first last"
  const [first_name = "", ...rest] = String(sp.name ?? "").trim().split(/\s+/);
  const initial = { cid: String(sp.cid ?? ""), first_name, last_name: rest.join(" ") };
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <BackLink href="/patients">รายชื่อผู้ป่วย</BackLink>
      <h1 className="text-2xl font-semibold">ลงทะเบียนผู้ป่วยใหม่</h1>
      <p className="text-sm text-slate-500">บันทึกแล้วจะได้ HN ทันที และเปิด Visit ต่อได้ในหน้าถัดไป</p>
      <PatientForm initial={initial} />
    </div>
  );
}
