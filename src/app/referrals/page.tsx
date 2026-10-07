import { saveDestination } from "@/lib/ops-actions";
import { requireStaff } from "@/lib/session";

export default async function ReferralsPage() {
  const { supabase } = await requireStaff();
  const { data, error } = await supabase
    .from("referral_destinations")
    .select("id, name, phone, case_types, notes, active")
    .order("name");
  const destinations = (data ?? []) as {
    id: string;
    name: string;
    phone: string | null;
    case_types: string[];
    notes: string | null;
    active: boolean;
  }[];

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Referral tree</h1>
      <p className="mt-1 text-sm text-slate-600">
        When we cannot take a case, the lead page suggests the destination whose case types match.
        Sending the referral posts it to Slack and stops follow-up.
      </p>
      {error ? <p className="mt-4 text-sm text-red-700">{error.message}</p> : null}
      <ul className="mt-6 space-y-3">
        {destinations.map((destination) => (
          <li key={destination.id} className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
            <p className="font-medium">{destination.name}</p>
            <p className="text-slate-600">{destination.phone || "No phone"}</p>
            <p className="mt-1">Matches: {destination.case_types.join(", ") || "nothing yet"}</p>
            {destination.notes ? <p className="mt-1 text-slate-600">{destination.notes}</p> : null}
          </li>
        ))}
      </ul>
      <form action={saveDestination} className="mt-8 grid gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Add a destination</h2>
        <input name="name" required placeholder="Firm or service" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <input name="phone" placeholder="Phone" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <input
          name="case_types"
          placeholder="Case types, comma separated, such as family, divorce"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <textarea name="notes" rows={2} placeholder="Notes" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <button type="submit" className="w-fit rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">
          Add destination
        </button>
      </form>
    </main>
  );
}
