import type { SupabaseClient } from "@supabase/supabase-js";
import { CLOSE_READY_COLUMNS, closeGaps } from "./close-ready";
import { isPracticeTestPhone } from "./test-phone";

export const CLOSED_LEAD_STATUSES = ["Signed", "Promoted", "Lost", "Referred"] as const;

export type CloseSuggestion = "decline" | "not_interested" | "not_a_lead";

export const CLOSE_SUGGESTION_LABEL: Record<CloseSuggestion, string> = {
  decline: "Decline or refer",
  not_interested: "No longer interested",
  not_a_lead: "Not a lead",
};

/** Staff-marked lost lead (details panel) — the other way to close besides signed. */
export const LOST_LEAD_REASONS = {
  signed_elsewhere: "Signed elsewhere",
  not_interested: "No longer interested",
  no_response: "Unresponsive",
} as const;

export type LostLeadReason = keyof typeof LOST_LEAD_REASONS;

export function isLostLeadReason(value: string | null | undefined): value is LostLeadReason {
  return Boolean(value && value in LOST_LEAD_REASONS);
}

export function isCloseSuggestion(value: string | null | undefined): value is CloseSuggestion {
  return value === "decline" || value === "not_interested" || value === "not_a_lead";
}

export function isLeadOpen(status: string | null | undefined): boolean {
  return !CLOSED_LEAD_STATUSES.includes(status as (typeof CLOSED_LEAD_STATUSES)[number]);
}

const CLOSED_LIST = "(Signed,Promoted,Lost,Referred)";

/** The office lines are shared. A second row there is not the same client. */
const SHARED_LINES = new Set([
  "+15125373369",
  "+19563137771",
  "+15126010647",
  "+15125005266",
  "+15126300907",
]);

/** Signing closes the lead. A finished call sequence, or a finished Sign Flow reminder series, closes it too. */
export async function closeFinishedLeads(
  supabase: SupabaseClient,
): Promise<{ signed: number; expired: number; signSeries: number; merged: number }> {
  const merged = await mergeDuplicatePhones(supabase);
  const signed = await closeSignedLeads(supabase);
  const expired = await closeExpiredSequences(supabase);
  const signSeries = await closeExhaustedSignSeries(supabase);
  return { signed, expired, signSeries, merged };
}

/** Sign Flow's default contract series is six reminders. Count 6 with no next reminder means it finished, including after the request is cancelled. */
const SIGN_SERIES_LENGTH = 6;

async function closeExhaustedSignSeries(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase
    .from("leads")
    .select(`id, ${CLOSE_READY_COLUMNS}`)
    .in("agreement_status", ["sent", "viewed", "cancelled", "expired"])
    .is("agreement_next_reminder_at", null)
    .gte("agreement_reminder_count", SIGN_SERIES_LENGTH)
    .eq("signed_case", false)
    .is("case_id", null)
    .not("lead_status", "in", CLOSED_LIST);
  if (error) throw new Error(error.message);
  const rows = (data ?? []).filter(
    (row) => !isPracticeTestPhone(String(row.phone_e164 || row.phone || "")) && closeGaps(row).length === 0,
  );
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
  return ids.length;
}

type MergeLead = {
  id: string;
  phone_e164: string | null;
  signed_case: boolean | null;
  case_id: string | null;
  lead_status: string | null;
  agreement_signing_url: string | null;
  case_type: string | null;
  case_detail: string | null;
  lead_name: string | null;
  email: string | null;
  summary: string | null;
  quo_link: string | null;
  slack_permalink: string | null;
  slack_channel_id: string | null;
  slack_message_ts: string | null;
  slack_thread_ts: string | null;
  created_at: string;
};

function keeperFirst(left: MergeLead, right: MergeLead): number {
  const rank = (row: MergeLead) => {
    const signed = row.signed_case || row.case_id || row.lead_status === "Signed" || row.lead_status === "Promoted";
    return [
      signed ? 0 : 1,
      row.agreement_signing_url ? 0 : 1,
      String(row.case_type || "").trim() ? 0 : 1,
    ];
  };
  const a = rank(left);
  const b = rank(right);
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return right.created_at.localeCompare(left.created_at);
}

function blank(value: string | null | undefined): string | null {
  const text = String(value || "").trim();
  return text && text !== "null" ? text : null;
}

/** One phone is one lead. A later call keeps the record that already has the contract, the case, or the newer facts. */
async function mergeDuplicatePhones(supabase: SupabaseClient): Promise<number> {
  const since = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recent, error } = await supabase
    .from("leads")
    .select("phone_e164")
    .gte("created_at", since)
    .not("phone_e164", "is", null)
    .limit(1000);
  if (error) throw new Error(error.message);
  const phones = [...new Set((recent ?? []).map((row) => String(row.phone_e164 || "")).filter((phone) => phone && !SHARED_LINES.has(phone) && !isPracticeTestPhone(phone)))];
  if (!phones.length) return 0;

  const { data, error: rowsError } = await supabase
    .from("leads")
    .select("id, phone_e164, signed_case, case_id, lead_status, agreement_signing_url, case_type, case_detail, lead_name, email, summary, quo_link, slack_permalink, slack_channel_id, slack_message_ts, slack_thread_ts, created_at")
    .in("phone_e164", phones);
  if (rowsError) throw new Error(rowsError.message);

  const groups = new Map<string, MergeLead[]>();
  for (const row of (data ?? []) as MergeLead[]) {
    const phone = String(row.phone_e164 || "");
    const list = groups.get(phone) ?? [];
    list.push(row);
    groups.set(phone, list);
  }

  let count = 0;
  for (const [phone, rows] of groups) {
    if (rows.length < 2) continue;
    const [keeper, ...duplicates] = [...rows].sort(keeperFirst);
    for (const duplicate of duplicates) {
      await foldLead(supabase, phone, keeper, duplicate);
      count += 1;
    }
  }
  return count;
}

async function foldLead(supabase: SupabaseClient, phone: string, keeper: MergeLead, duplicate: MergeLead): Promise<void> {
  const detail = blank(duplicate.case_detail);
  const keeperDetail = blank(keeper.case_detail);
  let caseDetail = keeper.case_detail;
  if (detail && !keeperDetail) caseDetail = detail;
  else if (detail && keeperDetail && !keeperDetail.includes(detail)) caseDetail = `${keeperDetail}\n\n${detail}`.slice(-15000);

  const patch: Record<string, string | null> = {};
  if (caseDetail !== keeper.case_detail) patch.case_detail = caseDetail;
  if (!blank(keeper.case_type) && blank(duplicate.case_type)) patch.case_type = blank(duplicate.case_type);
  if (!blank(keeper.lead_name) && blank(duplicate.lead_name)) patch.lead_name = blank(duplicate.lead_name);
  if (!blank(keeper.email) && blank(duplicate.email)) patch.email = blank(duplicate.email);
  if (!blank(keeper.summary) && blank(duplicate.summary)) patch.summary = blank(duplicate.summary);
  if (!blank(keeper.quo_link) && blank(duplicate.quo_link)) patch.quo_link = blank(duplicate.quo_link);
  if (!blank(keeper.slack_permalink) && blank(duplicate.slack_permalink)) patch.slack_permalink = blank(duplicate.slack_permalink);
  if (!blank(keeper.slack_thread_ts) && blank(duplicate.slack_thread_ts)) patch.slack_thread_ts = blank(duplicate.slack_thread_ts);
  if (!keeper.slack_message_ts && duplicate.slack_channel_id && duplicate.slack_message_ts) {
    const channelId = duplicate.slack_channel_id;
    const messageTs = duplicate.slack_message_ts;
    const threadTs = duplicate.slack_thread_ts;
    const { count, error } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("slack_channel_id", channelId)
      .eq("slack_message_ts", messageTs)
      .neq("id", duplicate.id);
    if (error) throw new Error(error.message);
    if (!count) {
      // Clear the duplicate first. The unique index is on channel + message ts, so
      // copying while the duplicate still holds that pair fails the update.
      const { error: clearError } = await supabase
        .from("leads")
        .update({ slack_channel_id: null, slack_message_ts: null, slack_thread_ts: null })
        .eq("id", duplicate.id);
      if (clearError) throw new Error(clearError.message);
      duplicate.slack_channel_id = null;
      duplicate.slack_message_ts = null;
      duplicate.slack_thread_ts = null;
      patch.slack_channel_id = channelId;
      patch.slack_message_ts = messageTs;
      if (!blank(keeper.slack_thread_ts) && blank(threadTs)) {
        patch.slack_thread_ts = blank(threadTs);
      }
    }
  }
  if (Object.keys(patch).length) {
    const { error } = await supabase.from("leads").update(patch).eq("id", keeper.id);
    if (error) throw new Error(error.message);
    Object.assign(keeper, patch);
  }

  for (const table of ["lead_events", "slack_posts", "referral_sends", "call_attempts", "intake_interactions", "lead_channel_posts"] as const) {
    const { error } = await supabase.from(table).update({ lead_id: keeper.id }).eq("lead_id", duplicate.id);
    if (error) throw new Error(error.message);
  }

  const { data: jobs, error: jobsError } = await supabase
    .from("lead_jobs")
    .select("id, lead_id, queue, sequence, position")
    .in("lead_id", [keeper.id, duplicate.id]);
  if (jobsError) throw new Error(jobsError.message);
  const taken = new Set(
    (jobs ?? [])
      .filter((job) => job.lead_id === keeper.id)
      .map((job) => `${job.queue}|${job.sequence ?? ""}|${job.position}`),
  );
  const blocked = (jobs ?? [])
    .filter((job) => job.lead_id === duplicate.id && taken.has(`${job.queue}|${job.sequence ?? ""}|${job.position}`))
    .map((job) => job.id as string);
  if (blocked.length) {
    const { error } = await supabase.from("lead_jobs").delete().in("id", blocked);
    if (error) throw new Error(error.message);
  }
  const { error: moveError } = await supabase.from("lead_jobs").update({ lead_id: keeper.id }).eq("lead_id", duplicate.id);
  if (moveError) throw new Error(moveError.message);

  const { error: eventError } = await supabase.from("lead_events").insert({
    lead_id: keeper.id,
    event_type: "merged",
    actor: "intake-manager",
    payload: { duplicate_id: duplicate.id, phone },
  });
  if (eventError) throw new Error(eventError.message);

  const { error: deleteError } = await supabase.from("leads").delete().eq("id", duplicate.id);
  if (deleteError) throw new Error(deleteError.message);
}

async function closeSignedLeads(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase
    .from("leads")
    .select(`id, ${CLOSE_READY_COLUMNS}`)
    .eq("signed_case", true)
    .not("lead_status", "in", CLOSED_LIST)
    .not("phone_e164", "eq", "+17654183805");
  if (error) throw new Error(error.message);
  const ids = (data ?? [])
    .filter((row) => !isPracticeTestPhone(String(row.phone_e164 || row.phone || "")) && closeGaps(row).length === 0)
    .map((row) => row.id as string);
  if (!ids.length) return 0;
  const { error: closeError } = await supabase
    .from("leads")
    .update({
      lead_status: "Signed",
      follow_up: false,
      sequence: "stop",
      close_reason: "signed",
      close_suggestion: null,
    })
    .in("id", ids)
    .not("lead_status", "in", CLOSED_LIST);
  if (closeError) throw new Error(closeError.message);
  if (ids.length) {
    await supabase.from("lead_jobs").update({ status: "skipped", detail: "Signed" }).in("lead_id", ids).eq("status", "pending");
  }
  return ids.length;
}

async function closeExpiredSequences(supabase: SupabaseClient): Promise<number> {
  const { data: leads, error } = await supabase
    .from("leads")
    .select(`id, ${CLOSE_READY_COLUMNS}`)
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
