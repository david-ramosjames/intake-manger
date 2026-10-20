import type { SupabaseClient } from "@supabase/supabase-js";
import { isWorkLead } from "@/lib/caller-class";
import { milestoneDesired, milestoneQualified, milestoneSigned } from "@/lib/desired";
import { averageCallGrade } from "@/lib/call-grade";
import { priorityPlace } from "@/lib/next-step";
import { phoneTail } from "@/lib/phone";
import { ANSWER_RATE_INBOXES, loadInboxAnswerRate } from "@/lib/inbox-calls";
import { isPracticeTestPhone } from "@/lib/test-phone";
import { chicagoDay, chicagoLocalToIso } from "@/lib/time";

export type QueueFocus = "open" | "priority" | "desired" | "contact";

export type NavTiles = {
  open: number;
  priority: number;
  desired: number;
  contact: number;
  ids: Record<Exclude<QueueFocus, "open">, string[]>;
};

type OpenLead = {
  id: string;
  phone: string | null;
  phone_e164: string | null;
  signed_case: boolean | null;
  lead_status: string | null;
  agreement_status: string | null;
  agreement_sent_at: string | null;
  agreement_reminder_count: number | null;
  agreement_next_reminder_at: string | null;
  case_id: string | null;
  priority: boolean | null;
  priority_suggestion: string | null;
  qualified: boolean | null;
  desired_case: boolean | null;
  desired_source: string | null;
  callrail_tags: string[] | null;
  caller_class: string | null;
};

const OPEN_COLUMNS =
  "id, phone, phone_e164, signed_case, lead_status, agreement_status, agreement_sent_at, agreement_reminder_count, agreement_next_reminder_at, case_id, priority, priority_suggestion, qualified, desired_case, desired_source, callrail_tags, caller_class";

export async function loadNavTiles(supabase: SupabaseClient): Promise<NavTiles> {
  const openLeads: OpenLead[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("leads")
      .select(OPEN_COLUMNS)
      .or("caller_class.is.null,caller_class.eq.non_pi")
      .not("lead_status", "in", "(Signed,Promoted,Lost,Referred)")
      .eq("signed_case", false)
      .is("case_id", null)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as OpenLead[];
    openLeads.push(...batch.filter((lead) => isWorkLead(lead)));
    if (batch.length < 1000) break;
  }

  const placed = openLeads.filter((lead) => priorityPlace(lead));
  const phones = [...new Set(placed.map((lead) => lead.phone).filter((phone): phone is string => Boolean(phone)))];
  const signedPhones = new Set<string>();
  for (let index = 0; index < phones.length; index += 80) {
    const { data, error } = await supabase
      .from("leads")
      .select("phone, phone_e164")
      .eq("signed_case", true)
      .in("phone", phones.slice(index, index + 80));
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const key = phoneTail(row.phone) || phoneTail(row.phone_e164);
      if (key.length >= 10) signedPhones.add(key);
    }
  }
  const priority = placed.filter((lead) => phoneTail(lead.phone).length < 10 || !signedPhones.has(phoneTail(lead.phone)));
  const desired = openLeads.filter((lead) => milestoneDesired(lead) === true);

  const openIds = new Set(openLeads.map((lead) => lead.id));
  const waiting = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("lead_jobs")
      .select("lead_id")
      .eq("queue", "call")
      .eq("status", "pending")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as { lead_id: string | null }[];
    for (const row of batch) {
      if (row.lead_id && openIds.has(row.lead_id)) waiting.add(row.lead_id);
    }
    if (batch.length < 1000) break;
  }
  const called = new Set<string>();
  const waitingIds = [...waiting];
  for (let index = 0; index < waitingIds.length; index += 80) {
    const { data, error } = await supabase
      .from("intake_interactions")
      .select("lead_id")
      .eq("type", "call")
      .eq("direction", "outbound")
      .in("lead_id", waitingIds.slice(index, index + 80));
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      if (row.lead_id) called.add(row.lead_id);
    }
  }
  const contact = waitingIds.filter((id) => !called.has(id));

  return {
    open: openLeads.length,
    priority: priority.length,
    desired: desired.length,
    contact: contact.length,
    ids: {
      priority: priority.map((lead) => lead.id),
      desired: desired.map((lead) => lead.id),
      contact,
    },
  };
}

export const PERIODS = [
  { id: "today", label: "Current day", hint: "Today" },
  { id: "yesterday", label: "Yesterday", hint: "The previous day" },
  { id: "l7", label: "L7", hint: "Last 7 days, including today" },
  { id: "l14", label: "L14", hint: "Last 14 days, including today" },
  { id: "l28", label: "L28", hint: "Last 28 days, including today" },
  { id: "mtd", label: "MTD", hint: "Month to date" },
  { id: "qtd", label: "QTD", hint: "Quarter to date" },
  { id: "ytd", label: "YTD", hint: "Year to date" },
] as const;

export type PeriodId = (typeof PERIODS)[number]["id"] | "custom";

export type ResolvedPeriod = {
  id: PeriodId;
  start: string;
  end: string;
  fromIso: string;
  toIso: string;
  label: string;
};

function isDay(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function addDays(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string): number {
  const [y1, m1, d1] = start.split("-").map(Number);
  const [y2, m2, d2] = end.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

export function formatPeriod(start: string, end: string): string {
  const format = (day: string) => {
    const [year, month, date] = day.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
      new Date(Date.UTC(year, month - 1, date)),
    );
  };
  return start === end ? format(start) : `${format(start)} – ${format(end)}`;
}

export function resolvePeriod(search: { period?: string; from?: string; to?: string }, now = new Date()): ResolvedPeriod {
  const today = chicagoDay(now);
  const requested = PERIODS.some((item) => item.id === search.period) || search.period === "custom" ? (search.period as PeriodId) : "l7";
  let id = requested;
  let start = today;
  let end = today;
  if (id === "yesterday") start = end = addDays(today, -1);
  else if (id === "l7") start = addDays(today, -6);
  else if (id === "l14") start = addDays(today, -13);
  else if (id === "l28") start = addDays(today, -27);
  else if (id === "mtd") start = `${today.slice(0, 8)}01`;
  else if (id === "qtd") {
    const month = Number(today.slice(5, 7));
    const quarterMonth = Math.floor((month - 1) / 3) * 3 + 1;
    start = `${today.slice(0, 4)}-${String(quarterMonth).padStart(2, "0")}-01`;
  } else if (id === "ytd") start = `${today.slice(0, 4)}-01-01`;
  else if (id === "custom") {
    if (isDay(search.from) && isDay(search.to)) {
      start = search.from <= search.to ? search.from : search.to;
      end = search.from <= search.to ? search.to : search.from;
    } else {
      id = "l7";
      start = addDays(today, -6);
    }
  }
  const fromIso = chicagoLocalToIso(`${start}T00:00`);
  const toIso = chicagoLocalToIso(`${addDays(end, 1)}T00:00`);
  return { id, start, end, fromIso, toIso, label: formatPeriod(start, end) };
}

type CohortLead = {
  id: string;
  lead_date: string | null;
  created_at: string | null;
  phone: string | null;
  phone_e164: string | null;
  case_type: string | null;
  grade: string | null;
  qualified: boolean | null;
  desired_case: boolean | null;
  desired_source: string | null;
  signed_case: boolean | null;
  date_signed: string | null;
  signed_at: string | null;
  lead_status: string | null;
  close_reason: string | null;
  caller_class: string | null;
  consultation_date: string | null;
  callrail_tags: string[] | null;
  agreement_status: string | null;
  agreement_sent_at: string | null;
  arrival: string | null;
  lead_source: string | null;
  summary: string | null;
};

const COHORT_COLUMNS =
  "id, lead_date, created_at, phone, phone_e164, case_type, grade, qualified, desired_case, desired_source, signed_case, date_signed, signed_at, lead_status, close_reason, caller_class, consultation_date, callrail_tags, agreement_status, agreement_sent_at, arrival, lead_source, summary";

export type RateMetric = {
  label: string;
  display: string;
  goal: string;
  detail: string;
  definition: string;
  tone: "met" | "short" | "open" | "empty";
};

export type CountMetric = {
  label: string;
  value: string;
  definition: string;
};

export type DashboardReport = {
  rates: RateMetric[];
  counts: CountMetric[];
};

function arrivalDay(lead: { lead_date: string | null; created_at: string | null }): string {
  if (lead.lead_date && /^\d{4}-\d{2}-\d{2}/.test(lead.lead_date)) return lead.lead_date.slice(0, 10);
  if (lead.created_at) return chicagoDay(lead.created_at);
  return "";
}

function percent(part: number, whole: number): number | null {
  if (!whole) return null;
  return Math.round((part / whole) * 1000) / 10;
}

function showPercent(value: number | null): string {
  if (value == null) return "—";
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`;
}

function higher(value: number | null, goal: number): RateMetric["tone"] {
  if (value == null) return "empty";
  return value >= goal ? "met" : "short";
}

function lower(value: number | null, goal: number): RateMetric["tone"] {
  if (value == null) return "empty";
  return value <= goal ? "met" : "short";
}

function statusWord(tone: RateMetric["tone"]): string {
  if (tone === "met") return "At goal";
  if (tone === "short") return "Short of goal";
  if (tone === "open") return "Target not set";
  return "Not enough recorded yet";
}

async function countInteractions(
  supabase: SupabaseClient,
  period: ResolvedPeriod,
  kind: "human" | "inbound" | "all",
): Promise<number> {
  let query = supabase
    .from("intake_interactions")
    .select("id", { count: "exact", head: true })
    .gte("occurred_at", period.fromIso)
    .lt("occurred_at", period.toIso);
  if (kind === "human") query = query.eq("type", "call").eq("direction", "inbound");
  else if (kind === "inbound") query = query.eq("direction", "inbound").in("type", ["call", "missed_call", "sona_call"]);
  else query = query.in("type", ["call", "missed_call", "sona_call"]);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function loadDashboardReport(supabase: SupabaseClient, period: ResolvedPeriod): Promise<DashboardReport> {
  const { data, error } = await supabase
    .from("leads")
    .select(COHORT_COLUMNS)
    .or(`and(created_at.gte."${period.fromIso}",created_at.lt."${period.toIso}"),and(lead_date.gte.${period.start},lead_date.lte.${period.end})`)
    .limit(2000);
  if (error) throw new Error(error.message);
  const cohort = ((data ?? []) as CohortLead[]).filter((lead) => {
    if (!isWorkLead(lead) || isPracticeTestPhone(lead.phone_e164 || lead.phone)) return false;
    const day = arrivalDay(lead);
    return day >= period.start && day <= period.end;
  });
  const cohortIds = cohort.map((lead) => lead.id);
  const desiredLeads = cohort.filter((lead) => milestoneDesired(lead) === true || milestoneSigned(lead));
  const desiredIds = new Set(desiredLeads.map((lead) => lead.id));
  const qualified = cohort.filter((lead) => milestoneQualified(lead) === true).length;
  const signedCohort = cohort.filter((lead) => milestoneSigned(lead)).length;
  const signedDesired = desiredLeads.filter((lead) => milestoneSigned(lead)).length;
  const referred = new Set<string>();
  for (const lead of cohort) {
    if (!desiredIds.has(lead.id) && (lead.lead_status === "Referred" || lead.close_reason === "referred")) referred.add(lead.id);
  }
  for (let index = 0; index < cohortIds.length; index += 80) {
    const slice = cohortIds.slice(index, index + 80);
    if (!slice.length) break;
    const { data: sends, error: sendError } = await supabase.from("referral_sends").select("lead_id").in("lead_id", slice);
    if (sendError) throw new Error(sendError.message);
    for (const row of sends ?? []) {
      if (row.lead_id && !desiredIds.has(row.lead_id)) referred.add(row.lead_id);
    }
  }
  const notDesired = cohort.length - desiredLeads.length;

  const oldIds = cohort
    .filter((lead) => {
      const day = arrivalDay(lead);
      return day && daysBetween(day, period.end) >= 16;
    })
    .map((lead) => lead.id);
  const connected = new Set<string>();
  for (let index = 0; index < oldIds.length; index += 80) {
    const slice = oldIds.slice(index, index + 80);
    if (!slice.length) break;
    const { data: calls, error: callError } = await supabase
      .from("intake_interactions")
      .select("lead_id")
      .eq("type", "call")
      .in("lead_id", slice);
    if (callError) throw new Error(callError.message);
    for (const row of calls ?? []) {
      if (row.lead_id) connected.add(row.lead_id);
    }
  }
  const never = oldIds.filter((id) => !connected.has(id)).length;

  const [callCount, inbox] = await Promise.all([
    countInteractions(supabase, period, "all"),
    loadInboxAnswerRate(supabase, period.fromIso, period.toIso),
  ]);

  const [speed, consults, signedInPeriod, callQuality] = await Promise.all([
    speedToLead(supabase, period, cohort),
    countConsults(supabase, period),
    countSigned(supabase, period),
    loadCallQuality(supabase, period),
  ]);

  const answer = percent(inbox.answered, inbox.incoming);
  const inboxPartial = Boolean(inbox.earliest && Date.parse(inbox.earliest) > Date.parse(period.fromIso) + 60 * 60 * 1000);
  const inboxLines = ANSWER_RATE_INBOXES.join(", ");
  const wanted = percent(signedDesired, desiredLeads.length);
  const referral = percent(referred.size, notDesired);
  const neverRate = percent(never, oldIds.length);
  const qualification = percent(qualified, cohort.length);
  const conversion = percent(signedCohort, cohort.length);
  const speedRate = percent(speed.met, speed.total);

  const answerTone = higher(answer, 90);
  const wantedTone = higher(wanted, 90);
  const referralTone = higher(referral, 95);
  const neverTone = lower(neverRate, 5);
  const qualificationTone = higher(qualification, 25);
  const conversionTone = higher(conversion, 10);
  const speedTone = higher(speedRate, 100);

  return {
    rates: [
      {
        label: "Answer rate",
        display: showPercent(answer),
        goal: "Goal > 90%",
        detail:
          answer == null
            ? inbox.earliest
              ? statusWord(answerTone)
              : "Inbox calls are still loading"
            : `${statusWord(answerTone)} · ${inbox.answered} of ${inbox.incoming} incoming calls${inboxPartial ? " · history is still filling for the start of this range" : ""}`,
        definition: `Answered by a person divided by incoming calls, on the same inboxes as the Call Stats email: ${inboxLines}. Extra Number, SA Law Firm, and Trucking Chicas are left out. Incoming calls on RJL Outbound are left out. A person answer is a completed incoming call that someone picked up. Sona, voicemail, missed calls, and forwards with nobody who picked up stay in the total.`,
        tone: answerTone,
      },
      {
        label: "Missed calls and form fills",
        display: showPercent(speedRate),
        goal: "Goal: contacted within 2 minutes",
        detail: speed.total ? `${statusWord(speedTone)} · ${speed.met} of ${speed.total} contacted in time` : statusWord(speedTone),
        definition:
          "Share of missed calls, Sona calls, and form fills contacted with an outbound call or text within 2 minutes. Form fills are Meta form, site form, web chat, and website leads. The clock starts when the call or form comes in. One with no outbound call or text stored counts as not contacted in time.",
        tone: speedTone,
      },
      {
        label: "Wanted conversion",
        display: showPercent(wanted),
        goal: "Goal 90%+",
        detail: wanted == null ? statusWord(wantedTone) : `${statusWord(wantedTone)} · ${signedDesired} of ${desiredLeads.length} desired`,
        definition: "Signed cases divided by desired cases, among leads that arrived in this period. A signed case counts as desired.",
        tone: wantedTone,
      },
      {
        label: "Declined referral rate",
        display: showPercent(referral),
        goal: "Goal 95%+",
        detail: referral == null ? statusWord(referralTone) : `${statusWord(referralTone)} · ${referred.size} of ${notDesired} not desired`,
        definition:
          "Referrals given divided by leads minus desired cases, for leads that arrived in this period. A referral counts when a referral text is logged or the lead is marked referred.",
        tone: referralTone,
      },
      {
        label: "Never connected",
        display: showPercent(neverRate),
        goal: "Goal < 5%",
        detail: oldIds.length
          ? `${neverTone === "short" ? "Above the limit" : statusWord(neverTone)} · ${never} of ${oldIds.length} leads at least 16 days old`
          : "No leads in this period are 16 days old yet",
        definition:
          "Leads with no connected phone call after 16 days, divided by leads that arrived in this period and are at least 16 days old. A connected call is a human call. Missed calls and Sona calls do not count. Call length is not stored yet.",
        tone: oldIds.length ? neverTone : "empty",
      },
      {
        label: "Qualification rate",
        display: showPercent(qualification),
        goal: "Goal > 25%",
        detail: qualification == null ? statusWord(qualificationTone) : `${statusWord(qualificationTone)} · ${qualified} of ${cohort.length} leads`,
        definition: "Qualified leads divided by leads that arrived in this period. A lead with no qualification recorded is not counted as qualified.",
        tone: qualificationTone,
      },
      {
        label: "Conversion rate",
        display: showPercent(conversion),
        goal: "Goal > 10%",
        detail: conversion == null ? statusWord(conversionTone) : `${statusWord(conversionTone)} · ${signedCohort} of ${cohort.length} leads`,
        definition: "Signed cases divided by leads that arrived in this period.",
        tone: conversionTone,
      },
      {
        label: "Call quality",
        display: callQuality?.letter ?? "—",
        goal: "Intake call average",
        detail: callQuality
          ? `${callQuality.score} average · ${callQuality.count} intake ${callQuality.count === 1 ? "call" : "calls"}`
          : "No graded intake calls in this period",
        definition:
          "Average grade of intake calls in this period, the same average as the Call grades page. This is how the intake was handled. The case grade on the work queue is separate.",
        tone: callQuality ? "open" : "empty",
      },
    ],
    counts: [
      {
        label: "Calls",
        value: String(callCount),
        definition: "Calls in this period, including inbound, outbound, missed calls, and Sona calls.",
      },
      {
        label: "Leads",
        value: String(cohort.length),
        definition: "Work leads that arrived in this period. Spam, vendors, and the other not-a-lead reasons stay out.",
      },
      {
        label: "Consultations",
        value: String(consults),
        definition: "Leads with a consultation date in this period.",
      },
      {
        label: "Qualified leads",
        value: String(qualified),
        definition: "Leads that arrived in this period and are marked qualified.",
      },
      {
        label: "Desired cases",
        value: String(desiredLeads.length),
        definition: "Leads that arrived in this period and are desired, including signed cases.",
      },
      {
        label: "Signed cases",
        value: String(signedInPeriod),
        definition: "Representation contracts with a signed date in this period.",
      },
    ],
  };
}

async function countConsults(supabase: SupabaseClient, period: ResolvedPeriod): Promise<number> {
  const { data, error } = await supabase
    .from("leads")
    .select("id, caller_class, phone, phone_e164")
    .gte("consultation_date", period.start)
    .lte("consultation_date", period.end)
    .limit(2000);
  if (error) throw new Error(error.message);
  return (data ?? []).filter((lead) => isWorkLead(lead) && !isPracticeTestPhone(lead.phone_e164 || lead.phone)).length;
}

async function countSigned(supabase: SupabaseClient, period: ResolvedPeriod): Promise<number> {
  const { data, error } = await supabase
    .from("leads")
    .select("id, caller_class, phone, phone_e164, date_signed, signed_at")
    .or(`and(date_signed.gte.${period.start},date_signed.lte.${period.end}),and(signed_at.gte."${period.fromIso}",signed_at.lt."${period.toIso}")`)
    .limit(2000);
  if (error) throw new Error(error.message);
  const ids = new Set<string>();
  for (const lead of data ?? []) {
    if (!isWorkLead(lead) || isPracticeTestPhone(lead.phone_e164 || lead.phone)) continue;
    const signedDay = lead.date_signed?.slice(0, 10) || (lead.signed_at ? chicagoDay(lead.signed_at) : "");
    if (signedDay >= period.start && signedDay <= period.end) ids.add(lead.id);
  }
  return ids.size;
}

async function loadCallQuality(
  supabase: SupabaseClient,
  period: ResolvedPeriod,
): Promise<{ letter: "A" | "B" | "C" | "D" | "F"; score: number; count: number } | null> {
  const rows: { score: number | null; lead_id: string | null; leads: { caller_class: string | null } | { caller_class: string | null }[] | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("call_grades")
      .select("score, lead_id, leads(caller_class)")
      .gte("occurred_at", period.fromIso)
      .lt("occurred_at", period.toIso)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as typeof rows;
    rows.push(...batch);
    if (batch.length < 1000) break;
  }
  const scores = rows
    .filter((row) => {
      const lead = Array.isArray(row.leads) ? row.leads[0] : row.leads;
      return Boolean(row.lead_id) && isWorkLead({ caller_class: lead?.caller_class });
    })
    .map((row) => row.score ?? Number.NaN);
  const average = averageCallGrade(scores);
  if (!average) return null;
  return { ...average, count: scores.filter((score) => Number.isFinite(score)).length };
}

function isFormFill(lead: { arrival: string | null; lead_source: string | null; summary: string | null }): boolean {
  if (lead.arrival === "form") return true;
  const text = `${lead.lead_source || ""} ${lead.summary || ""}`.toLowerCase();
  return /meta form|website lead|site form|web chat|webchat|chat inquiry/.test(text);
}

async function speedToLead(
  supabase: SupabaseClient,
  period: ResolvedPeriod,
  cohort: CohortLead[],
): Promise<{ met: number; total: number }> {
  const events: { at: number; leadId: string | null; phone: string }[] = [];
  const coveredCalls = new Set<string>();
  const calls: { lead_id: string | null; phone_e164: string | null; occurred_at: string }[] = [];
  for (let from = 0; from < 5000; from += 1000) {
    const { data, error } = await supabase
      .from("intake_interactions")
      .select("lead_id, phone_e164, occurred_at")
      .eq("direction", "inbound")
      .in("type", ["missed_call", "sona_call"])
      .gte("occurred_at", period.fromIso)
      .lt("occurred_at", period.toIso)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as { lead_id: string | null; phone_e164: string | null; occurred_at: string }[];
    calls.push(...batch);
    if (batch.length < 1000) break;
  }
  for (const row of calls) {
    if (isPracticeTestPhone(row.phone_e164)) continue;
    const at = new Date(row.occurred_at).getTime();
    if (!Number.isFinite(at)) continue;
    events.push({ at, leadId: row.lead_id, phone: phoneTail(row.phone_e164) });
    if (row.lead_id) coveredCalls.add(row.lead_id);
  }
  for (const lead of cohort) {
    if (!lead.created_at || isPracticeTestPhone(lead.phone_e164 || lead.phone)) continue;
    const callArrival = lead.arrival === "missed" || lead.arrival === "sona";
    if (!isFormFill(lead) && !(callArrival && !coveredCalls.has(lead.id))) continue;
    if (callArrival && coveredCalls.has(lead.id)) continue;
    const at = new Date(lead.created_at).getTime();
    if (Number.isFinite(at)) events.push({ at, leadId: lead.id, phone: phoneTail(lead.phone_e164 || lead.phone) });
  }
  if (!events.length) return { met: 0, total: 0 };

  const later = chicagoLocalToIso(`${addDays(period.end, 1)}T00:00`);
  const outbound: { lead_id: string | null; phone_e164: string | null; occurred_at: string }[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error: outboundError } = await supabase
      .from("intake_interactions")
      .select("lead_id, phone_e164, occurred_at")
      .eq("direction", "outbound")
      .in("type", ["call", "text"])
      .gte("occurred_at", period.fromIso)
      .lt("occurred_at", later)
      .order("occurred_at", { ascending: true })
      .range(from, from + 999);
    if (outboundError) throw new Error(outboundError.message);
    const batch = (data ?? []) as { lead_id: string | null; phone_e164: string | null; occurred_at: string }[];
    outbound.push(...batch);
    if (batch.length < 1000) break;
  }
  const byLead = new Map<string, number[]>();
  const byPhone = new Map<string, number[]>();
  for (const row of outbound) {
    const at = new Date(row.occurred_at).getTime();
    if (!Number.isFinite(at)) continue;
    if (row.lead_id) {
      const list = byLead.get(row.lead_id) ?? [];
      list.push(at);
      byLead.set(row.lead_id, list);
    }
    const phone = phoneTail(row.phone_e164);
    if (phone.length >= 10) {
      const list = byPhone.get(phone) ?? [];
      list.push(at);
      byPhone.set(phone, list);
    }
  }
  for (const list of byLead.values()) list.sort((left, right) => left - right);
  for (const list of byPhone.values()) list.sort((left, right) => left - right);

  let met = 0;
  for (const event of events) {
    const times = (event.leadId ? byLead.get(event.leadId) : undefined) ?? (event.phone.length >= 10 ? byPhone.get(event.phone) : undefined);
    const contact = times?.find((time) => time >= event.at);
    if (contact != null && contact - event.at <= 2 * 60 * 1000) met += 1;
  }
  return { met, total: events.length };
}
