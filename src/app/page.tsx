import Link from "next/link";
import { WorkQueue, type QueueRow } from "@/components/WorkQueue";
import { attachCallrailSources } from "@/lib/callrail";
import { consultationWhen, desiredWord, milestoneDesired, milestoneQualified, milestoneSigned, signatureNeedsConfirm } from "@/lib/desired";
import { daysSince, isLeadView, leadTitle, listAccident, slackMessageUrl, type Lead, type LeadView } from "@/lib/leads";
import { leadCycle, leadStatusLabel, nextCallPurpose, nextStepLabel, openLeadAction, outreachSequence, PRIORITY_PLACE_LABEL, priorityPlace } from "@/lib/next-step";
import { callerClassLabel, isWorkLead } from "@/lib/caller-class";
import { automationLine, isQueue, matchesQueue, needsAttention, receivedLabel, stageClass, waitingTooLong, type QueueId } from "@/lib/queue";
import { nextActionLines, type CallStep } from "@/lib/next-action";
import { sequenceDayOne } from "@/lib/followup";
import { leadSequenceId } from "@/lib/sequences";
import { phoneLikePattern, phoneMatches, phoneTail } from "@/lib/phone";
import { chicagoDay, formatCallWhen } from "@/lib/time";
import { requireStaff } from "@/lib/session";
import { docketBaseUrl } from "@/lib/supabase/config";

type HistoryTouch = {
  lead_id: string | null;
  phone: string | null;
  type: string | null;
  direction: string | null;
  occurred_at: string | null;
  quo_link: string | null;
  slack_permalink: string | null;
};

function recentCutoff(): string {
  const [year, month, day] = chicagoDay(new Date()).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 30)).toISOString().slice(0, 10);
}

function phoneKey(value: string | null | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

function combineByPhone<T extends { lead: ListLead; cycle: string; age: number | null; inWindow: boolean }>(
  input: T[],
): { row: T; others: T[] }[] {
  const groups = new Map<string, T[]>();
  const order: string[] = [];
  for (const row of input) {
    const key = phoneKey(row.lead.phone) || phoneKey(row.lead.phone_e164) || `id:${row.lead.id}`;
    const list = groups.get(key);
    if (list) list.push(row);
    else {
      groups.set(key, [row]);
      order.push(key);
    }
  }
  return order.map((key) => {
    const group = groups.get(key) ?? [];
    const sorted = [...group].sort((a, b) => {
      const rank = (item: T) => (item.lead.signed_case || item.lead.case_id || item.cycle === "signed" ? 0 : item.cycle === "closed" ? 2 : 1);
      const byRank = rank(a) - rank(b);
      if (byRank) return byRank;
      const aStamp = a.lead.lead_date ?? a.lead.created_at ?? "";
      const bStamp = b.lead.lead_date ?? b.lead.created_at ?? "";
      return bStamp.localeCompare(aStamp);
    });
    const [keeper, ...others] = sorted;
    const age = group.reduce<number | null>((newest, item) => (item.age != null && (newest == null || item.age < newest) ? item.age : newest), null);
    return { row: { ...keeper, age, inWindow: age != null && age <= 30 }, others };
  });
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
      .select("lead_id, phone, type, direction, occurred_at, quo_link, slack_permalink")
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
      .select("lead_id, phone, type, direction, occurred_at, quo_link, slack_permalink")
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
  if (!value || /^(null|undefined|anonymous|unknown|restricted|withheld|private)$/i.test(value)) return null;
  if (phoneTail(value).length < 7) return null;
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

const LEGACY: { id: LeadView; label: string }[] = [
  { id: "pursue", label: "Want to sign" },
  { id: "needs_info", label: "Need more info" },
  { id: "promoted", label: "Promoted" },
  { id: "verify", label: "Needs verification" },
];

const LIST_COLUMNS =
  "id, lead_date, created_at, lead_name, phone, phone_e164, email, identity_status, lead_source, source_channel, source_note, case_type, case_detail, grade, arrival, lead_status, close_reason, close_suggestion, caller_class, practice_area, referral_opportunity, priority, priority_reason, priority_suggestion, next_action, callrail_tags, decline_reason, consultation_date, desired_case, desired_source, qualified, agreement_status, agreement_sent_at, agreement_signing_url, agreement_next_reminder_at, agreement_reminder_count, agreement_via_sms, agreement_via_email, text_sequence_status, text_sequence_slug, text_next_at, summary, owner_name, kind, sequence, follow_up, needs_verification, signed_case, date_signed, signed_at, case_id, case_number, intake_call_id, callrail_call_id, quo_link, slack_permalink, slack_channel_id, slack_message_ts, slack_thread_ts";

type ListLead = Pick<
  Lead,
  | "id"
  | "lead_date"
  | "created_at"
  | "lead_name"
  | "phone"
  | "phone_e164"
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
  | "close_suggestion"
  | "caller_class"
  | "practice_area"
  | "referral_opportunity"
  | "priority"
  | "priority_reason"
  | "priority_suggestion"
  | "next_action"
  | "callrail_tags"
  | "decline_reason"
  | "consultation_date"
  | "desired_case"
  | "desired_source"
  | "qualified"
  | "agreement_status"
  | "agreement_sent_at"
  | "agreement_signing_url"
  | "agreement_next_reminder_at"
  | "agreement_reminder_count"
  | "agreement_via_sms"
  | "agreement_via_email"
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
  | "callrail_call_id"
  | "quo_link"
  | "slack_permalink"
  | "slack_channel_id"
  | "slack_message_ts"
  | "slack_thread_ts"
>;

type Funnel = "open" | "closed";

function listHref(input: { queue?: QueueId; view?: LeadView; q?: string; lead?: string; range?: LeadRange; funnel?: Funnel }): string {
  const params = new URLSearchParams();
  if (input.funnel === "closed") params.set("funnel", "closed");
  if (input.queue && input.queue !== "all") params.set("queue", input.queue);
  if (input.view && input.view !== "all") params.set("view", input.view);
  if (input.range && input.range !== "all") params.set("range", input.range);
  if (input.q) params.set("q", input.q);
  if (input.lead) params.set("lead", input.lead);
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

async function searchLeads(
  supabase: Awaited<ReturnType<typeof requireStaff>>["supabase"],
  q: string,
): Promise<ListLead[]> {
  const digits = phoneTail(q);
  const pattern = phoneLikePattern(q);
  const safe = q.replace(/[%(),]/g, "").trim();
  if (pattern && digits.length >= 7) {
    const { data: matches } = await supabase
      .from("leads")
      .select(LIST_COLUMNS)
      .or(`phone_e164.ilike.%${digits}%,phone.ilike.%${digits}%,phone.ilike.%${pattern}%`)
      .limit(40);
    return (matches ?? []) as ListLead[];
  }
  if (safe.length >= 2 && digits.length < 7) {
    const { data: matches } = await supabase
      .from("leads")
      .select(LIST_COLUMNS)
      .or(`lead_name.ilike.%${safe}%,email.ilike.%${safe}%,case_number.ilike.%${safe}%`)
      .limit(40);
    return (matches ?? []) as ListLead[];
  }
  return [];
}

export default async function LeadListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; view?: string; queue?: string; lead?: string; range?: string; funnel?: string }>;
}) {
  const params = await searchParams;
  const view: LeadView = isLeadView(params.view) ? params.view : "all";
  const funnel: Funnel = params.funnel === "closed" ? "closed" : "open";
  const requested = params.queue === "fresh" ? "contact" : params.queue;
  const queue: QueueId = isQueue(requested) ? requested : "all";
  const range: LeadRange = isLeadRange(params.range) ? params.range : "all";
  const q = (params.q ?? "").trim();
  const selectedId = params.lead?.trim() || "";
  const { supabase } = await requireStaff();
  const docket = docketBaseUrl();

  let leadQuery = supabase
    .from("leads")
    .select(LIST_COLUMNS)
    .or("caller_class.is.null,caller_class.eq.non_pi")
    .order("lead_date", { ascending: false, nullsFirst: false })
    .limit(300);
  leadQuery = funnel === "closed"
    ? leadQuery.or("lead_status.in.(Signed,Promoted,Lost,Referred),signed_case.eq.true,case_id.not.is.null")
    : leadQuery.not("lead_status", "in", "(Signed,Promoted,Lost,Referred)").eq("signed_case", false).is("case_id", null);
  const since = recentCutoff();
  const [{ data, error }, reviewResult, reviewCount, signedCount, closedCount, { data: stepRows }] = await Promise.all([
    leadQuery,
    queue === "nonleads"
      ? supabase
          .from("leads")
          .select(LIST_COLUMNS)
          .in("caller_class", ["spam", "vendor", "employment", "existing_client", "insurance", "other_law_office", "wrong_number", "return_call"])
          .order("lead_date", { ascending: false, nullsFirst: false })
          .limit(300)
      : Promise.resolve({ data: [] as ListLead[], error: null }),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .in("caller_class", ["spam", "vendor", "employment", "existing_client", "insurance", "other_law_office", "wrong_number", "return_call"]),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .or("caller_class.is.null,caller_class.eq.non_pi")
      .or("signed_case.eq.true,lead_status.eq.Signed")
      .gte("lead_date", since),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .or("caller_class.is.null,caller_class.eq.non_pi")
      .in("lead_status", ["Lost", "Referred", "Promoted"])
      .eq("signed_case", false)
      .gte("lead_date", since),
    supabase.from("sequence_steps").select("sequence, position, delay_minutes, callback_window").eq("queue", "call").order("position"),
  ]);
  const workLeads = (data ?? []) as ListLead[];
  const reviewLeads = (reviewResult.data ?? []) as ListLead[];
  const searched = await searchLeads(supabase, q);
  const merged = new Map<string, ListLead>();
  for (const lead of [...searched, ...workLeads, ...(queue === "nonleads" ? reviewLeads : [])]) {
    merged.set(lead.id, lead);
  }
  const leads = [...merged.values()];
  const callSteps = (stepRows ?? []) as (CallStep & { sequence: string })[];

  await attachCallrailSources(leads, async (id, source) => {
    await supabase.from("leads").update({ lead_source: source }).eq("id", id).is("lead_source", null);
  });

  const talked = new Set<string>();
  const contact = new Map<string, { calls: number; texts: number }>();
  const nextCall = new Map<string, string>();
  const lastOutreach = new Map<string, string>();
  const outsideLinks = new Map<string, { quo: string | null; slack: string | null }>();
  const rememberLinks = (leadId: string, touch: HistoryTouch) => {
    const current = outsideLinks.get(leadId) ?? { quo: null, slack: null };
    if (!current.quo && touch.quo_link) current.quo = touch.quo_link;
    if (!current.slack && touch.slack_permalink) current.slack = touch.slack_permalink;
    outsideLinks.set(leadId, current);
  };
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
        rememberLinks(leadId, touch);
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
        rememberLinks(leadId, touch);
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
      actionTitle: openLeadAction(lead, cycle, tally.calls),
      accident: listAccident(lead),
      priority: priorityPlace(lead),
    };
  });

  const workRows = rows.filter((row) => isWorkLead(row.lead));
  const listed = queue === "nonleads" ? rows.filter((row) => !isWorkLead(row.lead)) : workRows;
  const combined = combineByPhone(listed);
  const windowRows = combineByPhone(workRows).filter((group) => group.row.inWindow);
  const metrics = {
    contact: windowRows.filter((group) => group.row.cycle === "contact").length,
    information: windowRows.filter((group) => group.row.cycle === "information").length,
    signing: windowRows.filter((group) => group.row.cycle === "signing").length,
    attention: windowRows.filter((group) => group.row.attention).length,
    signed: funnel === "open" ? (signedCount.count ?? 0) : windowRows.filter((group) => group.row.cycle === "signed").length,
    closed: funnel === "open" ? (closedCount.count ?? 0) : windowRows.filter((group) => group.row.cycle === "closed").length,
    total: funnel === "open" ? windowRows.length + (signedCount.count ?? 0) : windowRows.length,
  };
  const conversion = metrics.total ? Math.round((metrics.signed / metrics.total) * 100) : 0;
  const pipeline = [
    { id: "contact" as const, label: "Need to contact", count: metrics.contact, className: "bg-amber-400" },
    { id: "information" as const, label: "Need more information", count: metrics.information, className: "bg-sky-500" },
    { id: "signing" as const, label: "Finish signing", count: metrics.signing, className: "bg-violet-500" },
    { id: "signed" as const, label: "Signed", count: metrics.signed, className: "bg-emerald-500" },
    { id: "closed" as const, label: "Closed", count: metrics.closed, className: "bg-slate-300" },
  ];

  const needle = q.toLowerCase();
  const phoneSearch = phoneTail(q).length >= 7;
  const shown = combined
    .filter((group) => phoneSearch || arrivedInRange(group.row.age, range))
    .filter((group) => phoneSearch || matchesQueue(queue, group.row.cycle, group.row.attention))
    .filter((group) => phoneSearch || matchesLegacy(view, group.row.lead))
    .filter((group) => {
      if (!needle) return true;
      return [group.row, ...group.others].some((item) => {
        const lead = item.lead;
        const textHit = [lead.lead_name, lead.phone, lead.phone_e164, lead.email, lead.case_number].some((value) =>
          (value || "").toLowerCase().includes(needle),
        );
        if (textHit) return true;
        return phoneMatches(lead.phone || lead.phone_e164, q);
      });
    })
    .sort((a, b) => {
      const rank = (row: (typeof rows)[number]) => (row.cycle === "closed" ? 3 : row.cycle === "signed" ? 2 : row.waiting ? 0 : 1);
      const byRank = rank(a.row) - rank(b.row);
      if (byRank) return byRank;
      const aWait = a.row.outreach ?? 99;
      const bWait = b.row.outreach ?? 99;
      if (aWait !== bWait) return bWait - aWait;
      return (b.row.age ?? 0) - (a.row.age ?? 0);
    });

  const queueRows: QueueRow[] = shown.map(({ row, others }) => {
    const automation = automationLine(row.lead);
    return {
      id: row.lead.id,
      title: leadTitle(row.lead),
      samePhone: others.map((other) => ({
        id: other.lead.id,
        title: leadTitle(other.lead),
        label: other.label,
      })),
      closeSuggestion: row.lead.close_suggestion,
      identityStatus: row.lead.identity_status,
      accident: row.accident,
      when: receivedLabel(row.age),
      priority: row.priority ? PRIORITY_PLACE_LABEL[row.priority] : null,
      prioritySuggestion: row.lead.priority_suggestion,
      actionTitle: row.actionTitle,
      label: callerClassLabel(row.lead.caller_class) ?? row.label,
      stageClassName: stageClass(row.label),
      step: row.step,
      tags: row.lead.callrail_tags ?? [],
      callrail: Boolean(row.lead.callrail_call_id),
      declineReason: row.lead.decline_reason,
      qualifiedLabel: desiredWord(milestoneQualified(row.lead)),
      consultWhen: consultationWhen(row.lead.consultation_date),
      desired: desiredWord(milestoneDesired(row.lead)),
      signed: milestoneSigned(row.lead),
      nonPi: row.lead.caller_class === "non_pi",
      confirmSigned: signatureNeedsConfirm(row.lead),
      lastLabel: lastContacted(row.outreach),
      lastDays: row.outreach,
      consultKey: row.lead.consultation_date ?? "",
      waiting: row.waiting,
      automationLabel: automation.label,
      automationBad: automation.bad,
      quoUrl: row.lead.quo_link || outsideLinks.get(row.lead.id)?.quo || null,
      slackUrl: slackMessageUrl(row.lead) || outsideLinks.get(row.lead.id)?.slack || null,
      phone: displayPhone(row.lead.phone),
      email: row.lead.email,
      summary: row.lead.summary,
      owner: row.lead.owner_name,
      grade: row.lead.grade,
      textsLive: (row.lead.text_sequence_status || "").toLowerCase() === "active",
      textNext: row.lead.text_next_at,
      sequenceLabel: outreachSequence(row.lead).label,
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
        callStart: dayOneFor(row.lead, {
          closed: row.cycle === "signed" || row.cycle === "closed",
          talked: talked.has(row.lead.id),
          kind: row.lead.kind,
          agreementStatus: row.lead.agreement_status,
          agreementSentAt: row.lead.agreement_sent_at,
          signedCase: row.lead.signed_case,
        }),
        callsMade: row.tally.calls,
        pendingCallAt: row.nextAt ?? null,
        callSteps: stepsForLead(callSteps, {
          closed: row.cycle === "signed" || row.cycle === "closed",
          talked: talked.has(row.lead.id),
          kind: row.lead.kind,
          agreementStatus: row.lead.agreement_status,
          agreementSentAt: row.lead.agreement_sent_at,
          signedCase: row.lead.signed_case,
        }),
        priority: row.priority === "contract" || row.priority === "flagged",
        contactAt: row.lead.created_at,
      }),
    };
  });

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-navy">Work queue</h1>
          <p className="mt-1 text-sm text-slate-600">
            {funnel === "closed" ? "Closed leads." : "Open leads."} A lead stays open until it is signed, declined, referred, rejected, or the sequence ends with no reply. Counts are the last 30 days.
          </p>
        </div>
        <form action="/" className="flex items-center gap-2">
          {funnel === "closed" ? <input type="hidden" name="funnel" value="closed" /> : null}
          {queue !== "all" ? <input type="hidden" name="queue" value={queue} /> : null}
          {view !== "all" ? <input type="hidden" name="view" value={view} /> : null}
          {range !== "all" ? <input type="hidden" name="range" value={range} /> : null}
          <input
            name="q"
            defaultValue={q}
            placeholder="Name, phone, or part of a phone"
            className="w-64 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
          />
          <Link href="/" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700">
            Clear
          </Link>
        </form>
      </div>

      {error ? <p className="mt-6 text-sm text-red-700">{error.message}</p> : null}

      <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Metric href={listHref({ queue: "contact", q, range, funnel })} active={queue === "contact"} label="Need to contact" value={String(metrics.contact)} hint="Not reached yet" tone="text-amber-700" />
        <Metric href={listHref({ queue: "information", q, range, funnel })} active={queue === "information"} label="Need more information" value={String(metrics.information)} hint="Talked, still open" tone="text-sky-700" />
        <Metric href={listHref({ queue: "signing", q, range, funnel })} active={queue === "signing"} label="Finish signing" value={String(metrics.signing)} hint="Contract is out" tone="text-violet-700" />
        <Metric href={listHref({ queue: "signed", q, range, funnel: "closed" })} active={queue === "signed" && funnel === "closed"} label="Signed" value={String(metrics.signed)} hint="Signed in 30 days" tone="text-emerald-700" />
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Conversion</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-navy">{conversion}%</p>
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
                href={listHref({ queue: part.id, q, range, funnel: part.id === "signed" || part.id === "closed" ? "closed" : funnel })}
                title={`${part.label}: ${part.count}`}
                className={part.className}
                style={{ width: `${(part.count / Math.max(metrics.total, 1)) * 100}%` }}
              />
            ) : null,
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-600">
          {pipeline.map((part) => (
            <Link key={part.id} href={listHref({ queue: part.id, q, range, funnel: part.id === "signed" || part.id === "closed" ? "closed" : funnel })} className="hover:text-slate-900">
              {part.label} ({part.count})
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Arrived</span>
        {RANGES.map((item) => (
          <Link
            key={item.id}
            href={listHref({ queue, view, q, range: item.id, funnel })}
            className={`rounded-full px-3 py-1 text-sm ${
              range === item.id ? "bg-brand text-navy" : "bg-white text-slate-700 ring-1 ring-slate-200"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Status</span>
        <Link
          href={listHref({ queue: queue === "signed" || queue === "closed" ? "all" : queue, view, q, range, funnel: "open" })}
          className={`rounded-full px-3 py-1 text-sm ${funnel === "open" ? "bg-brand text-navy" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}
        >
          Open
        </Link>
        <Link
          href={listHref({ queue, view, q, range, funnel: "closed" })}
          className={`rounded-full px-3 py-1 text-sm ${funnel === "closed" ? "bg-brand text-navy" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}
        >
          Closed
        </Link>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Link
          href={listHref({ queue: "nonleads", view, q, range, funnel })}
          className={`rounded-full px-3 py-1 text-sm ${
            queue === "nonleads" ? "bg-brand text-navy" : "bg-white text-slate-700 ring-1 ring-slate-200"
          }`}
        >
          Non-leads{reviewCount.count ? ` (${reviewCount.count})` : ""}
        </Link>
        <span className="text-xs text-slate-500">
          Spam, vendors, employment, existing clients, insurance, other law offices, wrong numbers, and return calls. A legal question outside personal injury stays open until someone confirms the decline.
        </span>
      </div>

      <WorkQueue rows={queueRows} initialId={selectedId} />

      <p className="mt-4 flex flex-wrap gap-3 text-xs text-slate-500">
        <span>Also</span>
        {LEGACY.map((item) => (
          <Link key={item.id} href={listHref({ view: item.id, q, range, funnel })} className={view === item.id ? "font-medium text-slate-900" : "hover:text-slate-900"}>
            {item.label}
          </Link>
        ))}
        {view !== "all" ? (
          <Link href={listHref({ queue, q, range, funnel })} className="hover:text-slate-900">
            Clear that filter
          </Link>
        ) : null}
      </p>
    </main>
  );
}

function dayOneFor(
  lead: ListLead,
  input: {
    closed: boolean;
    talked: boolean;
    kind: string | null;
    agreementStatus: string | null;
    agreementSentAt: string | null;
    signedCase?: boolean | null;
  },
): string | null {
  const sequence = leadSequenceId(input);
  if (!sequence) return lead.created_at;
  return sequenceDayOne(sequence, lead).toISOString();
}

function stepsForLead(
  steps: (CallStep & { sequence: string })[],
  lead: {
    closed: boolean;
    talked: boolean;
    kind: string | null;
    agreementStatus: string | null;
    agreementSentAt: string | null;
    signedCase?: boolean | null;
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
    <Link href={href} className={`rounded-xl border bg-white px-4 py-3 ${active ? "border-brand" : "border-slate-200 hover:border-slate-300"}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{value}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </Link>
  );
}
