import { addStaffContact, saveStaffContact } from "@/lib/ops-actions";
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
      <form action={addStaffContact} className="mt-8 grid gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-navy">Add someone</h2>
        <p className="text-sm text-slate-600">They need a Ramos James login before they can be added.</p>
        {missing.length ? (
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Login</span>
            <select name="email" required className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" defaultValue="">
              <option value="">Choose an email</option>
              {missing.map((email) => (
                <option key={email} value={email}>
                  {email}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <input name="email" required placeholder="name@ramosjames.com" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        )}
        <input name="name" required placeholder="Name, such as Jissela Calix" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <input name="slack_user_id" placeholder="Slack ID, such as U05JBLVM3TM" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <button type="submit" className="w-fit cursor-pointer rounded-md bg-navy px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#16366e]">
          Add to the list
        </button>
      </form>
    </main>
  );
}

function StaffForm({ person }: { person: StaffContact }) {
  return (
    <form action={saveStaffContact} className={`grid gap-3 rounded-lg border px-4 py-3 ${person.listed ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-50"}`}>
      <input type="hidden" name="id" value={person.id} />
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Name</span>
          <input name="name" required defaultValue={person.name} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Slack ID</span>
          <input name="slack_user_id" defaultValue={person.slackUserId ?? ""} placeholder="Not set" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
        </label>
        <button type="submit" className="cursor-pointer rounded-md bg-navy px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[#16366e]">
          Save
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
        <span>{person.email}</span>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="listed" value="yes" defaultChecked={person.listed} />
          At the firm
        </label>
      </div>
    </form>
  );
}
