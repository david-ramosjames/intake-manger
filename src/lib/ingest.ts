import type { SupabaseClient } from "@supabase/supabase-js";
import { enrollFollowUp } from "./followup";
import { parseSlackLead, leadIsClosed } from "./slack-lead";
import { LEAD_CHANNEL_ID } from "./slack";

type SlackEvent = {
  type?: string;
  subtype?: string;
  channel?: string;
  ts?: string;
  thread_ts?: string;
  text?: string;
  bot_id?: string;
  app_id?: string;
};

function flatten(event: SlackEvent): string {
  return String(event.text ?? "")
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2 ($1)")
    .replace(/<tel:[^|>]*\|([^>]+)>/g, "$1")
    .trim();
}

export async function captureSlackMessage(supabase: SupabaseClient, event: SlackEvent) {
  if (event.type !== "message") return { ignored: "not_message" };
  if (event.subtype && event.subtype !== "bot_message" && event.subtype !== "file_share") {
    return { ignored: event.subtype };
  }
  if (event.channel !== LEAD_CHANNEL_ID) return { ignored: "other_channel" };
  if (event.app_id && event.app_id === process.env.SLACK_APP_ID) return { ignored: "self" };
  if (!event.ts) return { ignored: "no_ts" };

  const text = flatten(event);
  if (!text) return { ignored: "empty" };

  const parentTs = event.thread_ts && event.thread_ts !== event.ts ? event.thread_ts : event.ts;
  const isReply = parentTs !== event.ts;

  if (isReply) {
    const { data: parent } = await supabase
      .from("leads")
      .select("id, summary")
      .eq("slack_channel_id", event.channel)
      .eq("slack_thread_ts", parentTs)
      .maybeSingle();
    if (!parent) return { ignored: "reply_without_lead" };
    await supabase.from("lead_events").insert({
      lead_id: parent.id,
      event_type: "slack_reply",
      actor: "slack",
      payload: { text: text.slice(0, 2000), ts: event.ts },
    });
    return { updated: parent.id };
  }

  const { data: existing } = await supabase
    .from("leads")
    .select("id")
    .eq("slack_channel_id", event.channel)
    .eq("slack_message_ts", event.ts)
    .maybeSingle();
  if (existing) return { ignored: "already_captured", id: existing.id };

  const parsed = parseSlackLead(text);
  if (parsed.phoneE164) {
    const { data: openLeads } = await supabase
      .from("leads")
      .select("id, signed_case, case_id, lead_status, lead_name, email, summary, owner_name, quo_link, callrail_tags")
      .eq("phone_e164", parsed.phoneE164)
      .order("created_at", { ascending: false })
      .limit(5);
    const open = (openLeads ?? []).find((lead) => !leadIsClosed(lead));
    if (open) {
      const patch: Record<string, unknown> = {};
      if (!open.lead_name && parsed.name) patch.lead_name = parsed.name;
      if (!open.email && parsed.email) patch.email = parsed.email;
      if (!open.summary && parsed.summary) patch.summary = parsed.summary;
      if (!open.owner_name && parsed.handledBy) patch.owner_name = parsed.handledBy;
      if (!open.quo_link && parsed.quoLink) patch.quo_link = parsed.quoLink;
      if (parsed.tags.length) {
        const current = Array.isArray(open.callrail_tags) ? (open.callrail_tags as string[]) : [];
        patch.callrail_tags = [...new Set([...current, ...parsed.tags])];
      }
      if (Object.keys(patch).length) {
        await supabase.from("leads").update(patch).eq("id", open.id);
      }
      await supabase.from("lead_events").insert({
        lead_id: open.id,
        event_type: "slack_touch",
        actor: "slack",
        payload: { arrival: parsed.arrival, ts: event.ts },
      });
      return { updated: open.id };
    }
  }

  const { data: created, error } = await supabase
    .from("leads")
    .insert({
      lead_date: new Date().toISOString().slice(0, 10),
      lead_name: parsed.name,
      phone: parsed.phone,
      phone_e164: parsed.phoneE164,
      email: parsed.email,
      source_channel: parsed.arrival === "form" ? "Web form" : "Call",
      lead_status: "New",
      kind: parsed.kind,
      arrival: parsed.arrival,
      case_type: parsed.caseType,
      summary: parsed.summary,
      owner_name: parsed.handledBy,
      quo_link: parsed.quoLink,
      callrail_tags: parsed.tags,
      follow_up: true,
      slack_channel_id: event.channel,
      slack_thread_ts: event.ts,
      slack_message_ts: event.ts,
    })
    .select("id, kind, follow_up, lead_name, case_type, signed_case, case_id, lead_status")
    .single();
  if (error || !created) throw new Error(error?.message ?? "Could not capture the lead");

  await supabase.from("lead_events").insert({
    lead_id: created.id,
    event_type: "captured",
    actor: "slack",
    payload: { kind: parsed.kind, arrival: parsed.arrival },
  });
  await enrollFollowUp(supabase, {
    id: created.id,
    kind: created.kind,
    follow_up: created.follow_up,
    lead_name: created.lead_name,
    case_type: created.case_type,
    signed_case: created.signed_case,
    case_id: created.case_id,
    lead_status: created.lead_status,
  });
  return { created: created.id };
}
