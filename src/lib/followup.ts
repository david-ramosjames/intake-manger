import type { SupabaseClient } from "@supabase/supabase-js";
import { scheduleCallback } from "./callbacks";
import { contractSent } from "./desired";
import type { LeadKind } from "./leads";
import { type CallSequenceId, type WorkHours } from "./sequences";
import { formatChicago } from "./time";

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
  priority?: boolean | null;
  created_at?: string | null;
  consultation_date?: string | null;
};

export function renderStep(body: string, lead: { lead_name: string | null; case_type: string | null }): string {
  const name = lead.lead_name?.trim().split(/\s+/)[0] || "there";
  const caseType = lead.case_type?.trim() || "case";
  return body.replaceAll("{{name}}", name).replaceAll("{{case_type}}", caseType);
}

function closedLead(lead: LeadBits): boolean {
  return lead.signed_case || Boolean(lead.case_id) || ["Lost", "Referred", "Promoted", "Signed"].includes(lead.lead_status);
}

export function sequenceForLead(lead: LeadBits, manual: "post_consult" | "auto"): CallSequenceId | null {
  if (closedLead(lead)) return null;
  if (contractSent(lead)) return "want_to_sign";
  if (manual === "post_consult") return "more_info";
  if (lead.arrival === "missed" || lead.arrival === "form") return "first_talk";
  return null;
}

function proposedCaller(sequence: CallSequenceId, position: number, owner: string | null | undefined): string | null {
  if (!owner) return null;
  if (sequence === "want_to_sign") return owner;
  if (sequence === "more_info" && position <= 2) return owner;
  return null;
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
    .select("queue, position, delay_minutes, body")
    .eq("sequence", sequence)
    .eq("queue", "call")
    .order("position");
  if (error) throw new Error(error.message);
  if (!steps?.length) return;

  const priority = Boolean(lead.priority) || sequence === "want_to_sign";
  const contactAt = lead.created_at ? new Date(lead.created_at) : null;
  const now = Date.now();
  const rows = (steps ?? []).map((step) => {
    const position = step.position as number;
    const from = new Date(now + Number(step.delay_minutes) * 60_000);
    const caller = proposedCaller(sequence, position, lead.owner_name);
    return {
      lead_id: lead.id,
      queue: step.queue as string,
      position,
      due_at: scheduleCallback({
        from,
        index: Math.max(0, position - 1),
        contactAt,
        priority,
        varyKey: `${lead.id}:${position}`,
      }),
      body: renderStep(String(step.body), lead),
      assigned_name: caller,
      detail: caller && sequence === "want_to_sign" ? `Proposed owner: ${caller}. Change the tag if someone else should call.` : null,
    };
  });
  if (!rows.length) return;
  const { error: insertError } = await supabase.from("lead_jobs").upsert(rows, {
    onConflict: "lead_id,queue,position",
    ignoreDuplicates: true,
  });
  if (insertError) throw new Error(insertError.message);
  void hoursBySequence;
}

export async function enrollMissingFollowUps(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("leads")
    .select("id, kind, follow_up, lead_name, case_type, signed_case, case_id, lead_status, arrival, owner_name, agreement_status, agreement_sent_at, priority, created_at")
    .eq("signed_case", false)
    .is("case_id", null)
    .not("lead_status", "in", "(Lost,Referred,Promoted,Signed)")
    .or("agreement_sent_at.not.is.null,agreement_status.in.(sent,viewed)")
    .order("agreement_sent_at", { ascending: false, nullsFirst: false })
    .limit(20);
  if (error) throw new Error(error.message);

  const leads = ((data ?? []) as LeadBits[]).filter((lead) => contractSent(lead));
  if (!leads.length) return 0;
  const { data: existing, error: jobsError } = await supabase
    .from("lead_jobs")
    .select("lead_id")
    .eq("queue", "call")
    .in(
      "lead_id",
      leads.map((lead) => lead.id),
    );
  if (jobsError) throw new Error(jobsError.message);
  const started = new Set((existing ?? []).map((job) => String(job.lead_id)));

  let enrolled = 0;
  for (const lead of leads) {
    if (started.has(lead.id)) continue;
    await enrollFollowUp(supabase, { ...lead, follow_up: true });
    enrolled += 1;
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
