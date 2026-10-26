import type { SupabaseClient } from "@supabase/supabase-js";
import { chicagoMinute, scheduleCallback } from "./callbacks";
import { isPlaceholderOwner } from "./talked-with";
import { contractOutstanding } from "./desired";
import { nameIsUnavailable, type LeadKind } from "./leads";
import { type CallSequenceId, type WorkHours } from "./sequences";
import { chicagoLocalToIso, formatChicago } from "./time";
import { isPracticeTestPhone } from "./test-phone";

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
  if (lead.caller_class && lead.caller_class !== "non_pi") return true;
  return lead.signed_case || Boolean(lead.case_id) || ["Lost", "Referred", "Promoted", "Signed"].includes(lead.lead_status);
}

export function sequenceForLead(lead: LeadBits, manual: "post_consult" | "auto"): CallSequenceId | null {
  if (closedLead(lead)) return null;
  if (contractOutstanding(lead)) return "want_to_sign";
  if (
    manual === "post_consult" ||
    lead.consultation_date ||
    lead.arrival === "human_call" ||
    lead.arrival === "qualified_call" ||
    lead.arrival === "sona"
  ) {
    return "more_info";
  }
  return "first_talk";
}

function proposedCaller(
  _sequence: CallSequenceId,
  _position: number,
  owner: string | null | undefined,
  consultation: boolean,
): string | null {
  const name = owner?.trim() ?? "";
  if (isPlaceholderOwner(name) || !consultation) return null;
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
  const usedByDay = new Map<number, number[]>();
  const rows = (steps ?? []).flatMap((step) => {
    const position = step.position as number;
    const delay = Number(step.delay_minutes);
    const from = new Date(dayOne + delay * 60_000);
    const caller = proposedCaller(sequence, position, lead.owner_name, Boolean(lead.consultation_date));
    const dueAt = scheduleCallback({
      from,
      window: typeof step.callback_window === "string" ? step.callback_window : null,
      index: Math.max(0, position - 1),
      contactAt,
      priority,
      varyKey: `${lead.id}:${position}`,
      avoid: usedByDay.get(delay) ?? [],
    });
    const minute = chicagoMinute(dueAt);
    if (minute != null) {
      const taken = usedByDay.get(delay) ?? [];
      taken.push(minute);
      usedByDay.set(delay, taken);
    }
    if (new Date(dueAt).getTime() < Date.now() - 5 * 60_000) return [];
    return [{
      lead_id: lead.id,
      queue: step.queue as string,
      sequence,
      position,
      due_at: dueAt,
      body: renderStep(String(step.body), lead),
      assigned_name: caller,
      detail: caller && sequence === "want_to_sign"
        ? `Proposed owner: ${caller}. Change the tag if someone else should call.`
        : caller && sequence === "more_info" && lead.consultation_date
          ? `Tag ${caller}.`
          : null,
    }];
  });
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
  const { error: insertError } = await supabase.from("lead_jobs").upsert(rows, {
    onConflict: "lead_id,queue,sequence,position",
    ignoreDuplicates: true,
  });
  if (insertError) throw new Error(insertError.message);
  void hoursBySequence;
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
    if (sequence && pending?.size === 1 && pending.has(sequence)) continue;
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
