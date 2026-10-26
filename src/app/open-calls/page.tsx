import { OpenCallsList, type OpenCallCard } from "@/components/OpenCallsList";
import { loadStaff } from "@/lib/identity";
import { leadTitle, slackMessageUrl } from "@/lib/leads";
import { CALL_SEQUENCE_LABEL, isCallSequence } from "@/lib/sequences";
import { requireStaff } from "@/lib/session";
import { LEAD_CHANNEL_ID } from "@/lib/slack";
import { loadSlackSettings } from "@/lib/slack-settings";
import { isPlaceholderOwner } from "@/lib/talked-with";
import { formatCallDayHeading, formatChicago } from "@/lib/time";
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
  lead_status: string | null;
  signed_case: boolean | null;
  case_id: string | null;
  caller_class: string | null;
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

const CLOSED_STATUSES = "(Signed,Promoted,Lost,Referred)";
const JOB_SELECT =
  "id, lead_id, sequence, position, due_at, status, mention, assigned_name, notified_at, leads!inner(id, lead_name, phone, owner_name, consultation_date, quo_link, slack_permalink, slack_channel_id, slack_message_ts, slack_thread_ts, identity_status, lead_status, signed_case, case_id, caller_class)";

function leadStillOpen(lead: LeadBits | null): boolean {
  if (!lead) return false;
  if (lead.caller_class && lead.caller_class !== "non_pi") return false;
  if (lead.signed_case === true || lead.case_id) return false;
  return !["Signed", "Promoted", "Lost", "Referred"].includes(lead.lead_status || "");
}

function nextCallPerLead(jobs: JobRow[]): JobRow[] {
  const next = new Map<string, JobRow>();
  for (const job of jobs) {
    const current = next.get(job.lead_id);
    if (
      !current ||
      job.due_at < current.due_at ||
      (job.due_at === current.due_at && job.position < current.position)
    ) {
      next.set(job.lead_id, job);
    }
  }
  return [...next.values()].sort((a, b) => a.due_at.localeCompare(b.due_at) || a.position - b.position);
}

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
    dayLabel: formatCallDayHeading(job.due_at),
    overdue: new Date(job.due_at).getTime() < now,
    placeLabel: place.label,
    placeHref: place.href,
    quoUrl: lead?.quo_link || null,
    assignedName: assigned,
    consultName: consultName(lead),
    consulted: Boolean(lead?.consultation_date),
    tagName: assigned || (lead?.consultation_date ? consultName(lead) || "Not tagged" : "Outbound"),
    dueAt: job.due_at,
  };
}

function tagOptions(names: string[]): string[] {
  const unique = [...new Set(names.filter(Boolean))];
  unique.sort((a, b) => a.localeCompare(b));
  const rest = unique.filter((name) => name !== "Outbound");
  return unique.includes("Outbound") ? ["Outbound", ...rest] : rest;
}

export default async function OpenCallsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; lead?: string; tag?: string }>;
}) {
  const params = await searchParams;
  const view: CallView = params.view === "upcoming" ? "upcoming" : "waiting";
  const tag = params.tag?.trim() || "";
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
        .eq("leads.test", false)
        .or("caller_class.is.null,caller_class.eq.non_pi", { referencedTable: "leads" })
        .or("signed_case.is.null,signed_case.eq.false", { referencedTable: "leads" })
        .is("leads.case_id", null)
        .not("leads.lead_status", "in", CLOSED_STATUSES)
        .order("due_at")
        .limit(1000),
      supabase
        .from("lead_jobs")
        .select(JOB_SELECT)
        .eq("queue", "call")
        .eq("status", "pending")
        .gt("due_at", nowIso)
        .eq("leads.test", false)
        .or("caller_class.is.null,caller_class.eq.non_pi", { referencedTable: "leads" })
        .or("signed_case.is.null,signed_case.eq.false", { referencedTable: "leads" })
        .is("leads.case_id", null)
        .not("leads.lead_status", "in", CLOSED_STATUSES)
        .order("due_at")
        .limit(1000),
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
  const waiting = nextCallPerLead(((waitingRows ?? []) as JobRow[]).filter((job) => leadStillOpen(leadOf(job)))).map((job) =>
    toCard(job, slack.channelId, now, totals),
  );
  const upcoming = nextCallPerLead(((upcomingRows ?? []) as JobRow[]).filter((job) => leadStillOpen(leadOf(job)))).map((job) =>
    toCard(job, slack.channelId, now, totals),
  );
  const people = tagOptions(["Outbound", ...staff.map((person) => person.name), ...waiting.map((job) => job.tagName), ...upcoming.map((job) => job.tagName)]);
  const matches = (job: OpenCallCard) => !tag || job.tagName === tag;
  const waitingShown = waiting.filter(matches);
  const upcomingShown = upcoming.filter(matches);
  const error = waitingError?.message || upcomingError?.message || null;
  const jobs = view === "upcoming" ? upcomingShown : waitingShown;
  const selectedLead = params.lead?.trim() || "";
  const [shelf, selected] = await Promise.all([
    loadWorkQueueShelfContext(supabase),
    selectedLead ? loadWorkQueueRows(supabase, [selectedLead]) : Promise.resolve({ rows: [] }),
  ]);

  return (
    <main className="w-full px-4 py-8 xl:px-6">
      <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-navy">
        Open calls
        <span className="group relative inline-flex">
          <button
            type="button"
            aria-label="About open calls"
            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 text-xs font-semibold text-slate-500 hover:border-slate-400 hover:text-slate-700"
          >
            ?
          </button>
          <span
            role="tooltip"
            className="pointer-events-none absolute top-full left-0 z-20 mt-2 hidden w-80 rounded-md border border-slate-200 bg-white p-3 text-sm font-normal tracking-normal text-slate-600 shadow-lg group-hover:block group-focus-within:block"
          >
            Check tags that are still waiting for a return call, and the ones coming up. Change the time or who is tagged
            before it goes out. After a consult, tag the person who handled it — not Outbound. Uncontacted leads still use
            today’s Outbound on #lead-calls.
          </span>
        </span>
      </h1>
      {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
      <OpenCallsList
        view={view}
        waitingCount={waitingShown.length}
        upcomingCount={upcomingShown.length}
        jobs={jobs}
        destinations={shelf.destinations}
        templates={shelf.templates}
        staff={staff}
        staffNames={shelf.staffNames}
        people={people}
        tag={tag}
        completed={finishCounts.completed}
        autoClosed={finishCounts.autoClosed}
        admin={admin}
        initialRow={selected.rows[0] ?? null}
      />
    </main>
  );
}
