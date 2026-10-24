import { AddLeadForm } from "@/components/AddLeadForm";
import { createQuickLead } from "@/lib/actions";
import { requireStaff } from "@/lib/session";
import { chicagoDay } from "@/lib/time";

export default async function NewLeadPage() {
  await requireStaff();
  return (
    <main className="mx-auto max-w-md px-4 py-6">
      <h1 className="text-xl font-semibold tracking-tight text-navy">Add a lead</h1>
      <p className="mt-1 text-sm text-slate-600">A name and phone are enough to save. The lead opens in the queue.</p>
      <div className="mt-4">
        <AddLeadForm action={createQuickLead} defaultDate={chicagoDay(new Date())} />
      </div>
    </main>
  );
}
