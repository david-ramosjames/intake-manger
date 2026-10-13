import type { SupabaseClient } from "@supabase/supabase-js";
import { leadSequenceId, loadWorkHours } from "./sequences";
import { loadSlackSettings } from "./slack-settings";
import { channelLeadMention, LEAD_CHANNEL_ID, postToSlack } from "./slack";
import { withinWorkHours } from "./time";

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
  slack_message_ts: string | null;
  signed_case: boolean;
  case_id: string | null;
  lead_status: string;
  kind: string;
  agreement_status: string | null;
  agreement_sent_at: string | null;
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
  const slack = await loadSlackSettings();
  const hoursBySequence = await loadWorkHours(supabase);
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
        .select("id, lead_name, phone, phone_e164, slack_channel_id, slack_thread_ts, slack_message_ts, signed_case, case_id, lead_status, kind, agreement_status, agreement_sent_at")
        .in("id", leadIds)
    : { data: [] };
  const byId = new Map((leads ?? []).map((lead) => [lead.id as string, lead as LeadRow]));
  const talked = await talkedIds(supabase, leadIds);

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
      const threadTs = lead.slack_thread_ts || lead.slack_message_ts;
      if (job.notified_at) {
        const loggedAt = await callLoggedAfter(supabase, lead, job.notified_at);
        if (!loggedAt) continue;
        await supabase
          .from("lead_jobs")
          .update({
            status: "completed",
            completed_at: loggedAt,
            completed_by: "call-log",
            outcome: "answered",
            detail: "Call log shows a call after the Slack reminder.",
          })
          .eq("id", job.id);
        if (slack.posting) {
          await postToSlack({
            token: slack.token,
            channel,
            threadTs,
            text: `Call completed. The call log shows a call with ${lead.lead_name || "this lead"} after the reminder.`,
          });
        }
        continue;
      }
      if (!slack.posting) continue;
      const sequence = leadSequenceId({
        closed: false,
        talked: talked.has(lead.id),
        kind: lead.kind,
        agreementStatus: lead.agreement_status,
        agreementSentAt: lead.agreement_sent_at,
      });
      if (sequence && !withinWorkHours(new Date(), hoursBySequence[sequence])) continue;
      const who = lead.lead_name || "Unnamed lead";
      const mention = await channelLeadMention(channel, slack.token);
      const posted = await postToSlack({
        token: slack.token,
        channel: slack.channelId || channel,
        threadTs,
        text: `${mention ? `${mention} ` : ""}Call due: ${who}${lead.phone ? ` ${lead.phone}` : ""}\n${job.body}\nThis reminder is not the call. It closes when the call log shows a call.`,
      });
      if (!posted.ok) {
        await supabase.from("lead_jobs").update({ status: "failed", detail: posted.error }).eq("id", job.id);
        result.failed += 1;
        continue;
      }
      await supabase
        .from("lead_jobs")
        .update({ notified_at: now, detail: "Slack alert posted. Waiting for a call in the call log." })
        .eq("id", job.id);
      result.calls += 1;
      continue;
    }

    if (!textSendingLive()) {
      if (!job.notified_at && slack.posting) {
        const channel = lead.slack_channel_id || slack.channelId || LEAD_CHANNEL_ID;
        await postToSlack({
          token: slack.token,
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
    if (!slack.posting) continue;
    const posted = await postToSlack({
      token: slack.token,
      channel: lead?.slack_channel_id || slack.channelId || LEAD_CHANNEL_ID,
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

  await supabase.from("queue_runs").insert({
    calls_alerted: result.calls,
    texts: result.texts,
    slack: result.slack,
    failed: result.failed,
  });

  return result;
}

async function talkedIds(supabase: SupabaseClient, ids: string[]): Promise<Set<string>> {
  const talked = new Set<string>();
  if (!ids.length) return talked;
  const { data } = await supabase
    .from("intake_interactions")
    .select("lead_id, type, direction")
    .in("lead_id", ids)
    .in("type", ["call", "sona_call", "text", "email"])
    .limit(2000);
  for (const row of data ?? []) {
    const type = String(row.type ?? "");
    const direction = String(row.direction ?? "");
    const leadId = typeof row.lead_id === "string" ? row.lead_id : "";
    if (!leadId) continue;
    if (type === "call" || type === "sona_call" || ((type === "text" || type === "email") && direction === "inbound")) {
      talked.add(leadId);
    }
  }
  return talked;
}

async function callLoggedAfter(supabase: SupabaseClient, lead: LeadRow, since: string): Promise<string | null> {
  const found = async (column: "lead_id" | "phone", value: string) => {
    const { data } = await supabase
      .from("intake_interactions")
      .select("occurred_at")
      .eq(column, value)
      .gte("occurred_at", since)
      .in("type", ["call", "sona_call"])
      .order("occurred_at", { ascending: true })
      .limit(1);
    const at = data?.[0]?.occurred_at;
    return typeof at === "string" ? at : null;
  };
  const onLead = await found("lead_id", lead.id);
  if (onLead) return onLead;
  const digits = (lead.phone || lead.phone_e164 || "").replace(/\D/g, "");
  const phone = digits.length >= 10 ? digits.slice(-10) : "";
  if (!phone) return null;
  return found("phone", phone);
}
