import { requireRole } from "@/lib/auth";
import { PatientForm } from "./form";

export default async function NewPatientPage() {
  await requireRole("CLERK");
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-xl font-semibold">ลงทะเบียนผู้ป่วยใหม่</h1>
      <PatientForm />
    </div>
  );
}
