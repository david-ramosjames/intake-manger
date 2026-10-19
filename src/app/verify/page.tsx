import Link from "next/link";
import { heardClientName } from "@/lib/identity";
import { leadTitle } from "@/lib/leads";
import { mergeIntoLead } from "@/lib/ops-actions";
import { requireStaff } from "@/lib/session";

type Row = {
  id: string;
  lead_name: string | null;
  phone: string | null;
  phone_e164: string | null;
  lead_status: string;
  case_type: string | null;
  lead_date: string | null;
  identity_status?: string | null;
};

export default async function VerifyPage() {
  const { supabase } = await requireStaff();
  const [{ count }, { data, error }, identityResult] = await Promise.all([
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("needs_verification", true),
    supabase
      .from("leads")
      .select("id, lead_name, phone, phone_e164, lead_status, case_type, lead_date, identity_status")
      .not("phone_e164", "is", null)
      .order("lead_date", { ascending: true, nullsFirst: false })
      .limit(1000),
    supabase
      .from("leads")
      .select("id, lead_name, phone, identity_status, identity_evidence, lead_status")
      .eq("identity_status", "needs_review")
      .order("updated_at", { ascending: false })
      .limit(100),
  ]);

  const rows = (data ?? []) as Row[];
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    if (!row.phone_e164) continue;
    const list = groups.get(row.phone_e164) ?? [];
    list.push(row);
    groups.set(row.phone_e164, list);
  }
  const duplicates = [...groups.values()].filter((group) => group.length > 1);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-navy">Needs verification</h1>
      <p className="mt-1 text-sm text-slate-600">
        Records missing a name or phone, plus names and phones filled in from a summary or an intake.
        Confirming a record removes it from this queue once both fields are present. The same phone on
        two rows is a review, not proof they are the same matter.
      </p>
      <p className="mt-4 text-sm">
        <Link href="/?view=verify" className="font-medium text-navy underline">
          {count ?? 0} leads need verification
        </Link>
      </p>
      {error ? <p className="mt-4 text-sm text-red-700">{error.message}</p> : null}

      <section className="mt-8">
        <h2 className="text-sm font-semibold">Identity needs review</h2>
        <p className="mt-1 text-sm text-slate-600">
          These names or emails match the staff directory, or the summary describes the name as someone
          from Ramos James. Open the lead to keep the name or save the client’s name. Nothing is merged
          or closed from here.
        </p>
        <ul className="mt-3 space-y-3">
          {((identityResult.data ?? []) as { id: string; lead_name: string | null; phone: string | null; identity_status: string; identity_evidence: string | null; lead_status: string }[]).map((lead) => {
            const heard = heardClientName(lead.identity_evidence);
            return (
            <li key={lead.id} className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
              <Link href={`/leads/${lead.id}`} className="font-medium text-navy underline">
                {leadTitle(lead)}
              </Link>
              <span className="text-slate-500"> · {lead.lead_status}</span>
              {heard ? <p className="mt-1 text-amber-950">Heard {heard}</p> : null}
            </li>
            );
          })}
          {(identityResult.data ?? []).length === 0 ? (
            <li className="text-sm text-slate-500">No identity conflicts are waiting.</li>
          ) : null}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold">Same phone on more than one lead</h2>
        {duplicates.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No shared phone numbers.</p>
        ) : (
          <ul className="mt-3 space-y-4">
            {duplicates.map((group) => {
              const phone = group[0]?.phone_e164 ?? "";
              return (
                <li key={phone} className="rounded-lg border border-slate-200 bg-white p-4">
                  <p className="text-sm font-medium">{group[0]?.phone || phone}</p>
                  <ul className="mt-3 space-y-3">
                    {group.map((lead) => (
                      <li key={lead.id} className="text-sm">
                        <Link href={`/leads/${lead.id}`} className="font-medium text-navy underline">
                          {leadTitle(lead)}
                        </Link>
                        <span className="text-slate-500">
                          {" "}
                          · {lead.lead_status}
                          {lead.case_type ? ` · ${lead.case_type}` : ""}
                          {lead.lead_date ? ` · ${lead.lead_date}` : ""}
                        </span>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {group
                            .filter((other) => other.id !== lead.id)
                            .map((other) => (
                              <form key={other.id} action={mergeIntoLead}>
                                <input type="hidden" name="keeper_id" value={other.id} />
                                <input type="hidden" name="duplicate_id" value={lead.id} />
                                <button type="submit" className="rounded-md border border-slate-300 px-2 py-1 text-xs">
                                  Close this one and keep {other.lead_name || "the other lead"}
                                </button>
                              </form>
                            ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
