import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueueRow } from "@/components/WorkQueue";
import { callerClassLabel } from "@/lib/caller-class";
import { consultationWhen, contractSent, desiredWord, milestoneDesired, milestoneQualified, milestoneSigned, signatureNeedsConfirm } from "@/lib/desired";
import { sequenceDayOne } from "@/lib/followup";
import { loadStaff, suggestClientName, type StaffPerson } from "@/lib/identity";
import { fillLeadSources } from "@/lib/lead-source-fill";
import { daysSince, isPiCaseType, isSourceType, leadTitle, listAccident, listDetail, slackMessageUrl, suggestedCaseType, type Lead } from "@/lib/leads";
import { nextActionLines, nextActionMoment, type CallStep } from "@/lib/next-action";
import { leadCycle, leadStatusLabel, nextCallPurpose, nextStepLabel, openLeadAction, outreachSequence, PRIORITY_PLACE_LABEL, priorityPlace } from "@/lib/next-step";
import { phoneTail } from "@/lib/phone";
import { automationLine, receivedLabel, stageClass, stageStripe, waitingTooLong } from "@/lib/queue";
import { DEFAULT_REFERRAL_SMS, type ReferralDestination } from "@/lib/referrals";
import { leadSequenceId } from "@/lib/sequences";
import { docketBaseUrl } from "@/lib/supabase/config";
import { fillTalkedWith, isPlaceholderOwner } from "@/lib/talked-with";
import { isPracticeTestPhone } from "@/lib/test-phone";
import { chicagoDay, formatCallDay, formatCallWhen } from "@/lib/time";

const LIST_COLUMNS =
  "id, lead_date, created_at, lead_name, phone, phone_e164, email, identity_status, identity_evidence, lead_source, source_type, source_channel, source_note, case_type, case_detail, grade, arrival, lead_status, close_reason, close_suggestion, caller_class, practice_area, referral_opportunity, priority, priority_reason, priority_suggestion, next_action, callrail_tags, decline_reason, consultation_date, desired_case, desired_source, qualified, agreement_status, agreement_sent_at, agreement_signing_url, agreement_next_reminder_at, agreement_reminder_count, agreement_via_sms, agreement_via_email, text_sequence_status, text_sequence_slug, text_next_at, summary, owner_name, kind, sequence, follow_up, needs_verification, signed_case, date_signed, signed_at, case_id, case_number, intake_call_id, callrail_call_id, quo_link, slack_permalink, slack_channel_id, slack_message_ts, slack_thread_ts";

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

type HistoryTouch = {
  lead_id: string | null;
  phone: string | null;
  type: string | null;
  direction: string | null;
  occurred_at: string | null;
  quo_link: string | null;
  slack_permalink: string | null;
};

function phoneKey(value: string | null | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
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

function countsAsContact(type: string): boolean {
  return type === "call" || type === "sona_call" || type === "text" || type === "voicemail";
}

function slackTag(assigned: string | null | undefined, owner: string | null | undefined, consultationDate: string | null | undefined): string | null {
  if (!isPlaceholderOwner(assigned)) return assigned?.trim() || null;
  if (consultationDate && !isPlaceholderOwner(owner)) return owner?.trim() || null;
  return null;
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

function toQueueRow(
  lead: ListLead,
  input: {
    talked: boolean;
    tally: { calls: number; texts: number };
    outreachAt: string | undefined;
    nextAt: string | null;
    nextCall: { id: string; dueAt: string; tag: string | null; position: number } | undefined;
    nextTextId: string | null;
    sentFirm: string | null;
    outside: { quo: string | null; slack: string | null };
    callSteps: (CallStep & { sequence: string })[];
    docket: string;
    staff: StaffPerson[];
  },
): QueueRow {
  const cycle = leadCycle(lead, input.talked ? [{ type: "call", direction: "inbound" }] : []);
  const age = daysSince(lead.lead_date ?? lead.created_at);
  const outreach = daysSince(input.outreachAt);
  const waiting = waitingTooLong(cycle, age, outreach, input.nextAt ?? undefined);
  const label = (lead.caller_class === "non_pi" && isPiCaseType(suggestedCaseType(lead)) ? null : callerClassLabel(lead.caller_class)) ?? leadStatusLabel(lead, cycle);
  const priority = priorityPlace(lead);
  const closed = !isPracticeTestPhone(lead.phone_e164 || lead.phone) && (cycle === "signed" || cycle === "closed");
  const sequenceInput = {
    closed,
    talked: cycle !== "contact",
    kind: lead.kind,
    agreementStatus: lead.agreement_status,
    agreementSentAt: lead.agreement_sent_at,
    signedCase: lead.signed_case,
  };
  const nextAction = nextActionLines({
    closed,
    sequence: lead.sequence,
    textStatus: lead.text_sequence_status,
    textNextAt: lead.text_next_at,
    reminderAt: lead.agreement_next_reminder_at,
    agreementStatus: lead.agreement_status,
    callStart: dayOneFor(lead, sequenceInput),
    callsMade: input.tally.calls,
    pendingCallAt: input.nextAt,
    callSteps: stepsForLead(input.callSteps, sequenceInput),
    priority: priority === "contract" || priority === "flagged",
    contactAt: lead.created_at,
    leadId: lead.id,
  });
  const nextActionAt = nextActionMoment(nextAction);
  const automation = automationLine(lead);
  return {
    id: lead.id,
    title: leadTitle(lead),
    samePhone: [],
    closeSuggestion: lead.close_suggestion,
    identityStatus: lead.identity_status,
    identityEvidence: lead.identity_evidence,
    suggestedName: suggestClientName(lead.summary, input.staff),
    accident: listAccident(lead),
    when: receivedLabel(age),
    priority: priority ? PRIORITY_PLACE_LABEL[priority] : null,
    prioritySuggestion: lead.priority_suggestion,
    actionTitle: openLeadAction(lead, cycle, input.tally.calls),
    label,
    caseType: suggestedCaseType(lead),
    leadSource: lead.lead_source?.trim() || (listDetail(lead) === "—" ? "" : listDetail(lead)),
    sourceType: isSourceType(lead.source_type) ? lead.source_type : "",
    stageClassName: stageClass(label),
    stageStripe: stageStripe(label),
    step: nextStepLabel(nextCallPurpose(cycle, input.tally.calls)),
    tags: lead.callrail_tags ?? [],
    callrail: Boolean(lead.callrail_call_id),
    declineReason: lead.decline_reason,
    qualifiedLabel: desiredWord(milestoneQualified(lead)),
    consultWhen: consultationWhen(lead.consultation_date),
    desired: desiredWord(milestoneDesired(lead)),
    desiredLocked: contractSent(lead) || milestoneSigned(lead) || milestoneQualified(lead) === false,
    signed: milestoneSigned(lead),
    nonPi: lead.case_type === "Non-PI Legal Matter",
    practiceArea: lead.practice_area,
    referralSent: Boolean(input.sentFirm) || lead.lead_status === "Referred" || lead.close_reason === "referred",
    referralFirm: input.sentFirm,
    callerClass: lead.caller_class,
    confirmSigned: signatureNeedsConfirm(lead),
    lastLabel: lastContacted(outreach),
    lastDays: outreach,
    consultKey: lead.consultation_date ?? "",
    waiting,
    automationLabel: automation.label,
    automationBad: automation.bad,
    canStartText:
      (lead.text_sequence_status || "").toLowerCase() !== "active" &&
      Boolean(lead.phone_e164 || lead.phone) &&
      (isPracticeTestPhone(lead.phone_e164 || lead.phone) ||
        (!lead.signed_case &&
          !lead.case_id &&
          lead.lead_status !== "Lost" &&
          lead.lead_status !== "Referred" &&
          lead.lead_status !== "Promoted" &&
          lead.lead_status !== "Signed" &&
          lead.sequence !== "stop")),
    quoUrl: lead.quo_link || input.outside.quo,
    slackUrl: slackMessageUrl(lead) || input.outside.slack,
    leadName: lead.lead_name?.trim() || "",
    phone: displayPhone(lead.phone),
    email: lead.email,
    summary: lead.summary,
    owner: lead.owner_name,
    grade: lead.grade,
    textsLive: (lead.text_sequence_status || "").toLowerCase() === "active",
    textNext: lead.text_next_at,
    sequenceLabel: outreachSequence(lead).label,
    agreementStatus: lead.agreement_status,
    agreementSent: lead.agreement_sent_at,
    signingUrl: lead.agreement_signing_url,
    intakeHref: lead.intake_call_id ? `${input.docket}/intakes/${encodeURIComponent(lead.intake_call_id)}` : null,
    caseHref: lead.case_id ? `${input.docket}/cases/${lead.case_id}` : null,
    calls: input.tally.calls,
    texts: input.tally.texts,
    nextCallLabel: formatCallWhen(input.nextAt),
    callJobId: input.nextCall?.id ?? null,
    callTag: slackTag(input.nextCall?.tag, lead.owner_name, lead.consultation_date),
    textJobId: input.nextTextId,
    reminderAt: lead.agreement_next_reminder_at,
    nextAction,
    nextActionAt,
    nextDayKey: nextActionAt ? chicagoDay(nextActionAt) : "",
    nextDayLabel: formatCallDay(nextActionAt),
  };
}

export async function loadWorkQueueShelfContext(supabase: SupabaseClient): Promise<{
  destinations: ReferralDestination[];
  templates: { en: string; es: string };
  staffNames: string[];
}> {
  const [destinationResult, templateResult, staff] = await Promise.all([
    supabase
      .from("referral_destinations")
      .select("id, name, phone, practice_areas, address, email, website, spanish, matters, notes, active")
      .eq("active", true)
      .order("name"),
    supabase.from("referral_templates").select("language, body"),
    loadStaff(supabase),
  ]);
  const destinations = ((destinationResult.data ?? []) as ReferralDestination[]).map((destination) => ({
    ...destination,
    practice_areas: destination.practice_areas ?? [],
    active: destination.active !== false,
    spanish: Boolean(destination.spanish),
  }));
  const templateRows = (templateResult.data ?? []) as { language: string; body: string }[];
  return {
    destinations,
    templates: {
      en: templateRows.find((row) => row.language === "en")?.body || DEFAULT_REFERRAL_SMS.en,
      es: templateRows.find((row) => row.language === "es")?.body || DEFAULT_REFERRAL_SMS.es,
    },
    staffNames: staff.map((person) => person.name),
  };
}

export async function loadWorkQueueRows(
  supabase: SupabaseClient,
  leadIds: string[],
): Promise<{
  rows: QueueRow[];
  destinations: ReferralDestination[];
  templates: { en: string; es: string };
  staffNames: string[];
}> {
  const ids = [...new Set(leadIds.filter(Boolean))];
  if (ids.length === 0) {
    return { rows: [], destinations: [], templates: { en: DEFAULT_REFERRAL_SMS.en, es: DEFAULT_REFERRAL_SMS.es }, staffNames: [] };
  }

  const [{ data: leadRows }, { data: stepRows }, destinationResult, templateResult, staff, { data: sendRows }, { data: jobRows }, { data: touchRows }] =
    await Promise.all([
      supabase.from("leads").select(LIST_COLUMNS).in("id", ids),
      supabase.from("sequence_steps").select("sequence, position, delay_minutes, callback_window").eq("queue", "call").order("position"),
      supabase
        .from("referral_destinations")
        .select("id, name, phone, practice_areas, address, email, website, spanish, matters, notes, active")
        .eq("active", true)
        .order("name"),
      supabase.from("referral_templates").select("language, body"),
      loadStaff(supabase),
      supabase.from("referral_sends").select("lead_id, destination_id, created_at").in("lead_id", ids),
      supabase.from("lead_jobs").select("id, lead_id, due_at, queue, assigned_name, position").in("lead_id", ids).eq("status", "pending"),
      supabase
        .from("intake_interactions")
        .select("lead_id, phone, type, direction, occurred_at, quo_link, slack_permalink")
        .in("lead_id", ids)
        .order("occurred_at", { ascending: false })
        .limit(2000),
    ]);

  const leads = (leadRows ?? []) as ListLead[];
  await fillLeadSources(supabase, leads);
  await fillTalkedWith(
    supabase,
    leads.filter((lead) => lead.consultation_date),
    staff,
  );

  const destinations = ((destinationResult.data ?? []) as ReferralDestination[]).map((destination) => ({
    ...destination,
    practice_areas: destination.practice_areas ?? [],
    active: destination.active !== false,
    spanish: Boolean(destination.spanish),
  }));
  const templateRows = (templateResult.data ?? []) as { language: string; body: string }[];
  const templates = {
    en: templateRows.find((row) => row.language === "en")?.body || DEFAULT_REFERRAL_SMS.en,
    es: templateRows.find((row) => row.language === "es")?.body || DEFAULT_REFERRAL_SMS.es,
  };
  const firmName = new Map(destinations.map((destination) => [destination.id, destination.name]));
  const sentFirm = new Map<string, string>();
  for (const send of [...((sendRows ?? []) as { lead_id: string; destination_id: string; created_at: string }[])].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  )) {
    sentFirm.set(send.lead_id, firmName.get(send.destination_id) || "");
  }

  const idSet = new Set(ids);
  const idsByPhone = new Map<string, string[]>();
  for (const lead of leads) {
    const key = phoneKey(lead.phone);
    if (!key) continue;
    const list = idsByPhone.get(key) ?? [];
    list.push(lead.id);
    idsByPhone.set(key, list);
  }
  const talked = new Set<string>();
  const contact = new Map<string, { calls: number; texts: number }>();
  const lastOutreach = new Map<string, string>();
  const outsideLinks = new Map<string, { quo: string | null; slack: string | null }>();
  for (const touch of (touchRows ?? []) as HistoryTouch[]) {
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
      const links = outsideLinks.get(leadId) ?? { quo: null, slack: null };
      if (!links.quo && touch.quo_link) links.quo = touch.quo_link;
      if (!links.slack && touch.slack_permalink) links.slack = touch.slack_permalink;
      outsideLinks.set(leadId, links);
    }
  }

  const nextCall = new Map<string, { id: string; dueAt: string; tag: string | null; position: number }>();
  const nextText = new Map<string, { id: string; dueAt: string }>();
  for (const job of jobRows ?? []) {
    if (!job.lead_id || !job.due_at || !job.id) continue;
    if (job.queue === "text") {
      const current = nextText.get(job.lead_id);
      if (!current || job.due_at < current.dueAt) nextText.set(job.lead_id, { id: job.id, dueAt: job.due_at });
      continue;
    }
    if (job.queue !== "call") continue;
    if (new Date(job.due_at).getTime() <= Date.now()) continue;
    const position = typeof job.position === "number" ? job.position : Number.MAX_SAFE_INTEGER;
    const current = nextCall.get(job.lead_id);
    if (!current || position < current.position) {
      nextCall.set(job.lead_id, { id: job.id, dueAt: job.due_at, tag: job.assigned_name, position });
    }
  }

  const callSteps = (stepRows ?? []) as (CallStep & { sequence: string })[];
  const docket = docketBaseUrl();
  const rows = leads.map((lead) =>
    toQueueRow(lead, {
      talked: talked.has(lead.id),
      tally: contact.get(lead.id) ?? { calls: 0, texts: 0 },
      outreachAt: lastOutreach.get(lead.id),
      nextAt: nextCall.get(lead.id)?.dueAt ?? null,
      nextCall: nextCall.get(lead.id),
      nextTextId: nextText.get(lead.id)?.id ?? null,
      sentFirm: sentFirm.get(lead.id) || null,
      outside: outsideLinks.get(lead.id) ?? { quo: null, slack: null },
      callSteps,
      docket,
      staff,
    }),
  );

  return {
    rows,
    destinations,
    templates,
    staffNames: staff.map((person) => person.name),
  };
}
