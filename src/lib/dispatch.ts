import type { SupabaseClient } from "@supabase/supabase-js";
import { LEAD_CHANNEL_ID, postToSlack } from "./slack";

type Job = {
  id: string;
  lead_id: string;
  queue: "text" | "call";
  body: string;
  due_at: string;
  notified_at: string | null;
};

type SlackPost = {
  id: string;
  lead_id: string;
  body: string;
  mention: string | null;
};

type LeadRow = {
  id: string;
  lead_name: string | null;
  phone: string | null;
  phone_e164: string | null;
  slack_channel_id: string | null;
  slack_thread_ts: string | null;
  signed_case: boolean;
  case_id: string | null;
  lead_status: string;
  kind: string;
};

function textSendingLive(): boolean {
  return process.env.TEXT_SENDING === "live" && Boolean(process.env.QUO_API_KEY && process.env.QUO_FROM_NUMBER);
}

async function sendQuoText(to: string, content: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = process.env.QUO_API_KEY;
  const from = process.env.QUO_FROM_NUMBER;
  if (!key || !from) return { ok: false, error: "Quo sending is not configured." };
  const base = (process.env.QUO_API_BASE || "https://api.quo.com/v1").replace(/\/$/, "");
  const response = await fetch(`${base}/messages`, {
    method: "POST",
    headers: { Authorization: key, "Content-Type": "application/json" },
    body: JSON.stringify({ content, from, to: [to] }),
  });
  if (response.ok) return { ok: true };
  const raw = await response.text();
  return { ok: false, error: `Quo returned ${response.status}: ${raw.slice(0, 240)}` };
}

function closed(lead: LeadRow): boolean {
  return Boolean(lead.signed_case || lead.case_id) || ["Lost", "Referred", "Promoted"].includes(lead.lead_status);
}

export async function dispatchDue(supabase: SupabaseClient) {
  const now = new Date().toISOString();
  const result = { texts: 0, calls: 0, slack: 0, skipped: 0, failed: 0 };

  const { data: jobs, error } = await supabase
    .from("lead_jobs")
    .select("id, lead_id, queue, body, due_at, notified_at")
    .eq("status", "pending")
    .lte("due_at", now)
    .order("due_at")
    .limit(40);
  if (error) throw new Error(error.message);

  const leadIds = [...new Set((jobs ?? []).map((job) => job.lead_id as string))];
  const { data: leads } = leadIds.length
    ? await supabase
        .from("leads")
        .select("id, lead_name, phone, phone_e164, slack_channel_id, slack_thread_ts, signed_case, case_id, lead_status, kind")
        .in("id", leadIds)
    : { data: [] };
  const byId = new Map((leads ?? []).map((lead) => [lead.id as string, lead as LeadRow]));

  for (const job of (jobs ?? []) as Job[]) {
    const lead = byId.get(job.lead_id);
    if (!lead || closed(lead) || (job.queue === "text" && lead.kind === "needs_info")) {
      await supabase
        .from("lead_jobs")
        .update({ status: "skipped", detail: "Lead is closed or this queue does not apply." })
        .eq("id", job.id);
      result.skipped += 1;
      continue;
    }

    if (job.queue === "call") {
      const channel = lead.slack_channel_id || LEAD_CHANNEL_ID;
      const who = lead.lead_name || "Unnamed lead";
      const posted = await postToSlack({
        channel,
        threadTs: lead.slack_thread_ts,
        text: `Call due: ${who}${lead.phone ? ` ${lead.phone}` : ""}\n${job.body}`,
      });
      if (!posted.ok) {
        await supabase.from("lead_jobs").update({ status: "failed", detail: posted.error }).eq("id", job.id);
        result.failed += 1;
        continue;
      }
      await supabase
        .from("lead_jobs")
        .update({ status: "sent", sent_at: now, detail: "Asked the team in Slack." })
        .eq("id", job.id);
      result.calls += 1;
      continue;
    }

    if (!textSendingLive()) {
      if (!job.notified_at) {
        const channel = lead.slack_channel_id || LEAD_CHANNEL_ID;
        await postToSlack({
          channel,
          threadTs: lead.slack_thread_ts,
          text: `Text is due for ${lead.lead_name || "a lead"}, and live sending is off.\n${job.body}`,
        });
        await supabase.from("lead_jobs").update({ notified_at: now }).eq("id", job.id);
      }
      continue;
    }

    if (!lead.phone_e164) {
      await supabase
        .from("lead_jobs")
        .update({ status: "failed", detail: "No usable phone number." })
        .eq("id", job.id);
      result.failed += 1;
      continue;
    }
    const sent = await sendQuoText(lead.phone_e164, job.body);
    if (!sent.ok) {
      await supabase.from("lead_jobs").update({ status: "failed", detail: sent.error }).eq("id", job.id);
      result.failed += 1;
      continue;
    }
    await supabase
      .from("lead_jobs")
      .update({ status: "sent", sent_at: now, detail: "Sent through Quo." })
      .eq("id", job.id);
    result.texts += 1;
  }

  const { data: posts, error: postError } = await supabase
    .from("slack_posts")
    .select("id, lead_id, body, mention")
    .eq("status", "pending")
    .lte("due_at", now)
    .order("due_at")
    .limit(20);
  if (postError) throw new Error(postError.message);

  const postLeadIds = [...new Set((posts ?? []).map((post) => post.lead_id as string))];
  const { data: postLeads } = postLeadIds.length
    ? await supabase.from("leads").select("id, slack_channel_id, slack_thread_ts").in("id", postLeadIds)
    : { data: [] };
  const postById = new Map((postLeads ?? []).map((lead) => [lead.id as string, lead]));

  for (const post of (posts ?? []) as SlackPost[]) {
    const lead = postById.get(post.lead_id) as
      | { slack_channel_id: string | null; slack_thread_ts: string | null }
      | undefined;
    const mention = post.mention ? `<@${post.mention.replace(/[<@>]/g, "")}> ` : "";
    const posted = await postToSlack({
      channel: lead?.slack_channel_id || LEAD_CHANNEL_ID,
      threadTs: lead?.slack_thread_ts,
      text: `${mention}${post.body}`,
    });
    if (!posted.ok) {
      await supabase.from("slack_posts").update({ status: "failed", detail: posted.error }).eq("id", post.id);
      result.failed += 1;
      continue;
    }
    await supabase
      .from("slack_posts")
      .update({ status: "posted", posted_at: now, detail: posted.ts })
      .eq("id", post.id);
    result.slack += 1;
  }

  return result;
}
