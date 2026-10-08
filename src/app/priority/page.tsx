import Link from "next/link";
import {
  daysOpen,
  PRIORITY_REASON_LABEL,
  PRIORITY_REASONS,
  slackMessageUrl,
  type Lead,
  type PriorityReason,
} from "@/lib/leads";
import { requireStaff } from "@/lib/session";

type PriorityLead = Pick<
  Lead,
  | "id"
  | "lead_name"
  | "phone"
  | "grade"
  | "lead_date"
  | "created_at"
  | "case_type"
  | "priority_reason"
  | "last_action"
  | "next_action"
  | "quo_link"
  | "slack_permalink"
  | "slack_channel_id"
  | "slack_message_ts"
  | "slack_thread_ts"
>;

type Job = {
  lead_id: string;
  queue: string;
  due_at: string;
  body: string;
  status: string;
};

function when(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function nextCall(jobs: Job[]): string | null {
  const call = jobs
    .filter((job) => job.queue === "call" && job.status === "pending")
    .sort((a, b) => a.due_at.localeCompare(b.due_at))[0];
  if (!call) return null;
  const note = call.body.replace(/\s+/g, " ").trim();
  return `Call ${when(call.due_at)}${note ? `. ${note}` : ""}`;
}

export default async function PriorityPage() {
  const { supabase } = await requireStaff();
  const { data, error } = await supabase
    .from("leads")
    .select(
      "id, lead_name, phone, grade, lead_date, created_at, case_type, priority_reason, last_action, next_action, quo_link, slack_permalink, slack_channel_id, slack_message_ts, slack_thread_ts",
    )
    .eq("priority", true)
    .eq("signed_case", false)
    .is("case_id", null)
    .not("lead_status", "in", "(Lost,Referred,Promoted)")
    .order("lead_date", { ascending: true, nullsFirst: false });

  const leads = (data ?? []) as PriorityLead[];
  const ids = leads.map((lead) => lead.id);
  const jobsResult = ids.length
    ? await supabase
        .from("lead_jobs")
        .select("lead_id, queue, due_at, body, status")
        .in("lead_id", ids)
        .eq("queue", "call")
        .eq("status", "pending")
    : { data: [] };
  const jobs = (jobsResult.data ?? []) as Job[];
  const jobsByLead = new Map<string, Job[]>();
  for (const job of jobs) {
    const list = jobsByLead.get(job.lead_id) ?? [];
    list.push(job);
    jobsByLead.set(job.lead_id, list);
  }

  const groups = PRIORITY_REASONS.map((reason) => ({
    reason,
    leads: leads.filter((lead) => lead.priority_reason === reason),
  })).filter((group) => group.leads.length > 0);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Priority</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Open leads Jaymie marked for Jon. A lead leaves this list when it is signed, promoted,
        lost, or referred. The next call is the one queued here. The next text is sent by SMS
        Follow-Up, so that time is not on this page.
      </p>
      {error ? <p className="mt-4 text-sm text-red-700">{error.message}</p> : null}

      {groups.length === 0 && !error ? (
        <p className="mt-8 text-sm text-slate-500">
          No open priority leads. Open a lead and add it to this list.
        </p>
      ) : null}

      <div className="mt-8 space-y-8">
        {groups.map((group) => (
          <section key={group.reason}>
            <h2 className="text-sm font-semibold text-slate-900">
              {PRIORITY_REASON_LABEL[group.reason as PriorityReason]}
              <span className="ml-2 font-normal text-slate-500">{group.leads.length}</span>
            </h2>
            <ul className="mt-3 space-y-3">
              {group.leads.map((lead) => {
                const openFor = daysOpen(lead.lead_date ?? lead.created_at, null);
                const slack = slackMessageUrl(lead);
                const call = nextCall(jobsByLead.get(lead.id) ?? []);
                return (
                  <li key={lead.id} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <Link href={`/leads/${lead.id}`} className="text-base font-medium text-slate-900 hover:underline">
                        {lead.lead_name || "Unnamed lead"}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {lead.grade ? `Grade ${lead.grade}` : "No grade"}
                        {openFor != null ? ` · ${openFor} day${openFor === 1 ? "" : "s"}` : ""}
                        {lead.case_type ? ` · ${lead.case_type}` : ""}
                      </p>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{lead.phone || "No phone"}</p>
                    <dl className="mt-3 space-y-2 text-sm">
                      <div>
                        <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Last</dt>
                        <dd className="text-slate-800">{lead.last_action || "No note yet."}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Next</dt>
                        <dd className="text-slate-800">{lead.next_action || "No note yet."}</dd>
                        {call ? <dd className="mt-1 text-slate-600">{call}</dd> : null}
                      </div>
                    </dl>
                    <p className="mt-3 flex flex-wrap gap-3 text-sm">
                      {lead.quo_link ? (
                        <a href={lead.quo_link} className="font-medium text-slate-900 underline" target="_blank" rel="noreferrer">
                          Quo
                        </a>
                      ) : null}
                      {slack ? (
                        <a href={slack} className="font-medium text-slate-900 underline" target="_blank" rel="noreferrer">
                          Slack
                        </a>
                      ) : null}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
