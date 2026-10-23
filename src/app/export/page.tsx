import { LeadExportForm } from "@/components/LeadExportForm";
import { loadStaffDirectory } from "@/lib/staff";
import { requireAdmin } from "@/lib/session";

export default async function ExportPage() {
  const { supabase } = await requireAdmin();
  let owners: string[] = [];
  try {
    const people = await loadStaffDirectory(supabase);
    owners = [...new Set(people.filter((person) => person.listed).map((person) => person.name))].sort((a, b) => a.localeCompare(b));
  } catch {
    owners = [];
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight text-navy">Export</h1>
      <p className="mt-1 text-sm text-slate-600">
        Download leads as a spreadsheet. The usual contact, marketing, and case fields are already selected. Turn fields on or off, then narrow the dates and the kind of lead.
      </p>
      <LeadExportForm owners={owners} />
    </main>
  );
}
