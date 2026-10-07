import Link from "next/link";
import { isLeadView, LEAD_KIND_LABEL, type Lead, type LeadKind, type LeadView } from "@/lib/leads";
import { requireStaff } from "@/lib/session";

const VIEWS: { id: LeadView; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pursue", label: "Want to sign" },
  { id: "needs_info", label: "Need more info" },
  { id: "open", label: "Open" },
  { id: "signed", label: "Signed, not promoted" },
  { id: "promoted", label: "Promoted" },
];

export default async function LeadListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; view?: string }>;
}) {
  const params = await searchParams;
  const view: LeadView = isLeadView(params.view) ? params.view : "all";
  const q = (params.q ?? "").trim();
  const { supabase } = await requireStaff();

  let query = supabase
    .from("leads")
    .select(
      "id, lead_date, lead_name, phone, lead_source, source_type, lead_status, grade, signed_case, case_id, case_number, kind, owner_name, follow_up",
    )
    .order("lead_date", { ascending: false, nullsFirst: false })
    .limit(200);

  if (view === "open") {
    query = query.eq("signed_case", false).is("case_id", null).not("lead_status", "in", "(Lost,Referred)");
  } else if (view === "signed") {
    query = query.eq("signed_case", true).is("case_id", null);
  } else if (view === "promoted") {
    query = query.not("case_id", "is", null);
  } else if (view === "pursue" || view === "needs_info") {
    query = query.eq("kind", view);
  }

  if (q) {
    const like = `%${q.replace(/[%_]/g, "")}%`;
    query = query.or(
      `lead_name.ilike.${like},phone.ilike.${like},email.ilike.${like},case_number.ilike.${like}`,
    );
  }

  const { data, error } = await query;
  const leads = (data ?? []) as Pick<
    Lead,
    | "id"
    | "lead_date"
    | "lead_name"
    | "phone"
    | "lead_source"
    | "source_type"
    | "lead_status"
    | "grade"
    | "signed_case"
    | "case_id"
    | "case_number"
    | "kind"
    | "owner_name"
    | "follow_up"
  >[];

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="mt-1 text-sm text-slate-600">
            Every lead captured from #lead-calls, plus the call intakes already in Docket. Jaymie
            confirms the spreadsheet fields here. Want-to-sign leads get the text sequence. A lead
            you have already spoken with gets calls only.
          </p>
        </div>
      </div>

      <form className="mt-6 flex flex-wrap items-center gap-2" action="/">
        {VIEWS.map((item) => (
          <Link
            key={item.id}
            href={q ? `/?view=${item.id}&q=${encodeURIComponent(q)}` : `/?view=${item.id}`}
            className={`rounded-full px-3 py-1 text-sm ${
              view === item.id ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"
            }`}
          >
            {item.label}
          </Link>
        ))}
        <input type="hidden" name="view" value={view} />
        <input
          name="q"
          defaultValue={q}
          placeholder="Name, phone, or case number"
          className="ml-auto w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm sm:w-64"
        />
      </form>

      {error ? <p className="mt-6 text-sm text-red-700">{error.message}</p> : null}

      <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Phone</th>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Kind</th>
              <th className="px-3 py-2 font-medium">Handled by</th>
              <th className="px-3 py-2 font-medium">Signed</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr key={lead.id} className="border-b border-slate-100 last:border-0">
                <td className="px-3 py-2 text-slate-500">{lead.lead_date ?? "—"}</td>
                <td className="px-3 py-2">
                  <Link href={`/leads/${lead.id}`} className="font-medium text-slate-900 hover:underline">
                    {lead.lead_name || "Unnamed lead"}
                  </Link>
                </td>
                <td className="px-3 py-2">{lead.phone || "—"}</td>
                <td className="px-3 py-2 text-slate-600">
                  {[lead.source_type, lead.lead_source].filter(Boolean).join(" · ") || "—"}
                </td>
                <td className="px-3 py-2">{lead.lead_status}</td>
                <td className="px-3 py-2">{LEAD_KIND_LABEL[lead.kind as LeadKind] ?? lead.kind}</td>
                <td className="px-3 py-2">{lead.owner_name || "—"}</td>
                <td className="px-3 py-2">
                  {lead.case_id ? (
                    <span>Promoted{lead.case_number ? ` ${lead.case_number}` : ""}</span>
                  ) : lead.signed_case ? (
                    <span className="font-medium text-emerald-800">Signed</span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
            {leads.length === 0 && !error ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                  No leads in this view.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}
