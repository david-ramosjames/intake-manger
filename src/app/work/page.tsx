import Link from "next/link";
import { QueueHelp } from "@/components/QueueHelp";
import { WorkArrivedPills, WorkFilterLink, WorkFilterState, WorkMetric, WorkSearch, WorkStatusPills } from "@/components/WorkFilters";
import { WorkListFilters } from "@/components/WorkListFilters";
import { WorkQueue, type QueueRow } from "@/components/WorkQueue";
import { loadLeadCallJobs } from "@/lib/call-grade";
import { leadEntry, loadStaffTouchedIds } from "@/lib/lead-entry";
import { loadStaff, suggestClientName } from "@/lib/identity";
import { isPlaceholderOwner } from "@/lib/talked-with";
import { consultationWhen, consultedChoice, contractOutstanding, contractSent, desiredWord, milestoneDesired, milestoneQualified, milestoneSigned, signatureNeedsConfirm } from "@/lib/desired";
import { daysSince, isLeadView, isSourceType, leadTitle, listAccident, listDetail, officialCaseType, slackMessageUrl, suggestedCaseType, type Lead, type LeadView } from "@/lib/leads";
import { CYCLE_LABEL, leadCycle, leadStatusLabel, openLeadAction, outreachSequence, PRIORITY_PLACE_LABEL, priorityPlace, queueStageLabel, queueStep } from "@/lib/next-step";
import { DATA_ERROR_CLASS, EXCLUDED_CALLER_CLASSES, isWorkLead } from "@/lib/caller-class";
import { signedFileReady } from "@/lib/close-ready";
import { isLostLeadReason, visibleCloseSuggestion } from "@/lib/funnel";
import { automationLine, isQueue, needsAttention, receivedLabel, stageClass, stageStripe, waitingTooLong, type QueueId } from "@/lib/queue";
import { nextActionLines, nextActionMoment, type CallStep } from "@/lib/next-action";
import { sequenceDayOne } from "@/lib/followup";
import { leadSequenceId } from "@/lib/sequences";
import { phoneLikePattern, phoneTail } from "@/lib/phone";
import { isPracticeTestPhone } from "@/lib/test-phone";
import { chicagoDay, formatCallDay, formatCallWhen, formatQueueStamp } from "@/lib/time";
import { requireStaff } from "@/lib/session";
import { DASHBOARD_RELEASE_DAY, loadNavTiles, type QueueFocus } from "@/lib/dashboard";
import { DEFAULT_REFERRAL_SMS, type ReferralDestination } from "@/lib/referrals";
import { docketBaseUrl } from "@/lib/supabase/config";

type HistoryTouch = {
  lead_id: string | null;
  phone: string | null;
  phone_e164?: string | null;
  type: string | null;
  direction: string | null;
  occurred_at: string | null;
  quo_link: string | null;
  slack_permalink: string | null;
};

type QueueActivity = {
  lead_id: string;
  calls: number | string | null;
  texts: number | string | null;
  talked: boolean | null;
  called_out: boolean | null;
  last_at: string | null;
  quo_link: string | null;
  slack_permalink: string | null;
  phone_last_at: string | null;
  phone_quo_link: string | null;
  phone_slack_permalink: string | null;
};

type PendingJob = {
  id: string | null;
  lead_id: string | null;
  due_at: string | null;
  queue: string | null;
  assigned_name: string | null;
  position: number | null;
};

function recentCutoff(): string {
  const [year, month, day] = chicagoDay(new Date()).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 30)).toISOString().slice(0, 10);
}

/** Header counts stay inside the last 30 days, and never reach back before the release. */
function metricStartDay(): string {
  const rolling = recentCutoff();
  return rolling > DASHBOARD_RELEASE_DAY ? rolling : DASHBOARD_RELEASE_DAY;
}

function leadMetricDay(lead: { lead_date: string | null; created_at: string | null }): string {
  return (lead.lead_date || lead.created_at || "").slice(0, 10);
}

function phoneKey(value: string | null | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

function combineByPhone<T extends { lead: ListLead; cycle: string; age: number | null; inWindow: boolean }>(
  input: T[],
  metricStart: string,
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
      const rank = (item: T) => {
        if (item.lead.signed_case || item.lead.case_id || item.cycle === "signed") return 0;
        if (item.cycle === "closed") return 4;
        if (item.lead.caller_class === "non_pi" || item.lead.close_suggestion) return 3;
        if (item.lead.consultation_date || item.lead.agreement_sent_at || item.lead.desired_case) return 1;
        return 2;
      };
      const byRank = rank(a) - rank(b);
      if (byRank) return byRank;
      const aStamp = a.lead.lead_date ?? a.lead.created_at ?? "";
      const bStamp = b.lead.lead_date ?? b.lead.created_at ?? "";
      return bStamp.localeCompare(aStamp);
    });
    const [keeper, ...others] = sorted;
    const age = group.reduce<number | null>((newest, item) => (item.age != null && (newest == null || item.age < newest) ? item.age : newest), null);
    const newestDay = group.reduce((best, item) => {
      const day = leadMetricDay(item.lead);
      return day > best ? day : best;
    }, "");
    return { row: { ...keeper, age, inWindow: Boolean(newestDay) && newestDay >= metricStart }, others };
  });
}

function countsAsContact(type: string): boolean {
  return type === "call" || type === "sona_call" || type === "text" || type === "voicemail";
}

async function eachSlice<T>(ids: string[], size: number, run: (slice: string[]) => Promise<T[]>): Promise<T[]> {
  const slices: string[][] = [];
  for (let index = 0; index < ids.length; index += size) slices.push(ids.slice(index, index + size));
  const batches = await Promise.all(slices.map(run));
  return batches.flat();
}

async function loadTouches(
  supabase: Awaited<ReturnType<typeof requireStaff>>["supabase"],
  ids: string[],
): Promise<HistoryTouch[]> {
  const page = 1000;
  return eachSlice(ids, 80, async (slice) => {
    const rows: HistoryTouch[] = [];
    for (let from = 0; from < 20000; from += page) {
      const { data } = await supabase
        .from("intake_interactions")
        .select("lead_id, phone, type, direction, occurred_at, quo_link, slack_permalink")
        .in("lead_id", slice)
        .order("occurred_at", { ascending: false })
        .range(from, from + page - 1);
      const batch = (data ?? []) as HistoryTouch[];
      rows.push(...batch);
      if (batch.length < page) break;
    }
    return rows;
  });
}

async function loadTouchesByPhone(
  supabase: Awaited<ReturnType<typeof requireStaff>>["supabase"],
  phones: string[],
): Promise<HistoryTouch[]> {
  if (!phones.length) return [];
  const page = 1000;
  return eachSlice(phones, 80, async (group) => {
    const slice = group.map((phone) => `+1${phone}`);
    const rows: HistoryTouch[] = [];
    for (let from = 0; from < 20000; from += page) {
      const { data } = await supabase
        .from("intake_interactions")
        .select("lead_id, phone, phone_e164, type, direction, occurred_at, quo_link, slack_permalink")
        .in("phone_e164", slice)
        .order("occurred_at", { ascending: false })
        .range(from, from + page - 1);
      const batch = (data ?? []) as HistoryTouch[];
      rows.push(...batch);
      if (batch.length < page) break;
    }
    return rows;
  });
}

async function loadPendingJobs(
  supabase: Awaited<ReturnType<typeof requireStaff>>["supabase"],
  ids: Set<string>,
): Promise<PendingJob[]> {
  if (!ids.size) return [];
  const leadIds = [...ids];
  return eachSlice(leadIds, 100, async (slice) => {
    const { data } = await supabase
      .from("lead_jobs")
      .select("id, lead_id, due_at, queue, assigned_name, position")
      .eq("status", "pending")
      .in("lead_id", slice);
    return (data ?? []) as PendingJob[];
  });
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

const LEGACY: { id: LeadView; label: string }[] = [
  { id: "pursue", label: "Want to sign" },
  { id: "needs_info", label: "Follow up Contact" },
  { id: "promoted", label: "Promoted" },
  { id: "verify", label: "Needs verification" },
];

const LIST_COLUMNS =
  "id, lead_date, created_at, lead_name, phone, phone_e164, email, identity_status, identity_evidence, lead_source, source_type, source_category, source_channel, source_note, case_type, case_detail, grade, arrival, lead_status, close_reason, close_suggestion, caller_class, practice_area, referral_opportunity, priority, priority_reason, priority_suggestion, next_action, callrail_tags, decline_reason, consultation, consultation_date, desired_case, desired_source, qualified, agreement_status, agreement_sent_at, agreement_signing_url, agreement_next_reminder_at, agreement_reminder_count, agreement_via_sms, agreement_via_email, text_sequence_status, text_sequence_slug, text_next_at, summary, owner_name, kind, sequence, follow_up, needs_verification, signed_case, date_signed, signed_at, case_id, case_number, intake_call_id, callrail_call_id, quo_link, slack_permalink, slack_channel_id, slack_message_ts, slack_thread_ts";

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
  | "identity_evidence"
  | "lead_source"
  | "source_channel"
  | "source_type"
  | "source_category"
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
  | "consultation"
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

function listHref(input: {
  queue?: QueueId;
  view?: LeadView;
  q?: string;
  lead?: string;
  range?: LeadRange;
  funnel?: Funnel;
  focus?: QueueFocus;
  grade?: string;
  priority?: string;
  screen?: string;
  intake?: string;
  sourceType?: string;
  leadSource?: string;
  entry?: string;
}): string {
  const params = new URLSearchParams();
  if (input.funnel === "closed") params.set("funnel", "closed");
  if (input.focus && input.focus !== "open") params.set("focus", input.focus);
  if (input.queue && input.queue !== "all") params.set("queue", input.queue);
  if (input.view && input.view !== "all") params.set("view", input.view);
  if (input.range && input.range !== "all") params.set("range", input.range);
  if (input.q) params.set("q", input.q);
  if (input.lead) params.set("lead", input.lead);
  if (input.grade) params.set("grade", input.grade);
  if (input.priority) params.set("priority", input.priority);
  if (input.screen) params.set("screen", input.screen);
  if (input.intake) params.set("intake", input.intake);
  if (input.sourceType) params.set("sourceType", input.sourceType);
  if (input.leadSource) params.set("leadSource", input.leadSource);
  if (input.funnel !== "closed" && (input.entry === "New" || input.entry === "In Progress")) params.set("entry", input.entry);
  const query = params.toString();
  return query ? `/work?${query}` : "/work";
}

const SIGNED_FILE_FLOOR = "2026-10-23T05:00:00.000Z";

function signedFileStillOpen(lead: ListLead): boolean {
  if (lead.case_id || lead.lead_status === "Promoted" || lead.lead_status === "Lost" || lead.lead_status === "Referred") return false;
  if (!lead.signed_case && lead.lead_status !== "Signed") return false;
  if ((lead.created_at || "") < SIGNED_FILE_FLOOR) return false;
  return !signedFileReady(lead);
}

async function loadOpenWorkLeads(
  supabase: Awaited<ReturnType<typeof requireStaff>>["supabase"],
): Promise<{ data: ListLead[]; error: null }> {
  const rows: ListLead[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("leads")
      .select(LIST_COLUMNS)
      .eq("test", false)
      .or("caller_class.is.null,caller_class.eq.non_pi")
      .not("lead_status", "in", "(Signed,Promoted,Lost,Referred)")
      .eq("signed_case", false)
      .is("case_id", null)
      .order("lead_date", { ascending: false, nullsFirst: false })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as ListLead[];
    rows.push(...batch);
    if (batch.length < 1000) break;
  }
  const { data: signedRows, error: signedError } = await supabase
    .from("leads")
    .select(LIST_COLUMNS)
    .eq("test", false)
    .or("caller_class.is.null,caller_class.eq.non_pi")
    .or("signed_case.eq.true,lead_status.eq.Signed")
    .is("case_id", null)
    .not("lead_status", "in", "(Promoted,Lost,Referred)")
    .gte("created_at", SIGNED_FILE_FLOOR)
    .order("lead_date", { ascending: false, nullsFirst: false })
    .limit(200);
  if (signedError) throw new Error(signedError.message);
  const seen = new Set(rows.map((lead) => lead.id));
  for (const lead of (signedRows ?? []) as ListLead[]) {
    if (seen.has(lead.id) || !signedFileStillOpen(lead)) continue;
    rows.push(lead);
  }
  return { data: rows, error: null };
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
      .eq("test", false)
      .or(`phone_e164.ilike.%${digits}%,phone.ilike.%${digits}%,phone.ilike.%${pattern}%`)
      .limit(40);
    return (matches ?? []) as ListLead[];
  }
  if (safe.length >= 2 && digits.length < 7) {
    const { data: matches } = await supabase
      .from("leads")
      .select(LIST_COLUMNS)
      .eq("test", false)
      .or(`lead_name.ilike.%${safe}%,email.ilike.%${safe}%,case_number.ilike.%${safe}%`)
      .limit(40);
    return (matches ?? []) as ListLead[];
  }
  return [];
}

const FOCUS_LABEL: Record<QueueFocus, string> = {
  open: "Open leads",
  priority: "Open priority leads",
  desired: "Open desired cases",
  contact: "Leads that need contacted",
};

export default async function LeadListPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    view?: string;
    queue?: string;
    lead?: string;
    range?: string;
    funnel?: string;
    focus?: string;
    grade?: string;
    priority?: string;
    screen?: string;
    intake?: string;
    sourceType?: string;
    leadSource?: string;
    entry?: string;
  }>;
}) {
  const params = await searchParams;
  const focus: QueueFocus =
    params.focus === "priority" || params.focus === "desired" || params.focus === "contact" || params.focus === "open"
      ? params.focus
      : "open";
  const view: LeadView = isLeadView(params.view) ? params.view : "all";
  const funnel: Funnel = params.funnel === "closed" ? "closed" : "open";
  const requested = params.queue === "fresh" ? "contact" : params.queue;
  const queue: QueueId = isQueue(requested) ? requested : "all";
  const range: LeadRange = isLeadRange(params.range) ? params.range : "all";
  const q = (params.q ?? "").trim();
  const grade = (params.grade ?? "").trim();
  const priority = (params.priority ?? "").trim();
  const screen = (params.screen ?? "").trim();
  const intake = (params.intake ?? "").trim();
  const sourceType = (params.sourceType ?? "").trim();
  const leadSource = (params.leadSource ?? "").trim();
  const entry = params.entry === "New" || params.entry === "In Progress" ? params.entry : "";
  const selectedId = params.lead?.trim() || "";
  const { supabase, admin } = await requireStaff();
  const docket = docketBaseUrl();

  const focusIds = focus === "open" ? null : (await loadNavTiles(supabase)).ids[focus];
  const focusedLeads: ListLead[] = focusIds
    ? await eachSlice(focusIds, 100, async (slice) => {
        const { data: focusedRows, error: focusedError } = await supabase.from("leads").select(LIST_COLUMNS).in("id", slice);
        if (focusedError) throw new Error(focusedError.message);
        return (focusedRows ?? []) as ListLead[];
      })
    : [];
  const closedQuery = supabase
    .from("leads")
    .select(LIST_COLUMNS)
    .eq("test", false)
    .or("caller_class.is.null,caller_class.eq.non_pi")
    .or("lead_status.in.(Signed,Promoted,Lost,Referred),signed_case.eq.true,case_id.not.is.null")
    .order("lead_date", { ascending: false, nullsFirst: false })
    .limit(300);
  const since = metricStartDay();
  const [{ data, error }, reviewResult, reviewCount, signedCount, closedCount, desiredCount, { data: stepRows }, destinationResult, templateResult] = await Promise.all([
    focusIds ? Promise.resolve({ data: [] as ListLead[], error: null }) : funnel === "closed" ? closedQuery : loadOpenWorkLeads(supabase),
    queue === "nonleads"
      ? supabase
          .from("leads")
          .select(LIST_COLUMNS)
          .eq("test", false)
          .in("caller_class", ["spam", "vendor", "employment", "existing_client", "insurance", "other_law_office", "wrong_number", "return_call"])
          .order("lead_date", { ascending: false, nullsFirst: false })
          .limit(300)
      : Promise.resolve({ data: [] as ListLead[], error: null }),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("test", false)
      .in("caller_class", ["spam", "vendor", "employment", "existing_client", "insurance", "other_law_office", "wrong_number", "return_call"]),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("test", false)
      .or("caller_class.is.null,caller_class.eq.non_pi")
      .or("signed_case.eq.true,lead_status.eq.Signed")
      .gte("lead_date", since),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("test", false)
      .or("caller_class.is.null,caller_class.eq.non_pi")
      .in("lead_status", ["Lost", "Referred", "Promoted"])
      .eq("signed_case", false)
      .gte("lead_date", since),
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("test", false)
      .or("caller_class.is.null,caller_class.eq.non_pi")
      .gte("lead_date", since)
      .or('desired_case.eq.true,agreement_sent_at.not.is.null,agreement_status.in.(sent,viewed,signed,completed),signed_case.eq.true,lead_status.eq.Signed,callrail_tags.cs.{"CVR DESIRED"}'),
    supabase.from("sequence_steps").select("sequence, position, delay_minutes, callback_window").eq("queue", "call").order("position"),
    supabase
      .from("referral_destinations")
      .select("id, name, phone, practice_areas, address, email, website, spanish, matters, notes, active")
      .eq("active", true)
      .order("name"),
    supabase.from("referral_templates").select("language, body"),
  ]);
  let workLeads = focusIds ? focusedLeads : ((data ?? []) as ListLead[]);
  if (funnel === "closed") workLeads = workLeads.filter((lead) => !signedFileStillOpen(lead));
  const reviewLeads = (reviewResult.data ?? []) as ListLead[];
  const needsPractice = funnel !== "closed" && !workLeads.some((lead) => isPracticeTestPhone(lead.phone_e164 || lead.phone));
  const [practiceRows, searched, selectedRows] = await Promise.all([
    needsPractice
      ? supabase.from("leads").select(LIST_COLUMNS).eq("test", false).eq("phone_e164", "+17654183805").limit(1)
      : Promise.resolve({ data: [] as ListLead[] }),
    searchLeads(supabase, q),
    selectedId
      ? supabase.from("leads").select(LIST_COLUMNS).eq("id", selectedId).limit(1)
      : Promise.resolve({ data: [] as ListLead[] }),
  ]);
  const practice = (practiceRows.data?.[0] ?? undefined) as ListLead | undefined;
  if (practice) workLeads = [...workLeads, practice];
  const merged = new Map<string, ListLead>();
  for (const lead of [...searched, ...workLeads, ...(queue === "nonleads" ? reviewLeads : [])]) {
    merged.set(lead.id, lead);
  }
  const selected = (selectedRows.data?.[0] ?? undefined) as ListLead | undefined;
  if (selected) merged.set(selected.id, selected);
  const leads = [...merged.values()];
  const destinations = ((destinationResult.data ?? []) as ReferralDestination[]).map((destination) => ({
    ...destination,
    practice_areas: destination.practice_areas ?? [],
    active: destination.active !== false,
    spanish: Boolean(destination.spanish),
  }));
  const templateRows = (templateResult.data ?? []) as { language: string; body: string }[];
  const referralTemplates = {
    en: templateRows.find((row) => row.language === "en")?.body || DEFAULT_REFERRAL_SMS.en,
    es: templateRows.find((row) => row.language === "es")?.body || DEFAULT_REFERRAL_SMS.es,
  };
  const firmName = new Map(destinations.map((destination) => [destination.id, destination.name]));
  const sentFirm = new Map<string, string>();
  const callSteps = (stepRows ?? []) as (CallStep & { sequence: string })[];
  const leadIds = leads.map((lead) => lead.id);
  const idSet = new Set(leadIds);

  const talked = new Set<string>();
  const calledOut = new Set<string>();
  const callWaiting = new Set<string>();
  const contact = new Map<string, { calls: number; texts: number }>();
  const nextCall = new Map<string, { id: string; dueAt: string; tag: string | null; position: number }>();
  const nextText = new Map<string, { id: string; dueAt: string }>();
  const lastOutreach = new Map<string, string>();
  const outsideLinks = new Map<string, { quo: string | null; slack: string | null }>();
  const rememberLinks = (leadId: string, touch: HistoryTouch) => {
    const current = outsideLinks.get(leadId) ?? { quo: null, slack: null };
    if (!current.quo && touch.quo_link) current.quo = touch.quo_link;
    if (!current.slack && touch.slack_permalink) current.slack = touch.slack_permalink;
    outsideLinks.set(leadId, current);
  };
  const idsByPhone = new Map<string, string[]>();
  for (const lead of leads) {
    const key = phoneKey(lead.phone);
    if (!key) continue;
    const list = idsByPhone.get(key) ?? [];
    list.push(lead.id);
    idsByPhone.set(key, list);
  }
  const [staff, sendResult, activity, calls, callJobs, staffTouched] = await Promise.all([
    loadStaff(supabase),
    leadIds.length
      ? eachSlice(leadIds, 100, async (slice) => {
          const { data } = await supabase
            .from("referral_sends")
            .select("lead_id, destination_id, attorney_name, created_at")
            .in("lead_id", slice);
          return (data ?? []) as { lead_id: string; destination_id: string | null; attorney_name: string | null; created_at: string }[];
        }).then((rows) => ({ data: rows, error: null }))
      : Promise.resolve({ data: [] as { lead_id: string; destination_id: string | null; attorney_name: string | null; created_at: string }[], error: null }),
    leadIds.length ? supabase.rpc("work_queue_activity", { lead_ids: leadIds }) : Promise.resolve({ data: [] as QueueActivity[], error: null }),
    loadPendingJobs(supabase, idSet),
    loadLeadCallJobs(supabase, leadIds),
    loadStaffTouchedIds(supabase, leadIds),
  ]);
  const sendRows = (sendResult.data ?? []) as { lead_id: string; destination_id: string | null; attorney_name: string | null; created_at: string }[];
  sendRows.sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const send of sendRows) sentFirm.set(send.lead_id, (send.destination_id ? firmName.get(send.destination_id) : "") || send.attorney_name || "");

  if (leadIds.length && !activity.error) {
    const activityRows = (activity.data ?? []) as QueueActivity[];
    for (const row of activityRows) {
      const callCount = Number(row.calls) || 0;
      const textCount = Number(row.texts) || 0;
      if (callCount || textCount) contact.set(row.lead_id, { calls: callCount, texts: textCount });
      if (row.talked) talked.add(row.lead_id);
      if (row.called_out) calledOut.add(row.lead_id);
      if (row.last_at) lastOutreach.set(row.lead_id, row.last_at);
      if (row.quo_link || row.slack_permalink) outsideLinks.set(row.lead_id, { quo: row.quo_link, slack: row.slack_permalink });
    }
    for (const lead of leads) {
      if (lastOutreach.has(lead.id)) continue;
      if (lead.arrival !== "human_call" && lead.arrival !== "qualified_call" && lead.arrival !== "sona") continue;
      if (!lead.created_at) continue;
      lastOutreach.set(lead.id, lead.created_at);
      const tally = contact.get(lead.id) ?? { calls: 0, texts: 0 };
      if (tally.calls === 0) tally.calls = 1;
      contact.set(lead.id, tally);
    }
    for (const row of activityRows) {
      if (row.phone_last_at) {
        const current = lastOutreach.get(row.lead_id);
        if (!current || row.phone_last_at > current) lastOutreach.set(row.lead_id, row.phone_last_at);
      }
      if (!row.phone_quo_link && !row.phone_slack_permalink) continue;
      const current = outsideLinks.get(row.lead_id) ?? { quo: null, slack: null };
      if (!current.quo && row.phone_quo_link) current.quo = row.phone_quo_link;
      if (!current.slack && row.phone_slack_permalink) current.slack = row.phone_slack_permalink;
      outsideLinks.set(row.lead_id, current);
    }
  } else if (leadIds.length) {
    const touches = await loadTouches(supabase, leadIds);
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
        if (type === "call" && direction === "outbound") calledOut.add(leadId);
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
    for (const lead of leads) {
      if (lastOutreach.has(lead.id)) continue;
      if (lead.arrival !== "human_call" && lead.arrival !== "qualified_call" && lead.arrival !== "sona") continue;
      if (!lead.created_at) continue;
      lastOutreach.set(lead.id, lead.created_at);
      const tally = contact.get(lead.id) ?? { calls: 0, texts: 0 };
      if (tally.calls === 0) tally.calls = 1;
      contact.set(lead.id, tally);
    }
    for (const touch of await loadTouchesByPhone(supabase, missingPhones)) {
      if (touch.lead_id && idSet.has(touch.lead_id)) continue;
      const type = String(touch.type || "").toLowerCase();
      if (!touch.occurred_at || !countsAsContact(type)) continue;
      for (const leadId of idsByPhone.get(phoneKey(touch.phone) || phoneKey(touch.phone_e164)) ?? []) {
        const current = lastOutreach.get(leadId);
        if (!current || touch.occurred_at > current) lastOutreach.set(leadId, touch.occurred_at);
        rememberLinks(leadId, touch);
      }
    }
  }
  for (const job of calls) {
      if (!job.lead_id || !job.due_at || !job.id) continue;
      if (job.queue === "text") {
        const current = nextText.get(job.lead_id);
        if (!current || job.due_at < current.dueAt) nextText.set(job.lead_id, { id: job.id, dueAt: job.due_at });
        continue;
      }
      if (job.queue !== "call") continue;
      callWaiting.add(job.lead_id);
      // Keep overdue pending jobs too — they still need Call time / Slack tag editors.
      const position = typeof job.position === "number" ? job.position : Number.MAX_SAFE_INTEGER;
      const current = nextCall.get(job.lead_id);
      const jobFuture = new Date(job.due_at).getTime() > Date.now();
      const currentFuture = current ? new Date(current.dueAt).getTime() > Date.now() : false;
      const better =
        !current ||
        (jobFuture && !currentFuture) ||
        (jobFuture === currentFuture && (position < current.position || (position === current.position && job.due_at < current.dueAt)));
      if (better) nextCall.set(job.lead_id, { id: job.id, dueAt: job.due_at, tag: job.assigned_name, position });
  }



  const rows = leads.map((lead) => {
    const cycle = leadCycle(lead, talked.has(lead.id) ? [{ type: "call", direction: "inbound" }] : []);
    const age = daysSince(lead.lead_date ?? lead.created_at);
    const outreachAt = lastOutreach.get(lead.id);
    const outreach = daysSince(outreachAt);
    const pendingCall = nextCall.get(lead.id);
    // Only future dues drive "next at" / waiting; overdue jobs still expose callJobId for editing.
    const nextAt = pendingCall && new Date(pendingCall.dueAt).getTime() > Date.now() ? pendingCall.dueAt : null;
    const tally = contact.get(lead.id) ?? { calls: 0, texts: 0 };
    const waiting = waitingTooLong(cycle, age, outreach, nextAt ?? undefined);
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
      inWindow: leadMetricDay(lead) >= since,
      label: queueStageLabel(lead, leadStatusLabel(lead, cycle)),
      step: queueStep(lead, cycle, tally.calls),
      actionTitle: openLeadAction(lead, cycle, tally.calls),
      accident: listAccident(lead),
      priority: priorityPlace(lead),
    };
  });

  const badCall = new Set<string>(EXCLUDED_CALLER_CLASSES);
  const workRows = rows.filter((row) => isWorkLead(row.lead));
  const listed = queue === "nonleads"
    ? rows.filter((row) => badCall.has(row.lead.caller_class ?? ""))
    : rows.filter((row) => isWorkLead(row.lead) || (q.length > 0 && row.lead.caller_class === DATA_ERROR_CLASS));
  const combined = combineByPhone(listed, since);
  const windowRows = combineByPhone(workRows, since).filter((group) => group.row.inWindow);
  const metrics = {
    contact: windowRows.filter((group) => group.row.cycle === "contact").length,
    information: windowRows.filter((group) => group.row.cycle === "information").length,
    signing: windowRows.filter((group) => group.row.cycle === "signing").length,
    attention: windowRows.filter((group) => group.row.attention).length,
    signed: funnel === "open" ? (signedCount.count ?? 0) : windowRows.filter((group) => group.row.cycle === "signed").length,
    closed: funnel === "open" ? (closedCount.count ?? 0) : windowRows.filter((group) => group.row.cycle === "closed").length,
    total: funnel === "open" ? windowRows.length + (signedCount.count ?? 0) : windowRows.length,
  };
  if (desiredCount.error) throw new Error(desiredCount.error.message);
  const desired = desiredCount.count ?? 0;
  const conversion = desired ? Math.round((metrics.signed / desired) * 100) : 0;

  const shown = combined
    .filter((group) => {
      if (focus === "priority") return Boolean(priorityPlace(group.row.lead));
      if (focus === "desired") return milestoneDesired(group.row.lead) === true;
      if (focus === "contact") return callWaiting.has(group.row.lead.id) && !calledOut.has(group.row.lead.id);
      return true;
    })
    .filter((group) => matchesLegacy(view, group.row.lead))
    .sort((a, b) => (a.row.lead.id < b.row.lead.id ? -1 : a.row.lead.id > b.row.lead.id ? 1 : 0));
  if (selectedId && !shown.some((group) => group.row.lead.id === selectedId || group.others.some((other) => other.lead.id === selectedId))) {
    const extra = combined.find((group) => group.row.lead.id === selectedId || group.others.some((other) => other.lead.id === selectedId));
    if (extra) shown.unshift(extra);
  }

  const queueRows: QueueRow[] = shown.map(({ row, others }) => {
    const automation = automationLine(row.lead);
    const nextAction = nextActionLines({
      closed: !isPracticeTestPhone(row.lead.phone_e164 || row.lead.phone) && (row.cycle === "signed" || row.cycle === "closed"),
      sequence: row.lead.sequence,
      textStatus: row.lead.text_sequence_status,
      textNextAt: row.lead.text_next_at,
      reminderAt: row.lead.agreement_next_reminder_at,
      agreementStatus: row.lead.agreement_status,
      callStart: dayOneFor(row.lead, {
        closed: !isPracticeTestPhone(row.lead.phone_e164 || row.lead.phone) && (row.cycle === "signed" || row.cycle === "closed"),
        talked: row.cycle !== "contact",
        kind: row.lead.kind,
        agreementStatus: row.lead.agreement_status,
        agreementSentAt: row.lead.agreement_sent_at,
        signedCase: row.lead.signed_case,
      }),
      callsMade: row.tally.calls,
      pendingCallAt: row.nextAt ?? null,
      callSteps: stepsForLead(callSteps, {
        closed: !isPracticeTestPhone(row.lead.phone_e164 || row.lead.phone) && (row.cycle === "signed" || row.cycle === "closed"),
        talked: row.cycle !== "contact",
        kind: row.lead.kind,
        agreementStatus: row.lead.agreement_status,
        agreementSentAt: row.lead.agreement_sent_at,
        signedCase: row.lead.signed_case,
      }),
      priority: row.priority === "contract" || row.priority === "flagged",
      contactAt: row.lead.created_at,
      leadId: row.lead.id,
    });
    const nextActionAt = nextActionMoment(nextAction);
    return {
      id: row.lead.id,
      title: leadTitle(row.lead),
      samePhone: others.map((other) => ({
        id: other.lead.id,
        title: leadTitle(other.lead),
        label: other.label,
      })),
      closeSuggestion: visibleCloseSuggestion(row.lead),
      identityStatus: row.lead.identity_status,
      identityEvidence: row.lead.identity_evidence,
      suggestedName: suggestClientName(row.lead.summary, staff),
      accident: row.accident,
      when: receivedLabel(row.age),
      priority: row.priority ? PRIORITY_PLACE_LABEL[row.priority] : null,
      openedLabel: formatQueueStamp(row.lead.created_at || row.lead.lead_date).label,
      openedKey: formatQueueStamp(row.lead.created_at || row.lead.lead_date).key,
      consulted: consultedChoice(row.lead),
      signedDate: (row.lead.date_signed || row.lead.signed_at || "").slice(0, 10),
      prioritySuggestion: row.lead.priority_suggestion,
      actionTitle: row.actionTitle,
      label: row.label,
      caseType: suggestedCaseType(row.lead),
      leadSource: row.lead.lead_source?.trim() || (listDetail(row.lead) === "—" ? "" : listDetail(row.lead)),
      sourceType: isSourceType(row.lead.source_type) ? row.lead.source_type : "",
      sourceCategory: row.lead.source_category?.trim() || "",
      stageClassName: stageClass(row.label),
      stageStripe: stageStripe(row.label),
      step: row.step,
      tags: row.lead.callrail_tags ?? [],
      callrail: Boolean(row.lead.callrail_call_id),
      declineReason: row.lead.decline_reason,
      qualifiedLabel: desiredWord(milestoneQualified(row.lead)),
      consultWhen: consultationWhen(row.lead.consultation_date),
      desired: desiredWord(milestoneDesired(row.lead)),
      desiredLocked: contractSent(row.lead) || milestoneSigned(row.lead) || milestoneQualified(row.lead) === false,
      signed: milestoneSigned(row.lead),
      lostReason: row.lead.lead_status === "Lost" && isLostLeadReason(row.lead.close_reason) ? row.lead.close_reason : null,
      nonPi: officialCaseType(row.lead.case_type) === "Non-PI Legal Matter",
      practiceArea: row.lead.practice_area,
      referralSent: sentFirm.has(row.lead.id) || row.lead.lead_status === "Referred" || row.lead.close_reason === "referred",
      referralFirm: sentFirm.get(row.lead.id) || null,
      callerClass: row.lead.caller_class,
      confirmSigned: signatureNeedsConfirm(row.lead),
      lastLabel: lastContacted(row.outreach),
      lastDays: row.outreach,
      consultKey: row.lead.consultation_date ?? "",
      waiting: row.waiting,
      automationLabel: automation.label,
      automationBad: automation.bad,
      signingOn: contractOutstanding(row.lead),
      canStartText:
        (row.lead.text_sequence_status || "").toLowerCase() !== "active" &&
        Boolean(row.lead.phone_e164 || row.lead.phone) &&
        (isPracticeTestPhone(row.lead.phone_e164 || row.lead.phone) ||
          (!row.lead.signed_case &&
            !row.lead.case_id &&
            row.lead.lead_status !== "Lost" &&
            row.lead.lead_status !== "Referred" &&
            row.lead.lead_status !== "Promoted" &&
            row.lead.lead_status !== "Signed" &&
            row.lead.sequence !== "stop")),
      quoUrl: row.lead.quo_link || outsideLinks.get(row.lead.id)?.quo || null,
      slackUrl: slackMessageUrl(row.lead) || outsideLinks.get(row.lead.id)?.slack || null,
      leadName: row.lead.lead_name?.trim() || "",
      phone: displayPhone(row.lead.phone),
      email: row.lead.email,
      caseNumber: row.lead.case_number,
      summary: row.lead.summary,
      owner: row.lead.owner_name,
      grade: row.lead.grade,
      screenBy: callJobs.get(row.lead.id)?.screenBy ?? null,
      intakeBy: callJobs.get(row.lead.id)?.intakeBy ?? null,
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
      age: row.age,
      cycle: row.cycle,
      attention: row.attention,
      nextCallLabel: formatCallWhen(row.nextAt),
      callJobId: nextCall.get(row.lead.id)?.id ?? null,
      callTag: slackTag(nextCall.get(row.lead.id)?.tag, row.lead.owner_name, row.lead.consultation_date),
      textJobId: nextText.get(row.lead.id)?.id ?? null,
      reminderAt: row.lead.agreement_next_reminder_at,
      nextAction,
      nextActionAt,
      nextDayKey: nextActionAt ? chicagoDay(nextActionAt) : "",
      nextDayLabel: formatCallDay(nextActionAt),
      entry: leadEntry({
        staffTouched: staffTouched.has(row.lead.id),
        grade: row.lead.grade,
        screenBy: callJobs.get(row.lead.id)?.screenBy ?? null,
        intakeBy: callJobs.get(row.lead.id)?.intakeBy ?? null,
      }),
    };
  });
  queueRows.sort((a, b) => {
    if (a.nextActionAt && b.nextActionAt && a.nextActionAt !== b.nextActionAt) return a.nextActionAt < b.nextActionAt ? -1 : 1;
    if (a.nextActionAt && !b.nextActionAt) return -1;
    if (!a.nextActionAt && b.nextActionAt) return 1;
    return a.title.localeCompare(b.title);
  });

  const href = (input: Parameters<typeof listHref>[0]) => listHref({ grade, priority, screen, intake, sourceType, leadSource, ...input });
  const instantStage = queue !== "nonleads";

  return (
    <WorkFilterState initial={{ grade, priority, screen, intake, sourceType, leadSource, q, range, queue, entry: funnel === "open" && queue !== "nonleads" ? entry : "" }}>
    <main className="w-full px-4 py-4 xl:px-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-navy">Work queue</h1>
          <QueueHelp />
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400" title={since > recentCutoff() ? "Where leads since the release are now. Signed cases from before the release are left out. Filtering the list below leaves these numbers in place." : "Where leads from the last 30 days are now. Filtering the list below leaves these numbers in place."}>
            {since > recentCutoff() ? "Since release" : "Last 30 days"}
          </span>
          <WorkMetric href={href({ queue: "contact", q, range, funnel, focus, entry })} active={queue === "contact"} label={CYCLE_LABEL.contact} value={String(metrics.contact)} tone="text-amber-700" instantQueue={instantStage ? "contact" : undefined} />
          <WorkMetric href={href({ queue: "information", q, range, funnel, focus, entry })} active={queue === "information"} label={CYCLE_LABEL.information} value={String(metrics.information)} tone="text-sky-700" instantQueue={instantStage ? "information" : undefined} />
          <WorkMetric href={href({ queue: "signing", q, range, funnel, focus, entry })} active={queue === "signing"} label="Finish signing" value={String(metrics.signing)} tone="text-violet-700" instantQueue={instantStage ? "signing" : undefined} />
          <WorkMetric href={href({ queue: "signed", q, range, funnel: "closed", focus })} active={queue === "signed" && funnel === "closed"} label="Signed" value={String(metrics.signed)} tone="text-emerald-700" instantQueue={funnel === "closed" ? "signed" : undefined} />
          <span className="flex items-baseline gap-1.5 px-1" title={since > recentCutoff() ? "Signed leads among desired cases since the release." : "Signed leads among desired cases from the last 30 days."}>
            <span className="text-lg font-semibold tabular-nums leading-none text-navy">{conversion}%</span>
            <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Of desired</span>
          </span>
          <WorkSearch />
        </div>
      </div>

      {focus !== "open" ? (
        <p className="mt-3 text-sm text-slate-700">
          Showing {FOCUS_LABEL[focus].toLowerCase()}.{" "}
          <Link href="/work" className="font-medium text-navy underline">
            All open leads
          </Link>
        </p>
      ) : null}

      {error ? <p className="mt-4 text-sm text-red-700">{error.message}</p> : null}

      <div className="mt-3 flex flex-nowrap items-center gap-x-1.5 text-sm">
        <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-slate-400">Arrived</span>
        <WorkArrivedPills />
        <span className="mx-0.5 h-4 w-px shrink-0 bg-slate-200" aria-hidden="true" />
        <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-slate-400">Status</span>
        <WorkStatusPills
          local={funnel === "open" && queue !== "nonleads"}
          closed={funnel === "closed"}
          nonLeads={queue === "nonleads"}
          nonLeadsCount={reviewCount.count ?? 0}
        />
        <div className="ml-auto flex shrink-0 flex-nowrap items-center gap-1.5 pl-2">
          <WorkListFilters rows={queueRows} />
        </div>
      </div>

      <WorkQueue
        rows={queueRows}
        initialId={selectedId}
        destinations={destinations}
        admin={admin}
        templates={referralTemplates}
        staff={staff.map((person) => person.name)}
      />

      <p className="mt-4 flex flex-wrap gap-3 text-xs text-slate-500">
        <span>Also</span>
        {LEGACY.map((item) => (
          <WorkFilterLink key={item.id} carryView href={href({ view: item.id, q, range, funnel, focus, entry })} className={view === item.id ? "font-medium text-slate-900" : "hover:text-slate-900"}>
            {item.label}
          </WorkFilterLink>
        ))}
        {view !== "all" ? (
          <Link href={href({ queue, q, range, funnel, focus })} className="hover:text-slate-900">
            Clear that filter
          </Link>
        ) : null}
      </p>
    </main>
    </WorkFilterState>
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

function slackTag(assigned: string | null | undefined, owner: string | null | undefined, consultationDate: string | null | undefined): string | null {
  if (!isPlaceholderOwner(assigned)) return assigned?.trim() || null;
  if (consultationDate && !isPlaceholderOwner(owner)) return owner?.trim() || null;
  return null;
}

function matchesLegacy(view: LeadView, lead: ListLead): boolean {
  if (view === "pursue" || view === "needs_info") return lead.kind === view;
  if (view === "open") {
    return isPracticeTestPhone(lead.phone_e164 || lead.phone) || (!lead.signed_case && !lead.case_id && lead.lead_status !== "Lost" && lead.lead_status !== "Referred");
  }
  if (view === "signed") return lead.signed_case && !lead.case_id;
  if (view === "promoted") return Boolean(lead.case_id);
  if (view === "verify") return lead.needs_verification;
  return true;
}

