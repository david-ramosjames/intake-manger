import type { SupabaseClient } from "@supabase/supabase-js";
import { chicagoMinute, scheduleCallback } from "./callbacks";
import { DATA_ERROR_CLASS, EXCLUDED_CALLER_CLASSES, isWorkLead } from "./caller-class";
import { isPlaceholderOwner } from "./talked-with";
import { contractOutstanding } from "./desired";
import { nameIsUnavailable, type LeadKind } from "./leads";
import { type CallSequenceId, type WorkHours } from "./sequences";
import { chicagoLocalToIso, formatChicago } from "./time";
import { stopSmsFollowUp } from "./sms-followup";
import { isPracticeTestPhone } from "./test-phone";
import { toE164 } from "./phone";

type LeadBits = {
  id: string;
  kind: LeadKind;
  follow_up: boolean;
  lead_name: string | null;
  case_type: string | null;
  signed_case: boolean;
  case_id: string | null;
  lead_status: string;
  arrival?: string | null;
  owner_name?: string | null;
  agreement_status?: string | null;
  agreement_sent_at?: string | null;
  agreement_reminder_count?: number | null;
  agreement_next_reminder_at?: string | null;
  priority?: boolean | null;
  created_at?: string | null;
  consultation_date?: string | null;
  lead_date?: string | null;
  phone?: string | null;
  phone_e164?: string | null;
  caller_class?: string | null;
};

/** Day 1 of a sequence. A later sequence starts over from its own day 1. */
export function sequenceDayOne(sequence: CallSequenceId, lead: LeadBits): Date {
  if (sequence === "want_to_sign" && lead.agreement_sent_at) {
    const sent = new Date(lead.agreement_sent_at);
    if (!Number.isNaN(sent.getTime())) return sent;
  }
  if (sequence === "more_info") {
    const consult = dayStart(lead.consultation_date);
    if (consult) return consult;
    const arrived = dayStart(lead.lead_date) ?? (lead.created_at ? new Date(lead.created_at) : null);
    if (arrived && !Number.isNaN(arrived.getTime())) return arrived;
  }
  if (sequence === "first_talk") {
    const arrived = dayStart(lead.lead_date) ?? (lead.created_at ? new Date(lead.created_at) : null);
    if (arrived && !Number.isNaN(arrived.getTime())) return arrived;
  }
  return new Date();
}

function dayStart(value: string | null | undefined): Date | null {
  const day = value?.slice(0, 10) ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return new Date(chicagoLocalToIso(`${day}T00:01`));
}

export function renderStep(body: string, lead: { lead_name: string | null; case_type: string | null }): string {
  const rawName = lead.lead_name?.trim().split(/\s+/)[0] || "";
  const name = !rawName || nameIsUnavailable(rawName) ? "there" : rawName;
  const caseType = lead.case_type?.trim() || "case";
  return body.replaceAll("{{name}}", name).replaceAll("{{case_type}}", caseType);
}

function closedLead(lead: LeadBits): boolean {
  if (isPracticeTestPhone(lead.phone_e164 || lead.phone)) return false;
  if (!isWorkLead(lead)) return true;
  return lead.signed_case || Boolean(lead.case_id) || ["Lost", "Referred", "Promoted", "Signed"].includes(lead.lead_status);
}

export function sequenceForLead(lead: LeadBits, manual: "post_consult" | "auto"): CallSequenceId | null {
  if (closedLead(lead)) return null;
  if (contractOutstanding(lead)) return "want_to_sign";
  // Post-consult cadence only after a real consult (or staff said so). A human /
  // Sona / missed arrival without a consult stays on the denser first-contact plan —
  // putting those on more_info scheduled the next call 9–12 days out.
  if (manual === "post_consult" || lead.consultation_date) {
    return "more_info";
  }
  return "first_talk";
}

function proposedCaller(
  _sequence: CallSequenceId,
  _position: number,
  owner: string | null | undefined,
  _consultation: boolean,
): string | null {
  const name = owner?.trim() ?? "";
  // Sticky Slack tag / talked-with person — use for every later reminder on this lead.
  if (isPlaceholderOwner(name) || /^outbound$/i.test(name)) return null;
  return name;
}

export async function enrollFollowUp(
  supabase: SupabaseClient,
  lead: LeadBits,
  hoursBySequence?: Record<CallSequenceId, WorkHours>,
  manual: "post_consult" | "auto" = "auto",
) {
  if (!lead.follow_up && manual !== "post_consult") return;
  const sequence = sequenceForLead(lead, manual);
  if (!sequence) return;

  const { data: steps, error } = await supabase
    .from("sequence_steps")
    .select("queue, position, delay_minutes, body, callback_window")
    .eq("sequence", sequence)
    .eq("queue", "call")
    .order("position");
  if (error) throw new Error(error.message);
  if (!steps?.length) return;

  const priority = Boolean(lead.priority) || sequence === "want_to_sign";
  const contactAt = lead.created_at ? new Date(lead.created_at) : null;
  const dayOne = sequenceDayOne(sequence, lead).getTime();
  const now = Date.now();
  const usedByDay = new Map<number, number[]>();
  // Past steps are dropped. If any were dropped, remaining dues are spaced from
  // now by the cadence gaps — not left on the original day-9 absolute times.
  type Planned = {
    step: (typeof steps)[number];
    delay: number;
    gapMinutes: number;
  };
  const planned: Planned[] = [];
  let skippedPast = false;
  let prevDelay: number | null = null;
  for (const step of steps ?? []) {
    const delay = Number(step.delay_minutes);
    if (dayOne + delay * 60_000 < now - 5 * 60_000) {
      skippedPast = true;
      prevDelay = delay;
      continue;
    }
    planned.push({
      step,
      delay,
      gapMinutes: prevDelay == null ? 0 : Math.max(0, delay - prevDelay),
    });
    prevDelay = delay;
  }
  let cursor = now;
  const rows = planned.map((item, index) => {
    const position = item.step.position as number;
    const absolute = dayOne + item.delay * 60_000;
    const from = skippedPast
      ? new Date(cursor + (index === 0 ? 0 : item.gapMinutes * 60_000))
      : new Date(absolute);
    const caller = proposedCaller(sequence, position, lead.owner_name, Boolean(lead.consultation_date));
    const dueAt = scheduleCallback({
      from,
      window: typeof item.step.callback_window === "string" ? item.step.callback_window : null,
      index: Math.max(0, position - 1),
      contactAt,
      priority,
      varyKey: `${lead.id}:${position}`,
      avoid: usedByDay.get(item.delay) ?? [],
    });
    cursor = new Date(dueAt).getTime();
    const minute = chicagoMinute(dueAt);
    if (minute != null) {
      const taken = usedByDay.get(item.delay) ?? [];
      taken.push(minute);
      usedByDay.set(item.delay, taken);
    }
    return {
      lead_id: lead.id,
      queue: item.step.queue as string,
      sequence,
      position,
      due_at: dueAt,
      body: renderStep(String(item.step.body), lead),
      assigned_name: caller,
      detail: caller && sequence === "want_to_sign"
        ? `Proposed owner: ${caller}. Change the tag if someone else should call.`
        : caller && sequence === "more_info" && lead.consultation_date
          ? `Tag ${caller}.`
          : null,
    };
  });
  // Keep the soonest pending reminder when switching sequences so a staff-set
  // Slack tag/time is not wiped by enrollMissingFollowUps.
  const { data: keep } = await supabase
    .from("lead_jobs")
    .select("id, position")
    .eq("lead_id", lead.id)
    .eq("queue", "call")
    .eq("status", "pending")
    .neq("sequence", sequence)
    .order("due_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (keep?.id) {
    let keepPosition = typeof keep.position === "number" && keep.position > 0 ? keep.position : 1;
    const { data: clash } = await supabase
      .from("lead_jobs")
      .select("id")
      .eq("lead_id", lead.id)
      .eq("queue", "call")
      .eq("sequence", sequence)
      .eq("position", keepPosition)
      .eq("status", "pending")
      .neq("id", keep.id)
      .maybeSingle();
    if (clash?.id) {
      const { data: taken } = await supabase
        .from("lead_jobs")
        .select("position")
        .eq("lead_id", lead.id)
        .eq("queue", "call")
        .eq("sequence", sequence);
      const used = new Set((taken ?? []).map((row) => Number(row.position)).filter((n) => Number.isFinite(n)));
      keepPosition = 1;
      while (used.has(keepPosition)) keepPosition += 1;
    }
    await supabase
      .from("lead_jobs")
      .delete()
      .eq("lead_id", lead.id)
      .eq("queue", "call")
      .eq("sequence", sequence)
      .eq("position", keepPosition)
      .eq("status", "skipped");
    await supabase
      .from("lead_jobs")
      .update({ sequence, position: keepPosition })
      .eq("id", keep.id);
  }
  await supabase
    .from("lead_jobs")
    .update({ status: "skipped", detail: "Moved to another sequence." })
    .eq("lead_id", lead.id)
    .eq("queue", "call")
    .eq("status", "pending")
    .neq("sequence", sequence);
  if (!rows.length) return;
  await supabase
    .from("lead_jobs")
    .delete()
    .eq("lead_id", lead.id)
    .eq("queue", "call")
    .eq("sequence", sequence)
    .eq("status", "skipped")
    .or("outcome_note.is.null,outcome_note.neq.auto_closed")
    .in("position", rows.map((row) => row.position));
  // Prefer existing pending rows (including a just-rehomed staff reminder) over cadence defaults.
  const { error: insertError } = await supabase.from("lead_jobs").upsert(rows, {
    onConflict: "lead_id,queue,sequence,position",
    ignoreDuplicates: true,
  });
  if (insertError) throw new Error(insertError.message);
  void hoursBySequence;
}

/** Soonest pending call should not sit a week out after earlier steps were used up. */
const MAX_NEXT_CALL_WAIT_MS = 36 * 60 * 60_000;

export async function pullForwardStaleCallJobs(
  supabase: SupabaseClient,
  leadId: string,
): Promise<boolean> {
  const { data: jobs, error } = await supabase
    .from("lead_jobs")
    .select("id, due_at, assigned_name, sequence, position")
    .eq("lead_id", leadId)
    .eq("queue", "call")
    .eq("status", "pending")
    .order("due_at", { ascending: true })
    .limit(20);
  if (error) throw new Error(error.message);
  if (!jobs?.length) return false;
  const next = jobs[0];
  const nextDue = new Date(String(next.due_at)).getTime();
  if (!Number.isFinite(nextDue) || nextDue <= Date.now() + MAX_NEXT_CALL_WAIT_MS) return false;

  const { data: lead } = await supabase
    .from("leads")
    .select("id, created_at, priority, agreement_status, agreement_sent_at")
    .eq("id", leadId)
    .maybeSingle();
  const priority = Boolean(lead?.priority) || next.sequence === "want_to_sign";
  const pulled = scheduleCallback({
    from: new Date(),
    window: "morning",
    index: 0,
    contactAt: lead?.created_at ? new Date(lead.created_at) : null,
    priority,
    varyKey: `${leadId}:pull:${next.id}`,
  });
  const delta = new Date(pulled).getTime() - nextDue;
  if (delta >= 0) return false;
  for (const job of jobs) {
    const due = new Date(String(job.due_at)).getTime() + delta;
    const { error: updateError } = await supabase
      .from("lead_jobs")
      .update({ due_at: new Date(due).toISOString() })
      .eq("id", job.id)
      .eq("status", "pending");
    if (updateError) throw new Error(updateError.message);
  }
  return true;
}

const FOLLOW_UP_COLUMNS =
  "id, kind, follow_up, lead_name, case_type, signed_case, case_id, lead_status, caller_class, arrival, owner_name, agreement_status, agreement_sent_at, agreement_reminder_count, agreement_next_reminder_at, priority, created_at, consultation_date, lead_date, phone, phone_e164";

export async function enrollMissingFollowUps(supabase: SupabaseClient) {
  const [{ data, error }, { data: contractLeads, error: contractError }] = await Promise.all([
    supabase
      .from("leads")
      .select(FOLLOW_UP_COLUMNS)
      .eq("follow_up", true)
      .eq("test", false)
      .or("caller_class.is.null,caller_class.eq.non_pi")
      .or("and(signed_case.eq.false,case_id.is.null,lead_status.not.in.(Lost,Referred,Promoted,Signed)),phone_e164.eq.+17654183805")
      .order("created_at", { ascending: false })
      .limit(80),
    supabase
      .from("leads")
      .select(FOLLOW_UP_COLUMNS)
      .eq("follow_up", true)
      .eq("test", false)
      .or("caller_class.is.null,caller_class.eq.non_pi")
      .eq("signed_case", false)
      .is("case_id", null)
      .not("lead_status", "in", "(Lost,Referred,Promoted,Signed)")
      .in("agreement_status", ["sent", "viewed"])
      .order("agreement_sent_at", { ascending: false })
      .limit(40),
  ]);
  if (error) throw new Error(error.message);
  if (contractError) throw new Error(contractError.message);

  const byId = new Map<string, LeadBits>();
  for (const lead of [...((contractLeads ?? []) as LeadBits[]), ...((data ?? []) as LeadBits[])]) byId.set(lead.id, lead);
  const leads = [...byId.values()];
  if (!leads.length) return 0;
  const { data: existing, error: jobsError } = await supabase
    .from("lead_jobs")
    .select("lead_id, sequence")
    .eq("queue", "call")
    .eq("status", "pending")
    .gt("due_at", new Date().toISOString())
    .in(
      "lead_id",
      leads.map((lead) => lead.id),
    );
  if (jobsError) throw new Error(jobsError.message);
  const pendingSequences = new Map<string, Set<string>>();
  for (const job of existing ?? []) {
    const sequences = pendingSequences.get(String(job.lead_id)) ?? new Set<string>();
    if (job.sequence) sequences.add(String(job.sequence));
    pendingSequences.set(String(job.lead_id), sequences);
  }

  let enrolled = 0;
  for (const lead of leads) {
    const sequence = sequenceForLead(lead, "auto");
    const pending = pendingSequences.get(lead.id);
    if (sequence && pending?.size === 1 && pending.has(sequence)) {
      await pullForwardStaleCallJobs(supabase, lead.id);
      continue;
    }
    await enrollFollowUp(supabase, lead);
    enrolled += 1;
    if (enrolled >= 40) break;
  }
  return enrolled;
}

export type FollowUpState = "Not enrolled" | "Scheduled" | "Active" | "Paused" | "Completed" | "Failed";

export function describeFollowUp(
  lead: { follow_up: boolean },
  jobs: { queue: string; status: string; due_at: string; detail?: string | null; position: number; body: string }[],
): { state: FollowUpState; nextCall: string | null; reason: string | null } {
  const failed = jobs.find((job) => job.status === "failed");
  const pending = jobs.filter((job) => job.status === "pending");
  const nextCall = [...pending]
    .filter((job) => job.queue === "call")
    .sort((a, b) => a.due_at.localeCompare(b.due_at))[0];
  const nextCallLabel = nextCall ? `${formatChicago(nextCall.due_at)} — ${nextCall.body}` : null;

  if (failed) {
    return {
      state: "Failed",
      nextCall: nextCallLabel,
      reason: failed.detail?.trim() || "A step failed.",
    };
  }
  if (!lead.follow_up && jobs.length === 0) {
    return { state: "Not enrolled", nextCall: null, reason: "Follow-up is off." };
  }
  if (!lead.follow_up) {
    return {
      state: "Paused",
      nextCall: nextCallLabel,
      reason: pending.length ? "Follow-up is off, and steps are still pending." : "Follow-up is off.",
    };
  }
  if (jobs.length === 0) {
    return {
      state: "Not enrolled",
      nextCall: null,
      reason: "Follow-up is on, but no steps were created.",
    };
  }
  if (!pending.length) {
    return { state: "Completed", nextCall: null, reason: null };
  }
  const due = pending.some((job) => new Date(job.due_at).getTime() <= Date.now());
  return { state: due ? "Active" : "Scheduled", nextCall: nextCallLabel, reason: null };
}

export async function stopFollowUp(supabase: SupabaseClient, leadId: string, reason: string) {
  await supabase
    .from("lead_jobs")
    .update({ status: "skipped", detail: reason })
    .eq("lead_id", leadId)
    .eq("status", "pending");
}

const PARKED_CALLER_CLASSES = [...EXCLUDED_CALLER_CLASSES, DATA_ERROR_CLASS] as const;

/**
 * Quo can park a file in Non-leads (caller_class) without running Move to non-leads.
 * Pending call jobs kept firing Slack "Call due" until follow-up was stopped here.
 */
export async function stopParkedFollowUps(supabase: SupabaseClient): Promise<number> {
  const parkedFilter = `caller_class.in.(${PARKED_CALLER_CLASSES.join(",")}),lead_status.in.(Lost,Referred,Promoted,Signed),signed_case.eq.true,case_id.not.is.null`;
  const { data: stillFollowing, error } = await supabase
    .from("leads")
    .select("id, phone, phone_e164")
    .eq("test", false)
    .eq("follow_up", true)
    .or(parkedFilter)
    .limit(200);
  if (error) throw new Error(error.message);

  const { data: pendingJobs, error: jobsError } = await supabase
    .from("lead_jobs")
    .select("lead_id, leads!inner(id, caller_class, lead_status, signed_case, case_id, phone, phone_e164, test)")
    .eq("status", "pending")
    .eq("leads.test", false)
    .limit(200);
  if (jobsError) throw new Error(jobsError.message);

  const { data: stillTexting, error: textError } = await supabase
    .from("leads")
    .select("id, phone, phone_e164")
    .eq("test", false)
    .eq("text_sequence_status", "active")
    .or(parkedFilter)
    .limit(200);
  if (textError) throw new Error(textError.message);

  const byId = new Map<string, { phone: string | null }>();
  for (const lead of stillFollowing ?? []) {
    if (isPracticeTestPhone(lead.phone_e164 || lead.phone)) continue;
    byId.set(String(lead.id), { phone: lead.phone_e164 || lead.phone });
  }
  for (const job of pendingJobs ?? []) {
    const lead = job.leads as unknown as LeadBits & { test?: boolean | null };
    if (!lead || isPracticeTestPhone(lead.phone_e164 || lead.phone)) continue;
    if (!closedLead(lead)) continue;
    byId.set(String(lead.id), { phone: lead.phone_e164 || lead.phone });
  }
  for (const lead of stillTexting ?? []) {
    if (isPracticeTestPhone(lead.phone_e164 || lead.phone)) continue;
    byId.set(String(lead.id), { phone: lead.phone_e164 || lead.phone });
  }
  if (!byId.size) return 0;

  let stopped = 0;
  for (const [leadId, { phone }] of byId) {
    await stopFollowUp(supabase, leadId, "Closed or not a lead. Call sequence stopped.");
    const e164 = phone ? toE164(phone) || phone : null;
    if (e164) await stopSmsFollowUp(e164, "intake-manager:closed").catch(() => ({ ok: false }));
    const { error: updateError } = await supabase
      .from("leads")
      .update({
        follow_up: false,
        sequence: "stop",
        text_sequence_status: "stopped",
        text_next_at: null,
      })
      .eq("id", leadId);
    if (updateError) throw new Error(updateError.message);
    stopped += 1;
  }
  return stopped;
}
