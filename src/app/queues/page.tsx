import Link from "next/link";
import { CallWork } from "@/components/CallWork";
import { callOutcomeLabel } from "@/lib/calls";
import { leadTitle } from "@/lib/leads";
import { runDueWork } from "@/lib/ops-actions";
import { requireStaff } from "@/lib/session";
import { chicagoDay, formatChicago } from "@/lib/time";
import { buttonSecondary } from "@/lib/ui";

type QueueView = "all" | "today" | "overdue" | "upcoming" | "mine" | "unassigned";

const VIEWS: { id: QueueView; label: string }[] = [
  { id: "all", label: "All open" },
  { id: "today", label: "Today" },
  { id: "overdue", label: "Overdue" },
  { id: "upcoming", label: "Upcoming" },
  { id: "mine", label: "My calls" },
  { id: "unassigned", label: "Unassigned" },
];

function isView(value: string | undefined): value is QueueView {
  return VIEWS.some((view) => view.id === value);
}

type LeadBits = {
  id: string;
  lead_name: string | null;
  phone: string | null;
  case_type: string | null;
  summary: string | null;
  quo_link: string | null;
  identity_status: string | null;
};

type JobRow = {
  id: string;
  lead_id: string;
  position: number;
  due_at: string;
  body: string;
  status: string;
  detail: string | null;
  assigned_email: string | null;
  outcome: string | null;
  notified_at: string | null;
  leads: LeadBits | LeadBits[] | null;
};

type Attempt = {
  job_id: string | null;
  outcome: string;
  note: string | null;
  actor: string | null;
  attempted_at: string;
};

export default async function QueuesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; texts?: string; calls?: string; slack?: string; failed?: string }>;
}) {
  const params = await searchParams;
  const view: QueueView = isView(params.view) ? params.view : "all";
  const { supabase, email } = await requireStaff();
  const now = new Date();
  const today = chicagoDay(now);

  const [{ data, error }, runResult] = await Promise.all([
    supabase
      .from("lead_jobs")
      .select(
        "id, lead_id, position, due_at, body, status, detail, assigned_email, outcome, notified_at, leads(id, lead_name, phone, case_type, summary, quo_link, identity_status)",
      )
      .eq("queue", "call")
      .in("status", ["pending", "failed"])
      .order("due_at")
      .limit(400),
    supabase
      .from("queue_runs")
      .select("ran_at, calls_alerted, texts, slack, failed")
      .order("ran_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const jobs = ((data ?? []) as JobRow[]).filter((job) => {
    const due = new Date(job.due_at);
    if (view === "today") return chicagoDay(job.due_at) === today;
    if (view === "overdue") return due.getTime() < now.getTime();
    if (view === "upcoming") return chicagoDay(job.due_at) > today;
    if (view === "mine") return job.assigned_email === email;
    if (view === "unassigned") return !job.assigned_email;
    return true;
  });
  const shown = jobs.slice(0, 60);
  const { data: attemptRows } = shown.length
    ? await supabase
        .from("call_attempts")
        .select("job_id, outcome, note, actor, attempted_at")
        .in(
          "job_id",
          shown.map((job) => job.id),
        )
        .order("attempted_at", { ascending: false })
    : { data: [] };
  const latest = new Map<string, Attempt>();
  for (const attempt of (attemptRows ?? []) as Attempt[]) {
    if (attempt.job_id && !latest.has(attempt.job_id)) latest.set(attempt.job_id, attempt);
  }
  const lastRun = runResult.data as {
    ran_at: string;
    calls_alerted: number;
    texts: number;
    slack: number;
    failed: number;
  } | null;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-navy">Queues</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Claim a call, dial from Quo, and record what happened. Times are Central. A Slack alert
            does not finish the call. The scheduled run posts those alerts; finishing the call happens here.
          </p>
        </div>
        <form action={runDueWork}>
          <button type="submit" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">
            Post due Slack alerts
          </button>
        </form>
      </div>
      <p className="mt-3 text-sm text-slate-600">
        {lastRun
          ? `Last automatic check ${formatChicago(lastRun.ran_at)}: ${lastRun.calls_alerted} call alerts, ${lastRun.slack} Slack notes, ${lastRun.failed} failures.`
          : "No queue run has been recorded yet. Alerts still post on the ten-minute schedule once this version is live."}
      </p>
      {params.texts || params.calls || params.slack || params.failed ? (
        <p className="mt-2 text-sm text-slate-700">
          Last manual run: {params.calls ?? 0} call alerts, {params.slack ?? 0} Slack notes, {params.failed ?? 0}{" "}
          failed.
        </p>
      ) : null}
      {error ? <p className="mt-4 text-sm text-red-700">{error.message}</p> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {VIEWS.map((item) => (
          <Link
            key={item.id}
            href={item.id === "all" ? "/queues" : `/queues?view=${item.id}`}
            className={`rounded-full px-3 py-1 text-sm ${
              view === item.id ? "bg-brand text-navy" : "bg-white text-slate-700 ring-1 ring-slate-200"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>
      <p className="mt-3 text-sm text-slate-500">
        {jobs.length} open {jobs.length === 1 ? "call" : "calls"}
        {jobs.length > shown.length ? `, showing the next ${shown.length}` : ""}.
      </p>

      <ul className="mt-4 space-y-3">
        {shown.map((job) => {
          const lead = Array.isArray(job.leads) ? job.leads[0] : job.leads;
          const overdue = new Date(job.due_at).getTime() < now.getTime();
          const attempt = latest.get(job.id);
          return (
            <li key={job.id} className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <Link href={`/leads/${job.lead_id}`} className="font-medium text-navy underline">
                    {leadTitle({
                      lead_name: lead?.lead_name ?? null,
                      phone: lead?.phone ?? null,
                      identity_status: lead?.identity_status,
                    })}
                  </Link>
                  <span className="text-slate-500">
                    {" "}
                    · Call {job.position}
                    {lead?.case_type ? ` · ${lead.case_type}` : ""}
                    {lead?.phone ? ` · ${lead.phone}` : ""}
                  </span>
                  <p className="mt-1 text-slate-700">
                    {overdue ? "Overdue" : "Due"} {formatChicago(job.due_at)}
                    {job.status === "failed" ? " · alert failed" : ""}
                    {job.notified_at ? " · Slack alert sent" : ""}
                  </p>
                </div>
                {lead?.quo_link ? (
                  <a href={lead.quo_link} className={buttonSecondary} target="_blank" rel="noreferrer">
                    Open in Quo
                  </a>
                ) : (
                  <span className="text-slate-400">No Quo link</span>
                )}
              </div>
              <p className="mt-2 text-slate-700">{job.body}</p>
              {lead?.summary ? <p className="mt-1 text-slate-500">{lead.summary.slice(0, 180)}</p> : null}
              {attempt ? (
                <p className="mt-2 text-slate-600">
                  Last attempt {formatChicago(attempt.attempted_at)}: {callOutcomeLabel(attempt.outcome)}
                  {attempt.actor ? ` · ${attempt.actor}` : ""}
                  {attempt.note ? ` — ${attempt.note}` : ""}
                </p>
              ) : (
                <p className="mt-2 text-slate-500">
                {lead?.quo_link
                  ? "No attempt recorded here. Quo history is not synced, so this does not mean nobody called."
                  : "No attempt recorded yet."}
              </p>
              )}
              {job.detail && job.status === "failed" ? <p className="mt-1 text-red-700">{job.detail}</p> : null}
              <CallWork jobId={job.id} assignedEmail={job.assigned_email} viewerEmail={email} />
            </li>
          );
        })}
        {shown.length === 0 && !error ? <li className="text-sm text-slate-500">Nothing is waiting in this view.</li> : null}
      </ul>
    </main>
  );
}
