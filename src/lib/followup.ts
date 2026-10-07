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

  const queues = lead.kind === "needs_info" ? ["call"] : ["text", "call"];
  const { data: steps, error } = await supabase
    .from("sequence_steps")
    .select("queue, position, delay_minutes, body")
    .in("queue", queues)
    .order("position");
  if (error) throw new Error(error.message);

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

export async function stopFollowUp(supabase: SupabaseClient, leadId: string, reason: string) {
  await supabase
    .from("lead_jobs")
    .update({ status: "skipped", detail: reason })
    .eq("lead_id", leadId)
    .eq("status", "pending");
}
