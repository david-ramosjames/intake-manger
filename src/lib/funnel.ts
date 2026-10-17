import type { SupabaseClient } from "@supabase/supabase-js";
import { isPracticeTestPhone } from "./test-phone";

export const CLOSED_LEAD_STATUSES = ["Signed", "Promoted", "Lost", "Referred"] as const;

export type CloseSuggestion = "decline" | "not_interested" | "not_a_lead";

export const CLOSE_SUGGESTION_LABEL: Record<CloseSuggestion, string> = {
  decline: "Decline or refer",
  not_interested: "No longer interested",
  not_a_lead: "Not a lead",
};

export function isCloseSuggestion(value: string | null | undefined): value is CloseSuggestion {
  return value === "decline" || value === "not_interested" || value === "not_a_lead";
}

export function isLeadOpen(status: string | null | undefined): boolean {
  return !CLOSED_LEAD_STATUSES.includes(status as (typeof CLOSED_LEAD_STATUSES)[number]);
}

const CLOSED_LIST = "(Signed,Promoted,Lost,Referred)";

/** Signing closes the lead. A finished call sequence, or a finished Sign Flow reminder series, closes it too. */
export async function closeFinishedLeads(
  supabase: SupabaseClient,
): Promise<{ signed: number; expired: number; signSeries: number }> {
  const signed = await closeSignedLeads(supabase);
  const expired = await closeExpiredSequences(supabase);
  const signSeries = await closeExhaustedSignSeries(supabase);
  return { signed, expired, signSeries };
}

/** Sign Flow's default contract series is six reminders. Count 6 with no next reminder means it finished, including after the request is cancelled. */
const SIGN_SERIES_LENGTH = 6;

async function closeExhaustedSignSeries(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase
    .from("leads")
    .select("id, phone, phone_e164, callrail_tags")
    .in("agreement_status", ["sent", "viewed", "cancelled", "expired"])
    .is("agreement_next_reminder_at", null)
    .gte("agreement_reminder_count", SIGN_SERIES_LENGTH)
    .eq("signed_case", false)
    .is("case_id", null)
    .not("lead_status", "in", CLOSED_LIST);
  if (error) throw new Error(error.message);
  const rows = (data ?? []).filter((row) => !isPracticeTestPhone(String(row.phone_e164 || row.phone || "")));
  if (!rows.length) return 0;
  const ids = rows.map((row) => row.id as string);
  const { error: closeError } = await supabase
    .from("leads")
    .update({
      lead_status: "Lost",
      follow_up: false,
      sequence: "stop",
      close_reason: "no_response",
      close_suggestion: null,
    })
    .in("id", ids)
    .not("lead_status", "in", CLOSED_LIST);
  if (closeError) throw new Error(closeError.message);
  await supabase
    .from("lead_jobs")
    .update({ status: "skipped", detail: "Sign Flow reminder series finished with no signature." })
    .in("lead_id", ids)
    .eq("status", "pending");
  for (const row of rows) {
    const tags = ((row.callrail_tags as string[] | null) ?? []).filter((tag) => tag !== "QUALIFIED YES" && tag !== "CVR DESIRED");
    if (!tags.includes("QUALIFIED NO")) tags.push("QUALIFIED NO");
    if (!tags.includes("NQ: Unresponsive")) tags.push("NQ: Unresponsive");
    await supabase.from("leads").update({ callrail_tags: tags, qualified: false, desired_case: false, desired_source: "staff" }).eq("id", row.id);
  }
  return ids.length;
}

async function closeSignedLeads(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase
    .from("leads")
    .update({
      lead_status: "Signed",
      follow_up: false,
      sequence: "stop",
      close_reason: "signed",
      close_suggestion: null,
    })
    .eq("signed_case", true)
    .not("lead_status", "in", CLOSED_LIST)
    .not("phone_e164", "eq", "+17654183805")
    .select("id");
  if (error) throw new Error(error.message);
  const ids = (data ?? []).map((row) => row.id as string);
  if (ids.length) {
    await supabase.from("lead_jobs").update({ status: "skipped", detail: "Signed" }).in("lead_id", ids).eq("status", "pending");
  }
  return ids.length;
}

async function closeExpiredSequences(supabase: SupabaseClient): Promise<number> {
  const { data: leads, error } = await supabase
    .from("leads")
    .select("id, phone, phone_e164, callrail_tags")
    .not("lead_status", "in", CLOSED_LIST)
    .eq("signed_case", false)
    .is("case_id", null)
    .is("close_suggestion", null)
    .order("created_at", { ascending: true })
    .limit(60);
  if (error) throw new Error(error.message);
  const ids = (leads ?? [])
    .filter((row) => !isPracticeTestPhone(String(row.phone_e164 || row.phone || "")))
    .map((row) => row.id as string);
  if (!ids.length) return 0;

  const { data: jobs, error: jobsError } = await supabase
    .from("lead_jobs")
    .select("lead_id, status, queue, due_at, created_at")
    .in("lead_id", ids);
  if (jobsError) throw new Error(jobsError.message);

  const byLead = new Map<string, { status: string; queue: string; due_at: string; created_at: string }[]>();
  for (const job of jobs ?? []) {
    const leadId = String(job.lead_id);
    const list = byLead.get(leadId) ?? [];
    list.push(job as { status: string; queue: string; due_at: string; created_at: string });
    byLead.set(leadId, list);
  }

  const now = Date.now();
  const finished: { id: string; started: string }[] = [];
  for (const id of ids) {
    const steps = byLead.get(id) ?? [];
    const calls = steps.filter((step) => step.queue === "call");
    if (!calls.length) continue;
    if (calls.some((step) => step.status === "pending" || step.status === "failed")) continue;
    const latestDue = Math.max(...calls.map((step) => new Date(step.due_at).getTime()));
    if (latestDue > now) continue;
    const started = calls.reduce((earliest, step) => (step.created_at < earliest ? step.created_at : earliest), calls[0].created_at);
    finished.push({ id, started });
  }
  if (!finished.length) return 0;

  const { data: touches, error: touchError } = await supabase
    .from("intake_interactions")
    .select("lead_id, occurred_at, type, direction")
    .in(
      "lead_id",
      finished.map((row) => row.id),
    )
    .eq("direction", "inbound")
    .limit(2000);
  if (touchError) throw new Error(touchError.message);

  const replied = new Set<string>();
  const startByLead = new Map(finished.map((row) => [row.id, row.started]));
  for (const touch of touches ?? []) {
    const leadId = String(touch.lead_id ?? "");
    const started = startByLead.get(leadId);
    const type = String(touch.type ?? "").toLowerCase();
    if (!started || !touch.occurred_at || touch.occurred_at < started) continue;
    if (type === "call" || type === "sona_call" || type === "text" || type === "email") replied.add(leadId);
  }

  const closing = finished.filter((row) => !replied.has(row.id)).map((row) => row.id);
  if (!closing.length) return 0;
  const { error: closeError } = await supabase
    .from("leads")
    .update({
      lead_status: "Lost",
      follow_up: false,
      sequence: "stop",
      close_reason: "no_response",
      close_suggestion: null,
    })
    .in("id", closing)
    .not("lead_status", "in", CLOSED_LIST);
  if (closeError) throw new Error(closeError.message);
  for (const row of leads ?? []) {
    if (!closing.includes(String(row.id))) continue;
    const tags = ((row.callrail_tags as string[] | null) ?? []).filter((tag) => tag !== "QUALIFIED YES" && tag !== "CVR DESIRED");
    if (!tags.includes("QUALIFIED NO")) tags.push("QUALIFIED NO");
    if (!tags.includes("NQ: Unresponsive")) tags.push("NQ: Unresponsive");
    await supabase.from("leads").update({ callrail_tags: tags, qualified: false, desired_case: false, desired_source: "staff" }).eq("id", row.id);
  }
  return closing.length;
}
