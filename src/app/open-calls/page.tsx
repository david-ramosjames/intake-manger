import Link from "next/link";
import { OpenCallPlan } from "@/components/OpenCallPlan";
import { loadStaff, type StaffPerson } from "@/lib/identity";
import { leadTitle, slackMessageUrl } from "@/lib/leads";
import { CALL_SEQUENCE_LABEL, isCallSequence } from "@/lib/sequences";
import { requireStaff } from "@/lib/session";
import { LEAD_CHANNEL_ID } from "@/lib/slack";
import { loadSlackSettings } from "@/lib/slack-settings";
import { isPlaceholderOwner } from "@/lib/talked-with";
import { formatChicago } from "@/lib/time";

export const metadata = { title: "Open calls · Intake Manager" };

type LeadBits = {
  id: string;
  lead_name: string | null;
  phone: string | null;
  owner_name: string | null;
  consultation_date: string | null;
  slack_permalink: string | null;
  slack_channel_id: string | null;
  slack_message_ts: string | null;
  slack_thread_ts: string | null;
  identity_status: string | null;
};

type JobRow = {
  id: string;
  lead_id: string;
  sequence: string | null;
  position: number;
  due_at: string;
  status: string;
  mention: string | null;
  assigned_name: string | null;
  notified_at: string | null;
  leads: LeadBits | LeadBits[] | null;
};

const JOB_SELECT =
  "id, lead_id, sequence, position, due_at, status, mention, assigned_name, notified_at, leads(id, lead_name, phone, owner_name, consultation_date, slack_permalink, slack_channel_id, slack_message_ts, slack_thread_ts, identity_status)";

function leadOf(job: JobRow): LeadBits | null {
  if (!job.leads) return null;
  return Array.isArray(job.leads) ? job.leads[0] ?? null : job.leads;
}

function slackUserId(mention: string | null): string {
  return (mention || "").replace(/[<@>]/g, "").trim();
}

function consultName(lead: LeadBits | null): string {
  if (!lead?.consultation_date || isPlaceholderOwner(lead.owner_name)) return "";
  return lead.owner_name?.trim() || "";
}

function taggedAs(job: JobRow, lead: LeadBits | null, staff: StaffPerson[]): string {
  const id = slackUserId(job.mention);
  const bySlack = id ? staff.find((person) => person.slackUserId === id) : null;
  if (bySlack) return bySlack.name;
  if (job.assigned_name && !isPlaceholderOwner(job.assigned_name)) return job.assigned_name.trim();
  const consult = consultName(lead);
  if (consult) return consult;
  return "Outbound (today’s #lead-calls)";
}

function callPlace(
  lead: LeadBits | null,
  channelId: string,
): { label: string; href: string | null } {
  const href = lead ? slackMessageUrl(lead) : null;
  const channel = lead?.slack_channel_id || channelId;
  if (!channel || channel === channelId || channel === LEAD_CHANNEL_ID) {
    return { label: "#lead-calls", href };
  }
  return { label: "Case channel", href };
}

function sequenceLabel(job: JobRow, totals: Map<string, number>): string {
  const sequence = isCallSequence(job.sequence) ? job.sequence : null;
  const name = sequence ? CALL_SEQUENCE_LABEL[sequence] : "Call sequence";
  const total = sequence ? totals.get(sequence) : null;
  if (total && total > 0) return `${name} · Call ${job.position} of ${total}`;
  return `${name} · Call ${job.position}`;
}

function JobCard({
  job,
  staff,
  channelId,
  now,
  totals,
}: {
  job: JobRow;
  staff: StaffPerson[];
  channelId: string;
  now: number;
  totals: Map<string, number>;
}) {
  const lead = leadOf(job);
  const place = callPlace(lead, channelId);
  const tagged = taggedAs(job, lead, staff);
  const overdue = new Date(job.due_at).getTime() < now;
  const assigned = job.assigned_name && !isPlaceholderOwner(job.assigned_name) ? job.assigned_name.trim() : "";
  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={`/leads/${job.lead_id}`} className="font-medium text-navy hover:underline">
            {leadTitle({
              lead_name: lead?.lead_name ?? null,
              phone: lead?.phone ?? null,
              identity_status: lead?.identity_status,
            })}
          </Link>
          {lead?.phone ? <span className="text-slate-500"> · {lead.phone}</span> : null}
          <p className="mt-1 font-medium text-slate-800">{sequenceLabel(job, totals)}</p>
          <p className="mt-1 text-slate-700">
            {overdue ? "Waiting since" : "Due"} {formatChicago(job.due_at)}
          </p>
        </div>
        {place.href ? (
          <a href={place.href} className="text-sm text-navy hover:underline" target="_blank" rel="noreferrer">
            {place.label}
          </a>
        ) : (
          <span className="text-slate-500">{place.label}</span>
        )}
      </div>
      <p className="mt-2 text-slate-800">
        Tag: <span className="font-medium">{tagged}</span>
        <span className="text-slate-500"> · {place.label}</span>
      </p>
      <OpenCallPlan
        jobId={job.id}
        dueAt={job.due_at}
        assignedName={assigned}
        consultName={consultName(lead)}
        staff={staff}
      />
    </li>
  );
}

export default async function OpenCallsPage() {
  const { supabase } = await requireStaff();
  const nowIso = new Date().toISOString();
  const now = Date.now();
  const [{ data: waitingRows, error: waitingError }, { data: upcomingRows, error: upcomingError }, { data: stepRows }, staff, slack] =
    await Promise.all([
      supabase
        .from("lead_jobs")
        .select(JOB_SELECT)
        .eq("queue", "call")
        .eq("status", "pending")
        .lte("due_at", nowIso)
        .order("due_at")
        .limit(200),
      supabase
        .from("lead_jobs")
        .select(JOB_SELECT)
        .eq("queue", "call")
        .eq("status", "pending")
        .gt("due_at", nowIso)
        .order("due_at")
        .limit(200),
      supabase.from("sequence_steps").select("sequence, position").eq("queue", "call"),
      loadStaff(supabase),
      loadSlackSettings(),
    ]);

  const totals = new Map<string, number>();
  for (const row of stepRows ?? []) {
    const sequence = String((row as { sequence?: string }).sequence || "");
    const position = Number((row as { position?: number }).position || 0);
    totals.set(sequence, Math.max(totals.get(sequence) ?? 0, position));
  }
  const waiting = (waitingRows ?? []) as JobRow[];
  const upcoming = (upcomingRows ?? []) as JobRow[];
  const error = waitingError?.message || upcomingError?.message || null;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-navy">Open calls</h1>
      <p className="mt-1 max-w-3xl text-sm text-slate-600">
        Check tags that are still waiting for a return call, and the ones coming up. Change the time
        or who is tagged before it goes out. If nobody is chosen, the tag is today’s Outbound on
        #lead-calls, or the person who already consulted.
      </p>
      {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Still waiting · {waiting.length}
        </h2>
        <ul className="mt-3 space-y-3">
          {waiting.map((job) => (
            <JobCard key={job.id} job={job} staff={staff} channelId={slack.channelId} now={now} totals={totals} />
          ))}
          {waiting.length === 0 && !error ? (
            <li className="text-sm text-slate-500">Every due call has a return in the log.</li>
          ) : null}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Upcoming tags · {upcoming.length}
        </h2>
        <ul className="mt-3 space-y-3">
          {upcoming.map((job) => (
            <JobCard key={job.id} job={job} staff={staff} channelId={slack.channelId} now={now} totals={totals} />
          ))}
          {upcoming.length === 0 && !error ? (
            <li className="text-sm text-slate-500">No upcoming call tags are scheduled.</li>
          ) : null}
        </ul>
      </section>
    </main>
  );
}
