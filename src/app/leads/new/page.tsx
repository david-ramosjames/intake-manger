import { AddLeadForm } from "@/components/AddLeadForm";
import { createQuickLead } from "@/lib/actions";
import { requireStaff } from "@/lib/session";
import { chicagoDay } from "@/lib/time";

export default async function NewLeadPage() {
  await requireStaff();
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-navy">Add a lead</h1>
      <p className="mt-1 text-sm text-slate-600">
        Same details as the work queue. A name and phone are enough to save, and the lead opens in the queue.
      </p>
      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <AddLeadForm action={createQuickLead} defaultDate={chicagoDay(new Date())} />
      </div>
    </main>
  );
}
