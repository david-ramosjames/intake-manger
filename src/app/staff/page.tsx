import { AddStaffForm, StaffRow } from "@/components/StaffForms";
import { loadStaffDirectory, loginsMissingFromDirectory, type StaffContact } from "@/lib/staff";
import { requireStaff } from "@/lib/session";

export default async function StaffPage() {
  const { supabase } = await requireStaff();
  let people: StaffContact[] = [];
  let missing: string[] = [];
  let loadError: string | null = null;
  try {
    people = await loadStaffDirectory(supabase);
    missing = await loginsMissingFromDirectory(people.map((person) => person.email));
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Could not load the staff list.";
  }
  const byName = (a: StaffContact, b: StaffContact) => a.name.localeCompare(b.name);
  const current = people.filter((person) => person.listed).sort(byName);
  const former = people.filter((person) => !person.listed).sort(byName);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight text-navy">Staff</h1>
      <p className="mt-1 text-sm text-slate-600">Slack IDs for the people the queue can tag. Uncheck At the firm when someone has left.</p>
      {loadError ? <p className="mt-4 text-sm text-red-700">{loadError}</p> : null}
      <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
        <div className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto_auto] gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-500 sm:grid">
          <span>Name</span>
          <span>Slack ID</span>
          <span>At the firm</span>
          <span />
        </div>
        {current.map((person) => (
          <StaffRow key={person.id} person={person} />
        ))}
      </div>
      {former.length ? (
        <details className="mt-4 overflow-hidden rounded-lg border border-slate-200">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-700">No longer at the firm ({former.length})</summary>
          {former.map((person) => (
            <StaffRow key={person.id} person={person} />
          ))}
        </details>
      ) : null}
      <AddStaffForm missing={missing} />
    </main>
  );
}
