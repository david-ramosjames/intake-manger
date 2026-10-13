import Link from "next/link";
import { WorkQueue, type QueueRow } from "@/components/WorkQueue";
import { attachCallrailSources } from "@/lib/callrail";
import { daysSince, isLeadView, leadTitle, listAccident, PRIORITY_REASON_SHORT, slackMessageUrl, type Lead, type LeadView } from "@/lib/leads";
import { leadCycle, leadPriority, leadStatusLabel, nextCallPurpose, nextStepLabel, priorityBucket } from "@/lib/next-step";
import { automationLine, isQueue, matchesQueue, needsAttention, receivedLabel, stageClass, waitingTooLong, type QueueId } from "@/lib/queue";
import { nextActionLines, type CallStep } from "@/lib/next-action";
import { DEFAULT_WORK_HOURS, leadSequenceId, loadWorkHours } from "@/lib/sequences";
import { qualifiedSummary } from "@/lib/tags";
import { formatCallWhen } from "@/lib/time";
import { requireStaff } from "@/lib/session";
import { docketBaseUrl } from "@/lib/supabase/config";

type HistoryTouch = {
  lead_id: string | null;
  phone: string | null;
  type: string | null;
  direction: string | null;
  occurred_at: string | null;
};

function phoneKey(value: string | null | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

function countsAsContact(type: string): boolean {
  return type === "call" || type === "sona_call" || type === "text" || type === "voicemail";
}

async function loadTouches(
  supabase: Awaited<ReturnType<typeof requireStaff>>["supabase"],
  ids: string[],
): Promise<HistoryTouch[]> {
  const rows: HistoryTouch[] = [];
  const page = 1000;
  for (let from = 0; from < 20000; from += page) {
    const { data } = await supabase
      .from("intake_interactions")
      .select("lead_id, phone, type, direction, occurred_at")
      .in("lead_id", ids)
      .order("occurred_at", { ascending: false })
      .range(from, from + page - 1);
    const batch = (data ?? []) as HistoryTouch[];
    rows.push(...batch);
    if (batch.length < page) break;
  }
  return rows;
}

async function loadTouchesByPhone(
  supabase: Awaited<ReturnType<typeof requireStaff>>["supabase"],
  phones: string[],
): Promise<HistoryTouch[]> {
  if (!phones.length) return [];
  const rows: HistoryTouch[] = [];
  const page = 1000;
  for (let from = 0; from < 20000; from += page) {
    const { data } = await supabase
      .from("intake_interactions")
      .select("lead_id, phone, type, direction, occurred_at")
      .in("phone", phones)
      .order("occurred_at", { ascending: false })
      .range(from, from + page - 1);
    const batch = (data ?? []) as HistoryTouch[];
    rows.push(...batch);
    if (batch.length < page) break;
  }
  return rows;
}

function displayPhone(phone: string | null): string | null {
  const value = phone?.trim() ?? "";
  if (!value || /^(null|undefined)$/i.test(value)) return null;
  return value;
}

function lastContacted(days: number | null): string {
  if (days == null) return "Never";
  if (days === 0) return "Today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

type LeadRange = "all" | "today" | "7";

function isLeadRange(value: string | undefined): value is LeadRange {
  return value === "all" || value === "today" || value === "7";
}

function arrivedInRange(age: number | null, range: LeadRange): boolean {
  if (range === "all") return true;
  if (age == null) return false;
  if (range === "today") return age === 0;
  return age <= 6;
}

const RANGES: { id: LeadRange; label: string }[] = [
  { id: "all", label: "Any time" },
  { id: "today", label: "Today" },
  { id: "7", label: "Last 7 days" },
];

const QUEUES: { id: QueueId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "attention", label: "Needs attention" },
  { id: "fresh", label: "New" },
  { id: "working", label: "In progress" },
  { id: "signed", label: "Signed" },
  { id: "closed", label: "Closed" },
];

const LEGACY: { id: LeadView; label: string }[] = [
  { id: "pursue", label: "Want to sign" },
  { id: "needs_info", label: "Need more info" },
  { id: "promoted", label: "Promoted" },
  { id: "verify", label: "Needs verification" },
];

const LIST_COLUMNS =
  "id, lead_date, created_at, lead_name, phone, email, identity_status, lead_source, source_channel, source_note, case_type, case_detail, grade, arrival, lead_status, close_reason, priority_reason, callrail_tags, decline_reason, agreement_status, agreement_sent_at, agreement_signing_url, agreement_next_reminder_at, text_sequence_status, text_sequence_slug, text_next_at, summary, owner_name, kind, sequence, follow_up, needs_verification, signed_case, date_signed, signed_at, case_id, case_number, intake_call_id, quo_link, slack_permalink, slack_channel_id, slack_message_ts, slack_thread_ts";

type ListLead = Pick<
  Lead,
  | "id"
  | "lead_date"
  | "created_at"
  | "lead_name"
  | "phone"
  | "email"
  | "identity_status"
  | "lead_source"
  | "source_channel"
  | "source_note"
  | "case_type"
  | "case_detail"
  | "grade"
  | "arrival"
  | "lead_status"
  | "close_reason"
  | "priority_reason"
  | "callrail_tags"
  | "decline_reason"
  | "agreement_status"
  | "agreement_sent_at"
  | "agreement_signing_url"
  | "agreement_next_reminder_at"
  | "text_sequence_status"
  | "text_sequence_slug"
  | "text_next_at"
  | "summary"
  | "owner_name"
  | "kind"
  | "sequence"
  | "follow_up"
  | "needs_verification"
  | "signed_case"
  | "date_signed"
  | "signed_at"
  | "case_id"
  | "case_number"
  | "intake_call_id"
  | "quo_link"
  | "slack_permalink"
  | "slack_channel_id"
  | "slack_message_ts"
  | "slack_thread_ts"
>;

function listHref(input: { queue?: QueueId; view?: LeadView; q?: string; lead?: string; range?: LeadRange }): string {
  const params = new URLSearchParams();
  if (input.queue && input.queue !== "all") params.set("queue", input.queue);
  if (input.view && input.view !== "all") params.set("view", input.view);
  if (input.range && input.range !== "all") params.set("range", input.range);
  if (input.q) params.set("q", input.q);
  if (input.lead) params.set("lead", input.lead);
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

export default async function LeadListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; view?: string; queue?: string; lead?: string; range?: string }>;
}) {
  const params = await searchParams;
  const view: LeadView = isLeadView(params.view) ? params.view : "all";
  const queue: QueueId = isQueue(params.queue) ? params.queue : "all";
  const range: LeadRange = isLeadRange(params.range) ? params.range : "all";
  const q = (params.q ?? "").trim();
  const selectedId = params.lead?.trim() || "";
  const { supabase } = await requireStaff();
  const docket = docketBaseUrl();

  const [{ data, error }, { data: stepRows }, workHours] = await Promise.all([
    supabase.from("leads").select(LIST_COLUMNS).order("lead_date", { ascending: false, nullsFirst: false }).limit(300),
    supabase.from("sequence_steps").select("sequence, position, delay_minutes").eq("queue", "call").order("position"),
    loadWorkHours(supabase),
  ]);
  const leads = (data ?? []) as ListLead[];
  const callSteps = (stepRows ?? []) as (CallStep & { sequence: string })[];

  await attachCallrailSources(leads, async (id, source) => {
    await supabase.from("leads").update({ lead_source: source }).eq("id", id).is("lead_source", null);
  });

  const talked = new Set<string>();
  const contact = new Map<string, { calls: number; texts: number }>();
  const nextCall = new Map<string, string>();
  const lastOutreach = new Map<string, string>();
  const ids = leads.map((lead) => lead.id);
  const idSet = new Set(ids);
  const idsByPhone = new Map<string, string[]>();
  for (const lead of leads) {
    const key = phoneKey(lead.phone);
    if (!key) continue;
    const list = idsByPhone.get(key) ?? [];
    list.push(lead.id);
    idsByPhone.set(key, list);
  }
  if (ids.length) {
    const [{ data: calls }, touches] = await Promise.all([
      supabase.from("lead_jobs").select("lead_id, due_at, status, queue").in("lead_id", ids).eq("queue", "call").eq("status", "pending"),
      loadTouches(supabase, ids),
    ]);
    for (const touch of touches) {
      const type = String(touch.type || "").toLowerCase();
      const direction = String(touch.direction || "").toLowerCase();
      const owners = new Set<string>();
      if (touch.lead_id && idSet.has(touch.lead_id)) owners.add(touch.lead_id);
      for (const id of idsByPhone.get(phoneKey(touch.phone)) ?? []) owners.add(id);
      for (const leadId of owners) {
        const tally = contact.get(leadId) ?? { calls: 0, texts: 0 };
        if (type === "call" || type === "sona_call" || type === "missed_call") tally.calls += 1;
        if (type === "text") tally.texts += 1;
        contact.set(leadId, tally);
        const reached = type === "call" || type === "sona_call" || (direction === "inbound" && (type === "text" || type === "email"));
        if (reached) talked.add(leadId);
        if (touch.occurred_at && countsAsContact(type)) {
          const current = lastOutreach.get(leadId);
          if (!current || touch.occurred_at > current) lastOutreach.set(leadId, touch.occurred_at);
        }
      }
    }
    const missingPhones = [...idsByPhone.keys()].filter((phone) =>
      (idsByPhone.get(phone) ?? []).some((id) => !lastOutreach.has(id)),
    );
    for (const touch of await loadTouchesByPhone(supabase, missingPhones)) {
      if (touch.lead_id && idSet.has(touch.lead_id)) continue;
      const type = String(touch.type || "").toLowerCase();
      if (!touch.occurred_at || !countsAsContact(type)) continue;
      for (const leadId of idsByPhone.get(phoneKey(touch.phone)) ?? []) {
        const current = lastOutreach.get(leadId);
        if (!current || touch.occurred_at > current) lastOutreach.set(leadId, touch.occurred_at);
      }
    }
    for (const job of calls ?? []) {
      if (!job.lead_id || !job.due_at) continue;
      const current = nextCall.get(job.lead_id);
      if (!current || job.due_at < current) nextCall.set(job.lead_id, job.due_at);
    }
  }

  const rows = leads.map((lead) => {
    const cycle = leadCycle(lead, talked.has(lead.id) ? [{ type: "call", direction: "inbound" }] : []);
    const age = daysSince(lead.lead_date ?? lead.created_at);
    const outreachAt = lastOutreach.get(lead.id);
    const outreach = daysSince(outreachAt);
    const nextAt = nextCall.get(lead.id);
    const tally = contact.get(lead.id) ?? { calls: 0, texts: 0 };
    const waiting = waitingTooLong(cycle, age, outreach, nextAt);
    const attention = needsAttention({
      cycle,
      waiting,
      identityStatus: lead.identity_status,
      agreementStatus: lead.agreement_status,
    });
    return {
      lead,
      cycle,
      age,
      outreachAt,
      outreach,
      nextAt,
      tally,
      waiting,
      attention,
      inWindow: age != null && age <= 30,
      label: leadStatusLabel(lead, cycle),
      step: nextStepLabel(nextCallPurpose(cycle, tally.calls)),
      accident: listAccident(lead),
      priority: leadPriority(lead, cycle),
      bucket: priorityBucket(lead, cycle, talked.has(lead.id)),
    };
  });

  const windowRows = rows.filter((row) => row.inWindow);
  const metrics = {
    fresh: windowRows.filter((row) => row.cycle === "contact").length,
    attention: windowRows.filter((row) => row.attention).length,
    working: windowRows.filter((row) => row.cycle === "information" || row.cycle === "signing").length,
    signed: windowRows.filter((row) => row.cycle === "signed").length,
    closed: windowRows.filter((row) => row.cycle === "closed").length,
    total: windowRows.length,
  };
  const conversion = metrics.total ? Math.round((metrics.signed / metrics.total) * 100) : 0;
  const pipeline = [
    { id: "fresh" as const, label: "New", count: metrics.fresh, className: "bg-amber-400" },
    { id: "working" as const, label: "In progress", count: metrics.working, className: "bg-sky-500" },
    { id: "signed" as const, label: "Signed", count: metrics.signed, className: "bg-emerald-500" },
    { id: "closed" as const, label: "Closed", count: metrics.closed, className: "bg-slate-300" },
  ];

  const needle = q.toLowerCase();
  const shown = rows
    .filter((row) => arrivedInRange(row.age, range))
    .filter((row) => matchesQueue(queue, row.cycle, row.attention))
    .filter((row) => matchesLegacy(view, row.lead))
    .filter((row) => {
      if (!needle) return true;
      const lead = row.lead;
      return [lead.lead_name, lead.phone, lead.email, lead.case_number].some((value) =>
        (value || "").toLowerCase().includes(needle),
      );
    })
    .sort((a, b) => {
      const rank = (row: (typeof rows)[number]) => (row.cycle === "closed" ? 3 : row.cycle === "signed" ? 2 : row.waiting ? 0 : 1);
      const byRank = rank(a) - rank(b);
      if (byRank) return byRank;
      const aWait = a.outreach ?? 99;
      const bWait = b.outreach ?? 99;
      if (aWait !== bWait) return bWait - aWait;
      return (b.age ?? 0) - (a.age ?? 0);
    });

  const queueRows: QueueRow[] = shown.map((row) => {
    const automation = automationLine(row.lead);
    return {
      id: row.lead.id,
      title: leadTitle(row.lead),
      identityStatus: row.lead.identity_status,
      accident: row.accident,
      when: receivedLabel(row.age),
      priority: row.bucket ? PRIORITY_REASON_SHORT[row.bucket] : row.priority,
      label: row.label,
      stageClassName: stageClass(row.label),
      step: row.step,
      tags: row.lead.callrail_tags ?? [],
      declineReason: row.lead.decline_reason,
      qualifiedLabel: qualifiedSummary(row.lead.callrail_tags ?? [], row.lead.decline_reason),
      signed: row.lead.signed_case || ["signed", "completed"].includes((row.lead.agreement_status || "").toLowerCase()),
      lastLabel: lastContacted(row.outreach),
      waiting: row.waiting,
      automationLabel: automation.label,
      automationBad: automation.bad,
      quoUrl: row.lead.quo_link,
      slackUrl: slackMessageUrl(row.lead),
      phone: displayPhone(row.lead.phone),
      email: row.lead.email,
      summary: row.lead.summary,
      owner: row.lead.owner_name,
      grade: row.lead.grade,
      textsLive: (row.lead.text_sequence_status || "").toLowerCase() === "active",
      textNext: row.lead.text_next_at,
      agreementStatus: row.lead.agreement_status,
      agreementSent: row.lead.agreement_sent_at,
      signingUrl: row.lead.agreement_signing_url,
      intakeHref: row.lead.intake_call_id ? `${docket}/intakes/${encodeURIComponent(row.lead.intake_call_id)}` : null,
      caseHref: row.lead.case_id ? `${docket}/cases/${row.lead.case_id}` : null,
      calls: row.tally.calls,
      texts: row.tally.texts,
      nextCallLabel: formatCallWhen(row.nextAt),
      nextAction: nextActionLines({
        closed: row.cycle === "signed" || row.cycle === "closed",
        sequence: row.lead.sequence,
        textStatus: row.lead.text_sequence_status,
        textNextAt: row.lead.text_next_at,
        reminderAt: row.lead.agreement_next_reminder_at,
        agreementStatus: row.lead.agreement_status,
        callStart: row.lead.lead_date ?? row.lead.created_at,
        callsMade: row.tally.calls,
        pendingCallAt: row.nextAt ?? null,
        callSteps: stepsForLead(callSteps, {
          closed: row.cycle === "signed" || row.cycle === "closed",
          talked: talked.has(row.lead.id),
          kind: row.lead.kind,
          agreementStatus: row.lead.agreement_status,
          agreementSentAt: row.lead.agreement_sent_at,
        }),
        hours:
          workHours[
            leadSequenceId({
              closed: row.cycle === "signed" || row.cycle === "closed",
              talked: talked.has(row.lead.id),
              kind: row.lead.kind,
              agreementStatus: row.lead.agreement_status,
              agreementSentAt: row.lead.agreement_sent_at,
            }) ?? "want_to_sign"
          ] ?? DEFAULT_WORK_HOURS,
      }),
    };
  });

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Work queue</h1>
          <p className="mt-1 text-sm text-slate-600">What to work on next. Counts are the last 30 days.</p>
        </div>
        <form action="/" className="flex items-center gap-2">
          {queue !== "all" ? <input type="hidden" name="queue" value={queue} /> : null}
          {view !== "all" ? <input type="hidden" name="view" value={view} /> : null}
          {range !== "all" ? <input type="hidden" name="range" value={range} /> : null}
          <input
            name="q"
            defaultValue={q}
            placeholder="Name, phone, email, or case number"
            className="w-64 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
          />
        </form>
      </div>

      {error ? <p className="mt-6 text-sm text-red-700">{error.message}</p> : null}

      <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Metric href={listHref({ queue: "fresh", q, range })} active={queue === "fresh"} label="New" value={String(metrics.fresh)} hint="Need to contact" tone="text-amber-700" />
        <Metric href={listHref({ queue: "attention", q, range })} active={queue === "attention"} label="Need action" value={String(metrics.attention)} hint="Waiting or blocked" tone="text-red-700" />
        <Metric href={listHref({ queue: "working", q, range })} active={queue === "working"} label="Following up" value={String(metrics.working)} hint="In conversation or signing" tone="text-sky-700" />
        <Metric href={listHref({ queue: "signed", q, range })} active={queue === "signed"} label="Signed" value={String(metrics.signed)} hint="Signed in 30 days" tone="text-emerald-700" />
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Conversion</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{conversion}%</p>
          <p className="mt-1 text-xs text-slate-500">Signed of {metrics.total} in 30 days</p>
        </div>
      </section>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span className="font-medium uppercase tracking-wide">Intake pipeline</span>
          <span>Last 30 days</span>
        </div>
        <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-slate-100">
          {pipeline.map((part) =>
            part.count ? (
              <Link
                key={part.id}
                href={listHref({ queue: part.id, q, range })}
                title={`${part.label}: ${part.count}`}
                className={part.className}
                style={{ width: `${(part.count / Math.max(metrics.total, 1)) * 100}%` }}
              />
            ) : null,
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-600">
          {pipeline.map((part) => (
            <Link key={part.id} href={listHref({ queue: part.id, q, range })} className="hover:text-slate-900">
              {part.label} ({part.count})
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link
          href="/priority"
          className="rounded-full bg-white px-3 py-1 text-sm font-medium text-slate-900 ring-1 ring-slate-200"
        >
          Priority
        </Link>
        <span className="ml-1 text-xs font-medium uppercase tracking-wide text-slate-400">Arrived</span>
        {RANGES.map((item) => (
          <Link
            key={item.id}
            href={listHref({ queue, view, q, range: item.id })}
            className={`rounded-full px-3 py-1 text-sm ${
              range === item.id ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"
            }`}
          >
            {item.label}
          </Link>
        ))}
        <span className="mx-1 hidden h-5 w-px bg-slate-200 sm:inline-block" aria-hidden="true" />
        {QUEUES.map((item) => (
          <Link
            key={item.id}
            href={listHref({ queue: item.id, view, q, range })}
            className={`rounded-full px-3 py-1 text-sm ${
              queue === item.id ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      <WorkQueue rows={queueRows} initialId={selectedId} />

      <p className="mt-4 flex flex-wrap gap-3 text-xs text-slate-500">
        <span>Also</span>
        {LEGACY.map((item) => (
          <Link key={item.id} href={listHref({ view: item.id, q, range })} className={view === item.id ? "font-medium text-slate-900" : "hover:text-slate-900"}>
            {item.label}
          </Link>
        ))}
        {view !== "all" ? (
          <Link href={listHref({ queue, q, range })} className="hover:text-slate-900">
            Clear that filter
          </Link>
        ) : null}
      </p>
    </main>
  );
}

function stepsForLead(
  steps: (CallStep & { sequence: string })[],
  lead: {
    closed: boolean;
    talked: boolean;
    kind: string | null;
    agreementStatus: string | null;
    agreementSentAt: string | null;
  },
): CallStep[] {
  const sequence = leadSequenceId(lead);
  if (!sequence) return [];
  return steps.filter((step) => step.sequence === sequence);
}

function matchesLegacy(view: LeadView, lead: ListLead): boolean {
  if (view === "pursue" || view === "needs_info") return lead.kind === view;
  if (view === "open") return !lead.signed_case && !lead.case_id && lead.lead_status !== "Lost" && lead.lead_status !== "Referred";
  if (view === "signed") return lead.signed_case && !lead.case_id;
  if (view === "promoted") return Boolean(lead.case_id);
  if (view === "verify") return lead.needs_verification;
  return true;
}

function Metric({
  href,
  active,
  label,
  value,
  hint,
  tone,
}: {
  href: string;
  active: boolean;
  label: string;
  value: string;
  hint: string;
  tone: string;
}) {
  return (
    <Link href={href} className={`rounded-xl border bg-white px-4 py-3 ${active ? "border-slate-900" : "border-slate-200 hover:border-slate-300"}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{value}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </Link>
  );
}
