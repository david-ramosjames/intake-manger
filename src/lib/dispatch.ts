import type { SupabaseClient } from "@supabase/supabase-js";
import { weekendCallAllowed } from "./callbacks";
import { leadSequenceId, loadWorkHours } from "./sequences";
import { loadSlackSettings } from "./slack-settings";
import { loadStaff } from "./identity";
import { channelOutboundMention, LEAD_CHANNEL_ID, mentionForName, postToSlack } from "./slack";
import { isPlaceholderOwner, slackMentionFor } from "./talked-with";
import { sendQuoText } from "./quo";
import { phoneTail } from "./phone";
import { withinWorkHours } from "./time";
import { isPracticeTestPhone } from "./test-phone";

type Job = {
  id: string;
  lead_id: string;
  queue: "text" | "call";
  body: string;
  due_at: string;
  notified_at: string | null;
  mention: string | null;
  assigned_name: string | null;
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
  priority: boolean;
  owner_name: string | null;
  consultation_date: string | null;
};

function textSendingLive(): boolean {
  return process.env.TEXT_SENDING === "live" && Boolean(process.env.QUO_API_KEY && process.env.QUO_FROM_NUMBER);
}

function slackTestMatch(lead: { phone?: string | null; phone_e164?: string | null }, testPhone: string | null): boolean {
  if (!testPhone) return true;
  return phoneTail(lead.phone_e164 || lead.phone) === phoneTail(testPhone);
}

function closed(lead: LeadRow): boolean {
  if (isPracticeTestPhone(lead.phone_e164 || lead.phone)) return false;
  return Boolean(lead.signed_case || lead.case_id) || ["Lost", "Referred", "Promoted"].includes(lead.lead_status);
}

async function resolveCallMention(
  job: Job,
  lead: LeadRow,
  staff: Awaited<ReturnType<typeof loadStaff>>,
  token: string | null,
  topicChannel: string,
): Promise<string> {
  if (job.mention) {
    return job.mention.startsWith("<@") ? job.mention : `<@${job.mention.replace(/[<@>]/g, "")}>`;
  }
  const assigned = isPlaceholderOwner(job.assigned_name) ? "" : job.assigned_name?.trim() || "";
  if (/^outbound$/i.test(assigned)) return channelOutboundMention(topicChannel, token);
  const consult = lead.consultation_date && !isPlaceholderOwner(lead.owner_name) ? lead.owner_name?.trim() || "" : "";
  const chosen = assigned || consult;
  if (chosen) return slackMentionFor(chosen, staff) || (await mentionForName(chosen, token));
  if (lead.consultation_date) return "";
  return channelOutboundMention(topicChannel, token);
}

export async function dispatchDue(supabase: SupabaseClient) {
  const now = new Date().toISOString();
  const slack = await loadSlackSettings();
  const staff = await loadStaff(supabase);
  const hoursBySequence = await loadWorkHours(supabase);
  const result = { texts: 0, calls: 0, slack: 0, skipped: 0, failed: 0 };
  // Newly due jobs open in this half hour. Older pending calls are still checked
  // against the call log so Open calls can clear ones that already got a return.
  const slackFloor = new Date(Date.now() - 30 * 60_000).toISOString();
  const dueSelect = "id, lead_id, queue, body, due_at, notified_at, mention, assigned_name";

  let freshJobs = supabase
    .from("lead_jobs")
    .select(dueSelect)
    .eq("status", "pending")
    .lte("due_at", now)
    .gte("due_at", slackFloor)
    .order("due_at")
    .limit(40);
  let waitingJobs = supabase
    .from("lead_jobs")
    .select(dueSelect)
    .eq("status", "pending")
    .eq("queue", "call")
    .lt("due_at", slackFloor)
    .order("due_at")
    .limit(80);
  if (slack.testPhone) {
    const tail = phoneTail(slack.testPhone);
    const { data: testLeads, error: testLeadError } = await supabase
      .from("leads")
      .select("id")
      .or(`phone_e164.ilike.%${tail},phone.ilike.%${tail}`);
    if (testLeadError) throw new Error(testLeadError.message);
    const testIds = (testLeads ?? []).map((lead) => String(lead.id));
    // Other due reminders stay pending during a test, so the oldest 40 of those
    // would fill this run before the test number is reached.
    freshJobs = testIds.length ? freshJobs.in("lead_id", testIds) : freshJobs.limit(0);
    waitingJobs = testIds.length ? waitingJobs.in("lead_id", testIds) : waitingJobs.limit(0);
  }
  const [{ data: fresh, error }, { data: waiting, error: waitingError }] = await Promise.all([freshJobs, waitingJobs]);
  if (error) throw new Error(error.message);
  if (waitingError) throw new Error(waitingError.message);
  const jobs = [...(waiting ?? []), ...(fresh ?? [])];

  const leadIds = [...new Set((jobs ?? []).map((job) => job.lead_id as string))];
  const { data: leads } = leadIds.length
    ? await supabase
        .from("leads")
        .select("id, lead_name, phone, phone_e164, slack_channel_id, slack_thread_ts, slack_message_ts, signed_case, case_id, lead_status, kind, agreement_status, agreement_sent_at, priority, owner_name, consultation_date")
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
      const postThisLead = slackTestMatch(lead, slack.testPhone);
      const since = job.notified_at || job.due_at;
      const loggedAt = await callLoggedAfter(supabase, lead, since);
      if (loggedAt) {
        await supabase
          .from("lead_jobs")
          .update({
            status: "completed",
            completed_at: loggedAt,
            completed_by: "call-log",
            outcome: "answered",
            detail: "Call log shows a call after this reminder opened.",
          })
          .eq("id", job.id);
        continue;
      }
      if (job.notified_at) continue;
      if (!postThisLead) continue;
      const sequence =
        leadSequenceId({
          closed: false,
          talked: talked.has(lead.id),
          kind: lead.kind,
          agreementStatus: lead.agreement_status,
          agreementSentAt: lead.agreement_sent_at,
          signedCase: lead.signed_case,
        }) ?? (talked.has(lead.id) ? "more_info" : "first_talk");
      const priority = Boolean(lead.priority) || sequence === "want_to_sign";
      const nowDate = new Date();
      const weekend = !weekendCallAllowed(nowDate, false);
      if (weekend && !priority && !isPracticeTestPhone(lead.phone_e164 || lead.phone)) continue;
      if (!weekend && sequence && !withinWorkHours(nowDate, hoursBySequence[sequence])) continue;
      const topicChannel = slack.channelId || LEAD_CHANNEL_ID;
      const mention = await resolveCallMention(job, lead, staff, slack.token, topicChannel);
      await supabase
        .from("lead_jobs")
        .update({
          notified_at: now,
          mention: mention || job.mention,
          detail: "Call is open. Waiting for a call in the call log.",
        })
        .eq("id", job.id);
      result.calls += 1;
      continue;
    }

    if (!textSendingLive()) {
      if (!job.notified_at && slack.posting && slackTestMatch(lead, slack.testPhone)) {
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
    .gte("due_at", slackFloor)
    .order("due_at")
    .limit(20);
  if (postError) throw new Error(postError.message);

  const postLeadIds = [...new Set((posts ?? []).map((post) => post.lead_id as string))];
  const { data: postLeads } = postLeadIds.length
    ? await supabase.from("leads").select("id, phone, phone_e164, slack_channel_id, slack_thread_ts").in("id", postLeadIds)
    : { data: [] };
  const postById = new Map((postLeads ?? []).map((lead) => [lead.id as string, lead]));

  for (const post of (posts ?? []) as SlackPost[]) {
    const lead = postById.get(post.lead_id) as
      | { phone: string | null; phone_e164: string | null; slack_channel_id: string | null; slack_thread_ts: string | null }
      | undefined;
    const mention = post.mention ? `<@${post.mention.replace(/[<@>]/g, "")}> ` : "";
    if (!slack.posting || !slackTestMatch(lead ?? {}, slack.testPhone)) continue;
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
