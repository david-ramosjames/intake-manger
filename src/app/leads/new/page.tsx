import { LeadForm } from "@/components/LeadForm";
import { createLead } from "@/lib/actions";
import { loadStaff } from "@/lib/identity";
import { requireStaff } from "@/lib/session";

export default async function NewLeadPage() {
  const { supabase } = await requireStaff();
  const staff = await loadStaff(supabase);
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Add a lead</h1>
      <p className="mt-1 text-sm text-slate-600">
        Use this for a form fill or a call that is not already in the list. You can correct every
        field later.
      </p>
      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <LeadForm action={createLead} staff={staff} />
      </div>
    </main>
  );
}
