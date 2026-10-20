import { OpenCallsList, type OpenCallCard } from "@/components/OpenCallsList";
import { loadStaff } from "@/lib/identity";
import { leadTitle, slackMessageUrl } from "@/lib/leads";
import { CALL_SEQUENCE_LABEL, isCallSequence } from "@/lib/sequences";
import { requireStaff } from "@/lib/session";
import { LEAD_CHANNEL_ID } from "@/lib/slack";
import { loadSlackSettings } from "@/lib/slack-settings";
import { isPlaceholderOwner } from "@/lib/talked-with";
import { formatChicago } from "@/lib/time";
import { callFinishCounts, collapseDuplicateOpenCalls } from "@/lib/open-calls";
import { loadWorkQueueRows, loadWorkQueueShelfContext } from "@/lib/work-queue-rows";

export const metadata = { title: "Open calls · Intake Manager" };

type CallView = "waiting" | "upcoming";

type LeadBits = {
  id: string;
  lead_name: string | null;
  phone: string | null;
  owner_name: string | null;
  consultation_date: string | null;
  quo_link: string | null;
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
  "id, lead_id, sequence, position, due_at, status, mention, assigned_name, notified_at, leads(id, lead_name, phone, owner_name, consultation_date, quo_link, slack_permalink, slack_channel_id, slack_message_ts, slack_thread_ts, identity_status)";

function leadOf(job: JobRow): LeadBits | null {
  if (!job.leads) return null;
  return Array.isArray(job.leads) ? job.leads[0] ?? null : job.leads;
}

function consultName(lead: LeadBits | null): string {
  if (!lead?.consultation_date || isPlaceholderOwner(lead.owner_name)) return "";
  return lead.owner_name?.trim() || "";
}

function callPlace(lead: LeadBits | null, channelId: string): { label: string; href: string | null } {
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

function toCard(job: JobRow, channelId: string, now: number, totals: Map<string, number>): OpenCallCard {
  const lead = leadOf(job);
  const place = callPlace(lead, channelId);
  const assigned = job.assigned_name && !isPlaceholderOwner(job.assigned_name) ? job.assigned_name.trim() : "";
  return {
    id: job.id,
    leadId: job.lead_id,
    title: leadTitle({
      lead_name: lead?.lead_name ?? null,
      phone: lead?.phone ?? null,
      identity_status: lead?.identity_status,
    }),
    phone: lead?.phone ?? null,
    sequenceLabel: sequenceLabel(job, totals),
    dueLabel: formatChicago(job.due_at),
    overdue: new Date(job.due_at).getTime() < now,
    placeLabel: place.label,
    placeHref: place.href,
    quoUrl: lead?.quo_link || null,
    assignedName: assigned,
    consultName: consultName(lead),
    consulted: Boolean(lead?.consultation_date),
    dueAt: job.due_at,
  };
}

export default async function OpenCallsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; lead?: string }>;
}) {
  const params = await searchParams;
  const view: CallView = params.view === "upcoming" ? "upcoming" : "waiting";
  const { supabase, admin } = await requireStaff();
  await collapseDuplicateOpenCalls(supabase);
  const finishCounts = await callFinishCounts(supabase);
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
  const rows = view === "upcoming" ? upcoming : waiting;
  const jobs = rows.map((job) => toCard(job, slack.channelId, now, totals));
  const selectedLead = params.lead?.trim() || "";
  const [shelf, selected] = await Promise.all([
    loadWorkQueueShelfContext(supabase),
    selectedLead ? loadWorkQueueRows(supabase, [selectedLead]) : Promise.resolve({ rows: [] }),
  ]);

  return (
    <main className="w-full px-4 py-8 xl:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-navy">Open calls</h1>
      <p className="mt-1 max-w-3xl text-sm text-slate-600">
        Check tags that are still waiting for a return call, and the ones coming up. Change the time
        or who is tagged before it goes out. After a consult, tag the person who handled it — not
        Outbound. Uncontacted leads still use today’s Outbound on #lead-calls.
      </p>
      <p className="mt-3 text-sm text-slate-700">
        <span className="font-semibold text-navy">{finishCounts.completed}</span> completed
        <span className="mx-2 text-slate-300">·</span>
        <span className="font-semibold text-navy">{finishCounts.autoClosed}</span> auto-closed
      </p>
      {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
      <OpenCallsList
        view={view}
        waitingCount={waiting.length}
        upcomingCount={upcoming.length}
        jobs={jobs}
        destinations={shelf.destinations}
        templates={shelf.templates}
        staff={staff}
        staffNames={shelf.staffNames}
        admin={admin}
        initialRow={selected.rows[0] ?? null}
      />
    </main>
  );
}
