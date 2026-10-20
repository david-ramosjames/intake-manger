import { saveDestination, saveReferralTemplate } from "@/lib/ops-actions";
import { PRACTICE_AREAS, practiceAreaLabel, DEFAULT_REFERRAL_SMS } from "@/lib/referrals";
import { requireStaff } from "@/lib/session";

type Destination = {
  id: string;
  name: string;
  phone: string | null;
  practice_areas: string[];
  address: string | null;
  email: string | null;
  website: string | null;
  spanish: boolean;
  matters: string | null;
  notes: string | null;
  active: boolean;
};

export default async function ReferralsPage() {
  const { supabase, admin } = await requireStaff();
  const [{ data, error }, { data: templateRows }] = await Promise.all([
    supabase
      .from("referral_destinations")
      .select("id, name, phone, practice_areas, address, email, website, spanish, matters, notes, active")
      .eq("active", true)
      .order("name"),
    supabase.from("referral_templates").select("language, body"),
  ]);
  const destinations = (data ?? []) as Destination[];
  const stored = (templateRows ?? []) as { language: string; body: string }[];
  const english = stored.find((row) => row.language === "en")?.body || DEFAULT_REFERRAL_SMS.en;
  const spanish = stored.find((row) => row.language === "es")?.body || DEFAULT_REFERRAL_SMS.es;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-navy">Referrals</h1>
      <p className="mt-1 text-sm text-slate-600">
        Attorneys for matters this firm does not handle, and the text that sends their contact details to the lead.
        Placeholders: {"{{greeting}}"}, {"{{area}}"}, {"{{attorney}}"}, {"{{phone}}"}, {"{{details}}"}.
      </p>
      {error ? <p className="mt-4 text-sm text-red-700">{error.message}</p> : null}

      <div className="mt-6 grid gap-4">
        <TemplateForm language="en" label="English text" body={english} />
        <TemplateForm language="es" label="Spanish text" body={spanish} />
      </div>

      <div className="mt-8 space-y-6">
        {PRACTICE_AREAS.map((area) => {
          const rows = destinations.filter((destination) => destination.practice_areas.includes(area.id));
          if (!rows.length) return null;
          return (
            <section key={area.id}>
              <h2 className="text-sm font-semibold text-navy">{area.label}</h2>
              <ul className="mt-2 space-y-3">
                {rows.map((destination) => (
                  <li key={destination.id} className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
                    <p className="font-medium">
                      {destination.name}
                      {destination.spanish ? <span className="ml-2 text-slate-500">Spanish</span> : null}
                    </p>
                    <p className="text-slate-600">{destination.phone || "No phone"}</p>
                    {destination.address ? <p className="text-slate-600">{destination.address}</p> : null}
                    {destination.email ? <p className="text-slate-600">{destination.email}</p> : null}
                    {destination.website ? <p className="text-slate-600">{destination.website}</p> : null}
                    {destination.matters ? <p className="mt-1">{destination.matters}</p> : null}
                    {destination.notes ? <p className="mt-1 text-slate-600">{destination.notes}</p> : null}
                    {destination.practice_areas.length > 1 ? (
                      <p className="mt-1 text-slate-500">
                        Also {destination.practice_areas.filter((item) => item !== area.id).map(practiceAreaLabel).join(", ")}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {admin ? <form action={saveDestination} className="mt-8 grid gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Add an attorney</h2>
        <input name="name" required placeholder="Name" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <select name="practice_area" required className="rounded-md border border-slate-300 px-3 py-2 text-sm" defaultValue="">
          <option value="">Practice area</option>
          {[...PRACTICE_AREAS].sort((a, b) => a.label.localeCompare(b.label)).map((area) => (
            <option key={area.id} value={area.id}>
              {area.label}
            </option>
          ))}
        </select>
        <input name="phone" placeholder="Phone" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <input name="address" placeholder="Address" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <input name="email" placeholder="Email" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <input name="website" placeholder="Website" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <textarea name="matters" rows={2} placeholder="Matters they handle" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <textarea name="notes" rows={2} placeholder="Notes for staff" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="spanish" value="yes" />
          Spanish available
        </label>
        <button type="submit" className="w-fit rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-navy">
          Add attorney
        </button>
      </form> : null}
    </main>
  );
}

function TemplateForm({ language, label, body }: { language: "en" | "es"; label: string; body: string }) {
  return (
    <form action={saveReferralTemplate} className="grid gap-2 rounded-lg border border-slate-200 bg-white p-4">
      <input type="hidden" name="language" value={language} />
      <label className="text-sm font-medium text-slate-700" htmlFor={`template-${language}`}>
        {label}
      </label>
      <textarea
        id={`template-${language}`}
        name="body"
        rows={3}
        defaultValue={body}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <button type="submit" className="w-fit rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm">
        Save template
      </button>
    </form>
  );
}
