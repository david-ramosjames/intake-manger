import { LeadExportForm } from "@/components/LeadExportForm";
import { requireAdmin } from "@/lib/session";
import { loadStaffDirectory } from "@/lib/staff";
import { buttonPrimary } from "@/lib/ui";

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
      <section className="mt-6 rounded-lg border border-slate-200 bg-white px-4 py-4">
        <h2 className="text-sm font-semibold text-navy">Referred clients</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          Each row is one referral. Referred to is the firm or attorney selected for the text. A client referred twice appears on two rows.
        </p>
        <form method="post" action="/export/referrals" className="mt-3">
          <button type="submit" className={buttonPrimary}>
            Download referred clients
          </button>
        </form>
      </section>
      <LeadExportForm owners={owners} />
    </main>
  );
}
