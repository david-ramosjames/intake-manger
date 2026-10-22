import type { SupabaseClient } from "@supabase/supabase-js";
import { Pool } from "pg";
import { isWorkLead } from "@/lib/caller-class";
import { slackMessageUrl } from "@/lib/leads";
import { milestoneDesired, milestoneQualified, milestoneSigned } from "@/lib/desired";
import { averageCallGrade } from "@/lib/call-grade";
import { priorityPlace } from "@/lib/next-step";
import { phoneTail } from "@/lib/phone";
import { ANSWER_RATE_INBOXES, LEADS_ANSWER_INBOXES, loadInboxAnswerRate } from "@/lib/inbox-calls";
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

async function collectPages<T>(load: (from: number, to: number) => Promise<T[]>, pageSize = 1000, cap = 80000): Promise<T[]> {
  const rows: T[] = [];
  const first = await load(0, pageSize - 1);
  rows.push(...first);
  if (first.length < pageSize) return rows;
  for (let from = pageSize; from < cap; ) {
    const starts = [0, 1, 2, 3].map((step) => from + step * pageSize).filter((start) => start < cap);
    const wave = await Promise.all(starts.map((start) => load(start, start + pageSize - 1)));
    for (const batch of wave) {
      rows.push(...batch);
      if (batch.length < pageSize) return rows;
    }
    from += starts.length * pageSize;
  }
  return rows;
}

async function mapSlices<T>(ids: string[], size: number, run: (slice: string[]) => Promise<T[]>): Promise<T[]> {
  if (!ids.length) return [];
  const slices: string[][] = [];
  for (let index = 0; index < ids.length; index += size) slices.push(ids.slice(index, index + size));
  const batches = await Promise.all(slices.map(run));
  return batches.flat();
}

async function parallelRanges<T>(load: (from: number, to: number) => Promise<T[]>, pages: number): Promise<T[]> {
  const batches = await Promise.all(Array.from({ length: pages }, (_, index) => load(index * 1000, index * 1000 + 999)));
  return batches.flat();
}

export async function loadNavTiles(supabase: SupabaseClient): Promise<NavTiles> {
  const [openRows, signedResult, jobRows, calledRows] = await Promise.all([
    parallelRanges(async (from, to) => {
      const { data, error } = await supabase
        .from("leads")
        .select(OPEN_COLUMNS)
        .or("caller_class.is.null,caller_class.eq.non_pi")
        .not("lead_status", "in", "(Signed,Promoted,Lost,Referred)")
        .eq("signed_case", false)
        .is("case_id", null)
        .order("id", { ascending: true })
        .range(from, to);
      if (error) throw new Error(error.message);
      return (data ?? []) as OpenLead[];
    }, 2),
    supabase.from("leads").select("phone, phone_e164").eq("signed_case", true).limit(1000),
    parallelRanges(async (from, to) => {
      const { data, error } = await supabase.from("lead_jobs").select("lead_id").eq("queue", "call").eq("status", "pending").order("id", { ascending: true }).range(from, to);
      if (error) throw new Error(error.message);
      return (data ?? []) as { lead_id: string | null }[];
    }, 3),
    parallelRanges(async (from, to) => {
      const { data, error } = await supabase
        .from("intake_interactions")
        .select("lead_id")
        .eq("type", "call")
        .eq("direction", "outbound")
        .order("id", { ascending: true })
        .range(from, to);
      if (error) throw new Error(error.message);
      return (data ?? []) as { lead_id: string | null }[];
    }, 3),
  ]);
  if (signedResult.error) throw new Error(signedResult.error.message);
  const openLeads = openRows.filter((lead) => isWorkLead(lead));

  const placed = openLeads.filter((lead) => priorityPlace(lead));
  const signedPhones = new Set<string>();
  for (const row of signedResult.data ?? []) {
    const key = phoneTail(row.phone) || phoneTail(row.phone_e164);
    if (key.length >= 10) signedPhones.add(key);
  }
  const priority = placed.filter((lead) => phoneTail(lead.phone).length < 10 || !signedPhones.has(phoneTail(lead.phone)));
  const desired = openLeads.filter((lead) => milestoneDesired(lead) === true);

  const openIds = new Set(openLeads.map((lead) => lead.id));
  const waitingIds = [...new Set(jobRows.map((row) => row.lead_id).filter((id): id is string => Boolean(id && openIds.has(id))))];
  const called = new Set(calledRows.map((row) => row.lead_id).filter((id): id is string => Boolean(id)));
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

function declinedLegalLead(lead: CohortLead): boolean {
  if (milestoneDesired(lead) === true || milestoneSigned(lead)) return false;
  const tags = lead.callrail_tags ?? [];
  const caseType = (lead.case_type || "").trim().replace(/^t:\s*/i, "").toLowerCase();
  const nonPi =
    lead.caller_class === "non_pi" ||
    caseType === "non-pi legal matter" ||
    tags.includes("NQ: Non-PI Legal Matter") ||
    tags.includes("DEC: Non-PI Legal Matter");
  const unwanted = tags.some((tag) => tag.startsWith("DEC:")) || milestoneDesired(lead) === false;
  return nonPi || unwanted;
}

const VOICEMAIL =
  /\b(voicemail|voice mail|left (a |your )?(message|voicemail)|after the (tone|beep)|mailbox is full|please leave (a |your )?message|no answer|not answered|didn'?t answer|did not answer|went to voicemail|was not answered|unable to reach|nobody answered|no one answered)\b/i;

function bareOptOut(text: string): boolean {
  const cleaned = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ");
  return ["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "no", "no thanks", "no thank you"].includes(cleaned);
}

function substantiveReply(text: string | null): boolean {
  const body = (text || "").trim();
  if (body.length < 2 || bareOptOut(body)) return false;
  return true;
}

function liveCall(direction: string, text: string, duration: number | null): boolean {
  if (VOICEMAIL.test(text)) return false;
  const outbound = /out/i.test(direction);
  const body = text.trim();
  if (!outbound) return true;
  if (duration != null && duration < 90) return body.length >= 240;
  return body.length >= 80;
}

function meaningfulContact(row: {
  type: string | null;
  direction: string | null;
  content: string | null;
  transcript: string | null;
  duration: number | null;
}): boolean {
  const type = (row.type || "").toLowerCase();
  const direction = (row.direction || "").toLowerCase();
  if (type === "missed_call" || type === "voicemail" || type === "sona_call") return false;
  if (type === "text") return (direction === "inbound" || direction === "incoming") && substantiveReply(row.content);
  if (type !== "call") return false;
  const text = `${row.content || ""}\n${row.transcript || ""}`.slice(0, 4000);
  return liveCall(direction, text, row.duration);
}

async function callDurations(ids: string[]): Promise<Map<string, number>> {
  const connectionString = process.env.REPORTING_DATABASE_URL?.trim();
  const unique = [...new Set(ids.filter(Boolean))].slice(0, 4000);
  if (!connectionString || !unique.length) return new Map();
  const local = /localhost|127\.0\.0\.1/.test(connectionString);
  const pool = new Pool({
    connectionString,
    ssl: local ? false : { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 4000,
    query_timeout: 4000,
  });
  try {
    const result = await pool.query<{ call_id: string; duration_sec: number | null }>(
      "select call_id, max(duration_sec)::int as duration_sec from quo_calls where call_id = any($1::text[]) group by call_id",
      [unique],
    );
    const durations = new Map<string, number>();
    for (const row of result.rows) {
      if (row.call_id && row.duration_sec != null && Number.isFinite(Number(row.duration_sec))) {
        durations.set(row.call_id, Number(row.duration_sec));
      }
    }
    return durations;
  } catch {
    return new Map();
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function neverConnected(supabase: SupabaseClient, leads: CohortLead[]): Promise<{ never: number; ids: string[] }> {
  const arrivalAt = new Map<string, number>();
  for (const lead of leads) {
    const stamp = lead.created_at ? Date.parse(lead.created_at) : Date.parse(chicagoLocalToIso(`${arrivalDay(lead)}T00:00`));
    if (Number.isFinite(stamp)) arrivalAt.set(lead.id, stamp);
  }
  const sequenceMs = 16 * 24 * 60 * 60 * 1000;
  const ids = [...arrivalAt.keys()];
  const touches = await mapSlices(ids, 80, async (slice) => {
    const { data, error } = await supabase
      .from("intake_interactions")
      .select("lead_id, type, direction, content, transcript, occurred_at, source_id")
      .in("type", ["call", "text", "missed_call", "sona_call", "voicemail"])
      .in("lead_id", slice);
    if (error) throw new Error(error.message);
    return (data ?? []) as {
      lead_id: string | null;
      type: string | null;
      direction: string | null;
      content: string | null;
      transcript: string | null;
      occurred_at: string | null;
      source_id: string | null;
    }[];
  });
  const durations = await callDurations(touches.map((row) => row.source_id || "").filter(Boolean));
  const connected = new Set<string>();
  for (const row of touches) {
    if (!row.lead_id || connected.has(row.lead_id)) continue;
    const start = arrivalAt.get(row.lead_id);
    const at = row.occurred_at ? Date.parse(row.occurred_at) : Number.NaN;
    if (start == null || !Number.isFinite(at) || at < start || at > start + sequenceMs) continue;
    if (
      meaningfulContact({
        type: row.type,
        direction: row.direction,
        content: row.content,
        transcript: row.transcript,
        duration: row.source_id ? durations.get(row.source_id) ?? null : null,
      })
    ) {
      connected.add(row.lead_id);
    }
  }
  return { never: ids.filter((id) => !connected.has(id)).length, ids };
}

export async function loadDashboardReport(supabase: SupabaseClient, period: ResolvedPeriod): Promise<DashboardReport> {
  const inboxPromise = loadInboxAnswerRate(supabase, period.fromIso, period.toIso);
  const speedPromise = loadSpeedDetail(supabase, period);
  const consultsPromise = countConsults(supabase, period);
  const signedPromise = countSigned(supabase, period);
  const qualityPromise = loadCallQuality(supabase, period);
  const sendsPromise = supabase.from("referral_sends").select("lead_id").limit(1000);
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
  const desiredLeads = cohort.filter((lead) => milestoneDesired(lead) === true || milestoneSigned(lead));
  const qualified = cohort.filter((lead) => milestoneQualified(lead) === true).length;
  const signedCohort = cohort.filter((lead) => milestoneSigned(lead)).length;
  const signedDesired = desiredLeads.filter((lead) => milestoneSigned(lead)).length;
  const declinedIds = new Set(cohort.filter((lead) => declinedLegalLead(lead)).map((lead) => lead.id));
  const referred = new Set<string>();
  for (const lead of cohort) {
    if (declinedIds.has(lead.id) && (lead.lead_status === "Referred" || lead.close_reason === "referred")) referred.add(lead.id);
  }
  const oldLeads = cohort.filter((lead) => {
    const day = arrivalDay(lead);
    return day && daysBetween(day, period.end) >= 16;
  });

  const [sendResult, neverResult, inbox, speed, consults, signedInPeriod, callQuality] = await Promise.all([
    sendsPromise,
    neverConnected(supabase, oldLeads),
    inboxPromise,
    speedPromise,
    consultsPromise,
    signedPromise,
    qualityPromise,
  ]);
  if (sendResult.error) throw new Error(sendResult.error.message);
  for (const row of sendResult.data ?? []) {
    if (row.lead_id && declinedIds.has(row.lead_id)) referred.add(row.lead_id);
  }
  const never = neverResult.never;
  const oldIds = neverResult.ids;

  const answer = percent(inbox.total.answered, inbox.total.incoming);
  const leadsAnswer = percent(inbox.leads.answered, inbox.leads.incoming);
  const inboxPartial = Boolean(inbox.total.earliest && Date.parse(inbox.total.earliest) > Date.parse(period.fromIso) + 60 * 60 * 1000);
  const inboxLines = ANSWER_RATE_INBOXES.join(", ");
  const leadLines = LEADS_ANSWER_INBOXES.join(" and ");
  const wanted = percent(signedDesired, desiredLeads.length);
  const referral = percent(referred.size, declinedIds.size);
  const neverRate = percent(never, oldIds.length);
  const qualification = percent(qualified, cohort.length);
  const conversion = percent(signedCohort, cohort.length);
  const speedRate = percent(speed.met, speed.total);

  const answerTone = higher(answer, 90);
  const leadsAnswerTone = higher(leadsAnswer, 90);
  const wantedTone = higher(wanted, 90);
  const referralTone = higher(referral, 95);
  const neverTone = lower(neverRate, 5);
  const qualificationTone = higher(qualification, 25);
  const conversionTone = higher(conversion, 10);
  const speedTone = higher(speedRate, 100);

  return {
    rates: [
      {
        label: "Total answer rate",
        display: showPercent(answer),
        goal: "Goal > 90%",
        detail:
          answer == null
            ? inbox.total.earliest
              ? statusWord(answerTone)
              : "Inbox calls are still loading"
            : `${statusWord(answerTone)} · ${inbox.total.answered} of ${inbox.total.incoming} incoming calls${inboxPartial ? " · history is still filling for the start of this range" : ""}`,
        definition: `Answered by a person divided by incoming calls, on the same inboxes as the Call Stats email: ${inboxLines}. This is the total answer rate, including the main line. A person answer is a completed incoming call that someone picked up. Sona, voicemail, missed calls, and forwards with nobody who picked up stay in the total.`,
        tone: answerTone,
      },
      {
        label: "Leads answer rate",
        display: showPercent(leadsAnswer),
        goal: "Goal > 90%",
        detail:
          leadsAnswer == null
            ? inbox.leads.earliest
              ? statusWord(leadsAnswerTone)
              : "Inbox calls are still loading"
            : `${statusWord(leadsAnswerTone)} · ${inbox.leads.answered} of ${inbox.leads.incoming} incoming calls`,
        definition: `Answered by a person divided by incoming calls on ${leadLines} only. The Leads line is the RJL lead number. The main line, RGV Number, and RJL Transfers stay in the total answer rate and out of this one. The person-answer rule is the same as the Call Stats email.`,
        tone: leadsAnswerTone,
      },
      {
        label: "Missed calls and form fills",
        display: showPercent(speedRate),
        goal: "Goal: contacted within 2 minutes",
        detail: speed.total ? `${statusWord(speedTone)} · ${speed.met} of ${speed.total} contacted in time` : statusWord(speedTone),
        definition:
          "One first contact per new lead: the earliest missed call, Sona call, or web form that needs a callback. Later calls to that lead are not counted again. Contacted in time means an outbound call, or a text a person wrote, within 2 minutes. Automated sequence texts do not count as contact. A form text that lands up to 2 minutes before the lead record is saved still counts when it is not one of those sequence texts. Insurance companies, existing clients, and other non-leads are left out. Open the card to see each lead, its call and text log, and the Slack post.",
        tone: speedTone,
      },
      {
        label: "Wanted conversion",
        display: showPercent(wanted),
        goal: "Goal 90%+",
        detail: wanted == null ? statusWord(wantedTone) : `${statusWord(wantedTone)} · ${signedDesired} of ${desiredLeads.length} desired`,
        definition: "Wanted conversion is signed desired cases divided by desired cases, among leads that arrived in this period. A signed case counts as desired.",
        tone: wantedTone,
      },
      {
        label: "Declined referral rate",
        display: showPercent(referral),
        goal: "Goal 95%+",
        detail: referral == null ? statusWord(referralTone) : `${statusWord(referralTone)} · ${referred.size} of ${declinedIds.size} declined leads`,
        definition:
          "Referrals given divided by genuine legal leads the firm declined in this period. That includes non-PI legal matters and PI cases marked not wanted or given a decline reason. Spam, vendors, existing clients, and other non-leads stay out. A lead that is still undecided stays out. A referral counts when a referral text is logged or the lead is marked referred.",
        tone: referralTone,
      },
      {
        label: "Never connected",
        display: showPercent(neverRate),
        goal: "Goal < 5%",
        detail: oldIds.length
          ? `${neverTone === "short" ? "Above the limit" : statusWord(neverTone)} · ${never} of ${oldIds.length} leads through the 16-day sequence`
          : "No leads in this period have finished the 16-day sequence",
        definition:
          "Leads that finished the 16-day follow-up with no meaningful two-way contact, divided by leads that arrived in this period and are old enough for that sequence to finish. An outbound attempt, a voicemail, a missed call, or a Sona call is not a connection. A live conversation counts, even a short one. A call counts as live unless the transcript or summary identifies a voicemail or an unanswered attempt. When call length is available, a call under 90 seconds counts only when the transcript still shows a conversation. An inbound text counts when it says something other than STOP or NO.",
        tone: oldIds.length ? neverTone : "empty",
      },
      {
        label: "Qualification rate",
        display: showPercent(qualification),
        goal: "Goal > 25%",
        detail: qualification == null ? statusWord(qualificationTone) : `${statusWord(qualificationTone)} · ${qualified} of ${cohort.length} leads`,
        definition: "Qualification rate is qualified leads divided by all leads that arrived in this period. Spam, vendors, existing clients, and other non-leads are not leads. A lead with no qualification recorded stays in the total and is not counted as qualified.",
        tone: qualificationTone,
      },
      {
        label: "Conversion rate",
        display: showPercent(conversion),
        goal: "Goal > 10%",
        detail: conversion == null ? statusWord(conversionTone) : `${statusWord(conversionTone)} · ${signedCohort} of ${cohort.length} leads`,
        definition: "Conversion rate is signed cases divided by all leads that arrived in this period. Signed means the representation contract is signed.",
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
          "Call quality is the average from the call-quality grades, the same average as the Call grades page. It grades how the intake call was handled. It does not use the case grade.",
        tone: callQuality ? "open" : "empty",
      },
    ],
    counts: [
      {
        label: "First contacts",
        value: String(speed.total),
        definition:
          "The first missed call, Sona call, or web form for each new lead in this period. Later calls to the same lead are not added again.",
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

function formKind(lead: { lead_source: string | null; summary: string | null }): string {
  const text = `${lead.lead_source || ""} ${lead.summary || ""}`.toLowerCase();
  if (text.includes("meta form")) return "Meta form";
  if (text.includes("site form")) return "Site form";
  if (/web chat|webchat|chat inquiry/.test(text)) return "Web chat";
  if (text.includes("website")) return "Website form";
  return "Form";
}

export type SpeedTouch = {
  at: string;
  label: string;
  note: string | null;
  slack: string | null;
};

export type SpeedEvent = {
  id: string;
  kind: string;
  at: string;
  leadId: string | null;
  name: string;
  phone: string;
  slack: string | null;
  met: boolean;
  wait: string;
  log: SpeedTouch[];
};

function waitText(seconds: number | null, kind: "text" | "call" | null): string {
  if (seconds == null || !kind) return "No contact stored";
  const word = kind === "text" ? "Text" : "Call";
  const span = Math.abs(seconds);
  const clock = span < 60 ? `${span}s` : span < 90 * 60 ? `${Math.round(span / 60)}m` : `${Math.round(span / 3600)}h`;
  if (seconds < 0) return `${word} ${clock} before the record`;
  return `${word} in ${clock}`;
}

function touchLabel(type: string, direction: string): string {
  if (type === "missed_call") return "Missed call";
  if (type === "sona_call") return "Sona call";
  if (type === "text") return direction === "outbound" ? "Text out" : "Text in";
  if (type === "call") return direction === "outbound" ? "Call out" : "Call in";
  return type;
}

type SpeedDraft = {
  id: string;
  kind: string;
  at: number;
  leadId: string | null;
  name: string;
  phone: string;
  slack: string | null;
};

type LeadStamp = {
  id: string;
  lead_name: string | null;
  caller_class: string | null;
  summary: string | null;
  phone_e164: string | null;
  slack_permalink: string | null;
  slack_channel_id: string | null;
  slack_message_ts: string | null;
  slack_thread_ts: string | null;
};

const LEAD_STAMP = "id, lead_name, caller_class, summary, phone_e164, slack_permalink, slack_channel_id, slack_message_ts, slack_thread_ts";

/** The caller is an insurer or adjuster, not a person asking the firm for help. */
function callerIsInsurer(text: string): boolean {
  const value = text.replace(/\s+/g, " ");
  if (/lawsuit from|sued by|attempted to reach|insurance company attempted/i.test(value)) return false;
  return /\b(from|representing)\s+(an?\s+)?(insurance company|allstate|geico|progressive|liberty mutual|state farm|farmers|usaa|nationwide|travelers|the hartford|aaa insurance|go auto)\b/i.test(
    value,
  );
}

function intakeCaller(lead: LeadStamp | null, content: string | null): boolean {
  if (lead && !isWorkLead(lead)) return false;
  if ((!lead || !lead.caller_class) && callerIsInsurer(`${lead?.summary || ""} ${content || ""}`)) return false;
  return true;
}

type SpeedHit = { at: number; kind: "text" | "call" };

type LogRow = {
  lead_id: string | null;
  phone_e164: string | null;
  type: string | null;
  direction: string | null;
  occurred_at: string | null;
  content: string | null;
  slack_permalink: string | null;
};

function firstHit(list: SpeedHit[] | undefined, at: number, lookbackMs: number): SpeedHit | null {
  return list?.find((hit) => hit.at >= at - lookbackMs) ?? null;
}

function earlier(left: SpeedHit | null, right: SpeedHit | null): SpeedHit | null {
  if (!left) return right;
  if (!right) return left;
  return left.at <= right.at ? left : right;
}

function initialContacts(rows: SpeedDraft[]): SpeedDraft[] {
  const kept = new Map<string, SpeedDraft>();
  for (const event of rows) {
    const key = event.leadId || (event.phone.length >= 10 ? `phone:${event.phone}` : event.id);
    const current = kept.get(key);
    if (!current || event.at < current.at) kept.set(key, event);
  }
  return [...kept.values()];
}

function templatePattern(body: string): RegExp | null {
  const trimmed = body.replace(/\s+/g, " ").trim();
  if (trimmed.length < 20) return null;
  const pieces = trimmed.split(/\{\{\s*(?:name|case_type)\s*\}\}/i);
  const pattern = pieces
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+"))
    .join("[\\s\\S]{0,80}");
  return new RegExp(pattern, "i");
}

async function automatedPatterns(supabase: SupabaseClient): Promise<RegExp[]> {
  const { data, error } = await supabase.from("sequence_steps").select("body").eq("queue", "text");
  if (error || !data) return [];
  return data.map((row) => templatePattern(String(row.body || ""))).filter((pattern): pattern is RegExp => Boolean(pattern));
}

function isAutomatedText(content: string | null, patterns: RegExp[]): boolean {
  const text = (content || "").replace(/\s+/g, " ").trim();
  if (!text || !patterns.length) return false;
  return patterns.some((pattern) => pattern.test(text));
}

export async function loadSpeedDetail(
  supabase: SupabaseClient,
  period: ResolvedPeriod,
  options?: { log?: boolean },
): Promise<{ met: number; total: number; events: SpeedEvent[] }> {
  const withLog = options?.log === true;
  const drafts: SpeedDraft[] = [];
  const coveredCalls = new Set<string>();
  const names = new Map<string, string>();
  const slackByLead = new Map<string, string>();
  const later = chicagoLocalToIso(`${addDays(period.end, 1)}T00:00`);
  const [inbound, leadRows, logRows, templates] = await Promise.all([
    collectPages(async (from, to) => {
      const { data, error } = await supabase
        .from("intake_interactions")
        .select("lead_id, phone_e164, occurred_at, type, content, slack_permalink")
        .eq("direction", "inbound")
        .in("type", ["missed_call", "sona_call"])
        .gte("occurred_at", period.fromIso)
        .lt("occurred_at", period.toIso)
        .range(from, to);
      if (error) throw new Error(error.message);
      return (data ?? []) as { lead_id: string | null; phone_e164: string | null; occurred_at: string; type: string; content: string | null; slack_permalink: string | null }[];
    }, 1000, 5000),
    collectPages(async (from, to) => {
      const { data, error } = await supabase
        .from("leads")
        .select("id, lead_name, phone, phone_e164, created_at, lead_date, arrival, lead_source, summary, caller_class, slack_permalink, slack_channel_id, slack_message_ts, slack_thread_ts")
        .or(`and(created_at.gte."${period.fromIso}",created_at.lt."${period.toIso}"),and(lead_date.gte.${period.start},lead_date.lte.${period.end})`)
        .range(from, to);
      if (error) throw new Error(error.message);
      return data ?? [];
    }, 1000, 20000),
    withLog
      ? collectPages(async (from, to) => {
          const { data, error } = await supabase
            .from("intake_interactions")
            .select("lead_id, phone_e164, type, direction, occurred_at, content, slack_permalink")
            .in("type", ["call", "text", "missed_call", "sona_call"])
            .gte("occurred_at", period.fromIso)
            .lt("occurred_at", later)
            .order("occurred_at", { ascending: true })
            .range(from, to);
          if (error) throw new Error(error.message);
          return (data ?? []) as LogRow[];
        }, 1000, 80000)
      : collectPages(async (from, to) => {
          const { data, error } = await supabase
            .from("intake_interactions")
            .select("lead_id, phone_e164, type, direction, occurred_at, content, slack_permalink")
            .eq("direction", "outbound")
            .in("type", ["call", "text"])
            .gte("occurred_at", period.fromIso)
            .lt("occurred_at", later)
            .order("occurred_at", { ascending: true })
            .range(from, to);
          if (error) throw new Error(error.message);
          return (data ?? []) as LogRow[];
        }, 1000, 8000),
    automatedPatterns(supabase),
  ]);
  const stamps = new Map<string, LeadStamp>();
  const stampsByPhone = new Map<string, LeadStamp[]>();
  const remember = (lead: LeadStamp) => {
    stamps.set(lead.id, lead);
    const phone = phoneTail(lead.phone_e164);
    if (phone.length < 10) return;
    const list = stampsByPhone.get(phone) ?? [];
    if (!list.some((row) => row.id === lead.id)) list.push(lead);
    stampsByPhone.set(phone, list);
  };
  const inboundIds = [...new Set(inbound.map((row) => row.lead_id).filter((id): id is string => Boolean(id)))];
  const inboundPhones = [...new Set(inbound.map((row) => row.phone_e164).filter((phone): phone is string => Boolean(phone && phoneTail(phone).length >= 10)))];
  const [leadsById, leadsByPhone] = await Promise.all([
    mapSlices(inboundIds, 80, async (slice) => {
      const { data, error } = await supabase.from("leads").select(LEAD_STAMP).in("id", slice);
      if (error) throw new Error(error.message);
      return (data ?? []) as LeadStamp[];
    }),
    mapSlices(inboundPhones, 80, async (slice) => {
      const { data, error } = await supabase.from("leads").select(LEAD_STAMP).in("phone_e164", slice);
      if (error) throw new Error(error.message);
      return (data ?? []) as LeadStamp[];
    }),
  ]);
  for (const lead of [...leadsById, ...leadsByPhone]) remember(lead);
  for (const row of inbound) {
    if (isPracticeTestPhone(row.phone_e164)) continue;
    const at = new Date(row.occurred_at).getTime();
    if (!Number.isFinite(at)) continue;
    if (row.lead_id) coveredCalls.add(row.lead_id);
    const phone = phoneTail(row.phone_e164);
    const linked = row.lead_id ? stamps.get(row.lead_id) ?? null : null;
    const phoneLead = phone.length >= 10 ? (stampsByPhone.get(phone) ?? []).find((lead) => isWorkLead(lead)) ?? stampsByPhone.get(phone)?.[0] ?? null : null;
    const lead = linked ?? phoneLead;
    if (lead) coveredCalls.add(lead.id);
    if (!intakeCaller(lead, row.content)) continue;
    const slack = (lead ? slackMessageUrl(lead) : null) || row.slack_permalink;
    if (lead?.id && slack) slackByLead.set(lead.id, slack);
    if (lead?.lead_name) names.set(lead.id, lead.lead_name);
    drafts.push({
      id: `${row.type}-${lead?.id || row.lead_id || phone}-${row.occurred_at}`,
      kind: row.type === "sona_call" ? "Sona call" : "Missed call",
      at,
      leadId: lead?.id ?? row.lead_id,
      name: lead?.lead_name?.trim() || "",
      phone,
      slack,
    });
  }

  for (const lead of leadRows) {
    if (!isWorkLead(lead) || isPracticeTestPhone(lead.phone_e164 || lead.phone)) continue;
    if (!lead.caller_class && callerIsInsurer(lead.summary || "")) continue;
    const day = arrivalDay(lead);
    if (day < period.start || day > period.end) continue;
    if (lead.lead_name) names.set(lead.id, lead.lead_name);
    const slack = slackMessageUrl(lead);
    if (slack) slackByLead.set(lead.id, slack);
    if (!lead.created_at) continue;
    const callArrival = lead.arrival === "missed" || lead.arrival === "sona";
    if (!isFormFill(lead) && !(callArrival && !coveredCalls.has(lead.id))) continue;
    if (callArrival && coveredCalls.has(lead.id)) continue;
    const at = new Date(lead.created_at).getTime();
    if (!Number.isFinite(at)) continue;
    drafts.push({
      id: `lead-${lead.id}`,
      kind: callArrival ? (lead.arrival === "sona" ? "Sona call" : "Missed call") : formKind(lead),
      at,
      leadId: lead.id,
      name: lead.lead_name?.trim() || "",
      phone: phoneTail(lead.phone_e164 || lead.phone),
      slack: slackByLead.get(lead.id) ?? null,
    });
  }

  const contacts = initialContacts(drafts);
  const missingNames = withLog
    ? [...new Set(contacts.map((event) => event.leadId).filter((id): id is string => Boolean(id && !names.has(id))))]
    : [];
  for (let index = 0; index < missingNames.length; index += 80) {
    const { data } = await supabase.from("leads").select("id, lead_name").in("id", missingNames.slice(index, index + 80));
    for (const lead of data ?? []) {
      if (lead.lead_name) names.set(lead.id, lead.lead_name);
    }
  }

  const hitsByLead = new Map<string, SpeedHit[]>();
  const hitsByPhone = new Map<string, SpeedHit[]>();
  const logByLead = new Map<string, LogRow[]>();
  const logByPhone = new Map<string, LogRow[]>();
  for (const row of logRows) {
    const at = row.occurred_at ? new Date(row.occurred_at).getTime() : Number.NaN;
    const phone = phoneTail(row.phone_e164);
    if (withLog) {
      if (row.lead_id) {
        const list = logByLead.get(row.lead_id) ?? [];
        list.push(row);
        logByLead.set(row.lead_id, list);
      }
      if (phone.length >= 10) {
        const list = logByPhone.get(phone) ?? [];
        list.push(row);
        logByPhone.set(phone, list);
      }
    }
    if (!Number.isFinite(at) || row.direction !== "outbound" || (row.type !== "call" && row.type !== "text")) continue;
    if (row.type === "text" && isAutomatedText(row.content, templates)) continue;
    const hit = { at, kind: row.type as "text" | "call" };
    if (row.lead_id) {
      const list = hitsByLead.get(row.lead_id) ?? [];
      list.push(hit);
      hitsByLead.set(row.lead_id, list);
    }
    if (phone.length >= 10) {
      const list = hitsByPhone.get(phone) ?? [];
      list.push(hit);
      hitsByPhone.set(phone, list);
    }
  }
  for (const list of hitsByLead.values()) list.sort((left, right) => left.at - right.at);
  for (const list of hitsByPhone.values()) list.sort((left, right) => left.at - right.at);

  const events = contacts
    .map((event) => {
      const lookback = event.kind === "Missed call" || event.kind === "Sona call" ? 0 : 2 * 60 * 1000;
      const contact = earlier(
        event.leadId ? firstHit(hitsByLead.get(event.leadId), event.at, lookback) : null,
        event.phone.length >= 10 ? firstHit(hitsByPhone.get(event.phone), event.at, lookback) : null,
      );
      const seconds = contact ? Math.round((contact.at - event.at) / 1000) : null;
      const seen = new Set<string>();
      const log: SpeedTouch[] = withLog
        ? [...(event.leadId ? logByLead.get(event.leadId) ?? [] : []), ...(event.phone.length >= 10 ? logByPhone.get(event.phone) ?? [] : [])]
            .filter((row) => {
              const at = row.occurred_at ? new Date(row.occurred_at).getTime() : Number.NaN;
              if (!Number.isFinite(at) || at < event.at - 2 * 60 * 1000 || at > event.at + 36 * 60 * 60 * 1000) return false;
              const key = `${row.occurred_at}|${row.type}|${row.direction}|${phoneTail(row.phone_e164)}`;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            })
            .sort((left, right) => (left.occurred_at || "").localeCompare(right.occurred_at || ""))
            .slice(0, 12)
            .map((row) => ({
              at: row.occurred_at || "",
              label: touchLabel(row.type || "", row.direction || ""),
              note: row.content ? row.content.replace(/\s+/g, " ").trim().slice(0, 180) : null,
              slack: row.slack_permalink,
            }))
        : [];
      if (withLog) {
        const opener = { at: new Date(event.at).toISOString(), label: event.kind, note: null, slack: event.slack };
        const opened = log.some((item) => item.label === event.kind && Math.abs(new Date(item.at).getTime() - event.at) < 2000);
        if (!opened) log.unshift(opener);
      }
      const phone = event.phone.length === 10 ? `(${event.phone.slice(0, 3)}) ${event.phone.slice(3, 6)}-${event.phone.slice(6)}` : event.phone || "No number";
      return {
        id: event.id,
        kind: event.kind,
        at: new Date(event.at).toISOString(),
        leadId: event.leadId,
        name: (event.leadId && names.get(event.leadId)) || event.name || "Unknown",
        phone,
        slack: event.slack || (event.leadId ? slackByLead.get(event.leadId) ?? null : null),
        met: seconds != null && seconds >= -120 && seconds <= 120,
        wait: waitText(seconds, contact?.kind ?? null),
        log,
      };
    })
    .sort((left, right) => right.at.localeCompare(left.at));

  return { met: events.filter((event) => event.met).length, total: events.length, events };
}
