import { AddStaffForm, StaffForm } from "@/components/StaffForms";
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
  const shown = [...people].sort((a, b) => Number(b.listed) - Number(a.listed) || a.name.localeCompare(b.name));

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-navy">Staff</h1>
      <p className="mt-1 text-sm text-slate-600">
        These names are the people the queue can tag in Slack. Change a spelling or a Slack ID here. Uncheck At the firm when someone has left, and they drop off the lists.
      </p>
      {loadError ? <p className="mt-4 text-sm text-red-700">{loadError}</p> : null}
      <ul className="mt-6 space-y-3">
        {shown.map((person) => (
          <li key={person.id}>
            <StaffForm person={person} />
          </li>
        ))}
      </ul>
      <AddStaffForm missing={missing} />
    </main>
  );
}
