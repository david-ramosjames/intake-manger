import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeadKind } from "./leads";

type LeadBits = {
  id: string;
  kind: LeadKind;
  follow_up: boolean;
  lead_name: string | null;
  case_type: string | null;
  signed_case: boolean;
  case_id: string | null;
  lead_status: string;
};

export function renderStep(body: string, lead: { lead_name: string | null; case_type: string | null }): string {
  const name = lead.lead_name?.trim().split(/\s+/)[0] || "there";
  const caseType = lead.case_type?.trim() || "case";
  return body.replaceAll("{{name}}", name).replaceAll("{{case_type}}", caseType);
}

export async function enrollFollowUp(supabase: SupabaseClient, lead: LeadBits) {
  if (!lead.follow_up) return;
  if (lead.signed_case || lead.case_id) return;
  if (lead.lead_status === "Lost" || lead.lead_status === "Referred" || lead.lead_status === "Promoted") return;

  const queues = ["call"];
  const { data: steps, error } = await supabase
    .from("sequence_steps")
    .select("queue, position, delay_minutes, body")
    .in("queue", queues)
    .order("position");
  if (error) throw new Error(error.message);
  if (!steps?.length) throw new Error("The sequence has no steps, so follow-up could not start.");

  const now = Date.now();
  const rows = (steps ?? []).map((step) => ({
    lead_id: lead.id,
    queue: step.queue as string,
    position: step.position as number,
    due_at: new Date(now + Number(step.delay_minutes) * 60_000).toISOString(),
    body: renderStep(String(step.body), lead),
  }));
  if (!rows.length) return;
  const { error: insertError } = await supabase.from("lead_jobs").upsert(rows, {
    onConflict: "lead_id,queue,position",
    ignoreDuplicates: true,
  });
  if (insertError) throw new Error(insertError.message);

  if (lead.kind === "needs_info") {
    await supabase
      .from("lead_jobs")
      .update({ status: "skipped", detail: "Need-more-info leads are calls only." })
      .eq("lead_id", lead.id)
      .eq("queue", "text")
      .eq("status", "pending");
  }
}

export async function enrollMissingFollowUps(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("leads")
    .select("id, kind, follow_up, lead_name, case_type, signed_case, case_id, lead_status")
    .eq("follow_up", true)
    .eq("signed_case", false)
    .is("case_id", null)
    .not("lead_status", "in", "(Lost,Referred,Promoted,Signed)")
    .order("created_at", { ascending: false })
    .limit(80);
  if (error) throw new Error(error.message);

  const leads = (data ?? []) as LeadBits[];
  if (!leads.length) return 0;
  const { data: existing, error: jobsError } = await supabase
    .from("lead_jobs")
    .select("lead_id")
    .in(
      "lead_id",
      leads.map((lead) => lead.id),
    );
  if (jobsError) throw new Error(jobsError.message);
  const started = new Set((existing ?? []).map((job) => String(job.lead_id)));

  let enrolled = 0;
  for (const lead of leads) {
    if (started.has(lead.id)) continue;
    await enrollFollowUp(supabase, lead);
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
  const nextCallLabel = nextCall
    ? `${new Date(nextCall.due_at).toLocaleString()} — ${nextCall.body}`
    : null;

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
