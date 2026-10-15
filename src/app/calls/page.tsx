import Link from "next/link";
import { callerClassLabel } from "@/lib/caller-class";
import { desiredWord } from "@/lib/desired";
import { leadTitle } from "@/lib/leads";
import { requireStaff } from "@/lib/session";
import { formatChicago } from "@/lib/time";

export const metadata = { title: "Call log · Intake Manager" };

const PAGE_SIZE = 50;
const CALL_TYPES = ["call", "missed_call", "sona_call", "voicemail"];

const TYPE_LABEL: Record<string, string> = {
  call: "Call",
  missed_call: "Missed call",
  sona_call: "Sona",
  voicemail: "Voicemail",
  text: "Text",
  email: "Email",
};

type LeadBits = {
  id: string;
  lead_name: string | null;
  lead_status: string | null;
  close_reason: string | null;
  caller_class: string | null;
  grade: string | null;
  qualified: boolean | null;
  desired_case: boolean | null;
  signed_case: boolean | null;
  consultation_date: string | null;
  callrail_tags: string[] | null;
  owner_name: string | null;
  follow_up: boolean | null;
  summary: string | null;
};

type Touch = {
  id: string;
  occurred_at: string | null;
  type: string | null;
  direction: string | null;
  phone: string | null;
  phone_e164: string | null;
  content: string | null;
  quo_link: string | null;
  slack_permalink: string | null;
  source_id: string | null;
  lead_id: string | null;
  leads: LeadBits | LeadBits[] | null;
};

function oneLead(value: Touch["leads"]): LeadBits | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function logHref(view: string, q: string, page: number): string {
  const params = new URLSearchParams();
  if (view !== "calls") params.set("view", view);
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/calls?${query}` : "/calls";
}

export default async function CallLogPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const view = params.view === "texts" || params.view === "all" ? params.view : "calls";
  const q = (params.q || "").trim().slice(0, 80);
  const page = Math.max(1, Number(params.page) || 1);
  const { supabase } = await requireStaff();

  let query = supabase
    .from("intake_interactions")
    .select(
      "id, occurred_at, type, direction, phone, phone_e164, content, quo_link, slack_permalink, source_id, lead_id, leads(id, lead_name, lead_status, close_reason, caller_class, grade, qualified, desired_case, signed_case, consultation_date, callrail_tags, owner_name, follow_up, summary)",
      { count: "exact" },
    )
    .order("occurred_at", { ascending: false });

  if (view === "calls") query = query.in("type", CALL_TYPES);
  if (view === "texts") query = query.eq("type", "text");

  const digits = q.replace(/\D/g, "");
  const safe = q.replace(/[%(),]/g, "");
  if (digits.length >= 7) {
    query = query.or(`phone.ilike.%${digits}%,phone_e164.ilike.%${digits}%`);
  } else if (safe) {
    const { data: named } = await supabase.from("leads").select("id").ilike("lead_name", `%${safe}%`).limit(40);
    const ids = (named ?? []).map((row) => row.id as string);
    const leadMatch = ids.length ? `,lead_id.in.(${ids.join(",")})` : "";
    query = query.or(`content.ilike.%${safe}%${leadMatch}`);
  }

  const from = (page - 1) * PAGE_SIZE;
  const { data, error, count } = await query.range(from, from + PAGE_SIZE - 1);
  const rows = (data ?? []) as Touch[];
  const total = count ?? rows.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight text-navy">Call log</h1>
      <p className="mt-1 max-w-3xl text-sm text-slate-600">
        Every call and text Quo has stored, with the lead decision next to it. Use this to spot-check classification, tags, and whether a call attached to the right lead. The full transcript stays in Quo.
      </p>

      <form className="mt-4 flex flex-wrap items-center gap-2" action="/calls">
        <input type="hidden" name="view" value={view} />
        <input
          name="q"
          defaultValue={q}
          placeholder="Name or phone"
          className="w-56 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        <button type="submit" className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-navy">
          Search
        </button>
        {q ? (
          <Link href={logHref(view, "", 1)} className="text-sm text-slate-500 hover:text-slate-900">
            Clear
          </Link>
        ) : null}
      </form>

      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        {(
          [
            ["calls", "Calls"],
            ["texts", "Texts"],
            ["all", "All"],
          ] as const
        ).map(([id, label]) => (
          <Link
            key={id}
            href={logHref(id, q, 1)}
            className={`rounded-full px-3 py-1 ${view === id ? "bg-brand font-medium text-navy" : "bg-slate-100 text-slate-700"}`}
          >
            {label}
          </Link>
        ))}
        <span className="self-center text-slate-500">{total.toLocaleString()} records</span>
      </div>

      {error ? <p className="mt-4 text-sm text-red-700">{error.message}</p> : null}

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-[1100px] w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">When</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Phone</th>
              <th className="px-3 py-2 font-medium">Lead</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Class</th>
              <th className="px-3 py-2 font-medium">Grade</th>
              <th className="px-3 py-2 font-medium">Qualified</th>
              <th className="px-3 py-2 font-medium">Desired</th>
              <th className="px-3 py-2 font-medium">Signed</th>
              <th className="px-3 py-2 font-medium">Consult</th>
              <th className="px-3 py-2 font-medium">Handled by</th>
              <th className="px-3 py-2 font-medium">What was said</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const lead = oneLead(row.leads);
              const tags = (lead?.callrail_tags ?? []).join(", ");
              return (
                <tr key={row.id} className="border-b border-slate-100 align-top">
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">{formatChicago(row.occurred_at)}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {TYPE_LABEL[row.type || ""] || row.type || "—"}
                    <span className="block text-xs text-slate-500">{row.direction || ""}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{row.phone_e164 || row.phone || "—"}</td>
                  <td className="px-3 py-2">
                    {lead ? (
                      <Link href={`/leads/${lead.id}`} className="font-medium text-navy hover:underline">
                        {leadTitle({ lead_name: lead.lead_name, phone: row.phone })}
                      </Link>
                    ) : (
                      <span className="text-slate-400">No lead</span>
                    )}
                    <span className="mt-1 block space-x-2 text-xs">
                      {row.quo_link ? (
                        <a href={row.quo_link} className="text-slate-500 hover:text-slate-900" target="_blank" rel="noreferrer">
                          Quo
                        </a>
                      ) : null}
                      {row.slack_permalink ? (
                        <a href={row.slack_permalink} className="text-slate-500 hover:text-slate-900" target="_blank" rel="noreferrer">
                          Slack
                        </a>
                      ) : null}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {lead?.lead_status || "—"}
                    {lead?.close_reason ? <span className="block text-xs text-slate-500">{lead.close_reason}</span> : null}
                    {lead ? (
                      <span className="block text-xs text-slate-500">{lead.follow_up ? "Follow-up on" : "Follow-up off"}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">{callerClassLabel(lead?.caller_class) || "—"}</td>
                  <td className="px-3 py-2">{lead?.grade || "—"}</td>
                  <td className="px-3 py-2">{desiredWord(lead?.qualified)}</td>
                  <td className="px-3 py-2">{desiredWord(lead?.desired_case)}</td>
                  <td className="px-3 py-2">{lead?.signed_case ? "Yes" : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2">{lead?.consultation_date || "—"}</td>
                  <td className="px-3 py-2">{lead?.owner_name || "—"}</td>
                  <td className="max-w-sm px-3 py-2 text-slate-700">
                    <p className="line-clamp-3">{row.content || lead?.summary || "—"}</p>
                    {tags ? <p className="mt-1 text-xs text-slate-500">{tags}</p> : null}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-3 py-8 text-slate-500">
                  Nothing matches this view.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center gap-3 text-sm">
        {page > 1 ? (
          <Link href={logHref(view, q, page - 1)} className="text-navy hover:underline">
            Newer
          </Link>
        ) : null}
        <span className="text-slate-500">
          Page {page} of {pages}
        </span>
        {page < pages ? (
          <Link href={logHref(view, q, page + 1)} className="text-navy hover:underline">
            Older
          </Link>
        ) : null}
      </div>
    </main>
  );
}
