import type { SupabaseClient } from "@supabase/supabase-js";
import { enrollFollowUp } from "./followup";
import { leadSourceFromText, looksLikePersonName, slackMessageUrl } from "./leads";
import { isPlaceholderOwner } from "./talked-with";
import { parseSlackLead, leadIsClosed, slackPostDisposition } from "./slack-lead";
import { LEAD_CHANNEL_ID, readSlackEmail } from "./slack";
import {
  emailsIn,
  mergeEmailSummary,
  nameFromEmail,
  phoneDisplay,
  phonesInEmail,
  slackEmailFile,
  type SlackEmailFile,
} from "./slack-email";

type SlackEvent = {
  type?: string;
  subtype?: string;
  channel?: string;
  ts?: string;
  thread_ts?: string;
  text?: string;
  bot_id?: string;
  app_id?: string;
  attachments?: unknown[];
  blocks?: unknown[];
  files?: SlackEmailFile[];
};

function piece(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "text" in value) return piece((value as { text?: unknown }).text);
  return "";
}

function chunkText(chunk: unknown): string[] {
  if (!chunk || typeof chunk !== "object") return [];
  const record = chunk as Record<string, unknown>;
  const lines = [piece(record.text), piece(record.fallback), piece(record.pretext), piece(record.title), piece(record.value)];
  const nested = [record.fields, record.elements].flatMap((group) => (Array.isArray(group) ? group.flatMap(chunkText) : []));
  return [...lines, ...nested].filter(Boolean);
}

function flatten(event: SlackEvent): string {
  const parts = [event.text ?? "", ...(event.attachments ?? []).flatMap(chunkText), ...(event.blocks ?? []).flatMap(chunkText)];
  return parts
    .join("\n")
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
  if (!event.ts) return { ignored: "no_ts" };

  const text = flatten(event);
  const ownApp = process.env.SLACK_APP_ID;
  const emailFile = slackEmailFile(event.files);
  if (emailFile?.id && (!ownApp || event.app_id !== ownApp)) {
    const saved = await captureSlackEmail(supabase, event, emailFile.id);
    if (saved) return saved;
  }

  if (event.app_id && event.app_id === process.env.SLACK_APP_ID && !/website lead to contact/i.test(text)) return { ignored: "self" };
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
  const disposition = slackPostDisposition(text);
  if (disposition) {
    if (parsed.phoneE164) {
      const { data: prior } = await supabase
        .from("leads")
        .select("id")
        .eq("phone_e164", parsed.phoneE164)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (prior) {
        await supabase.from("lead_events").insert({
          lead_id: prior.id,
          event_type: "slack_touch",
          actor: "slack",
          payload: { disposition, ts: event.ts },
        });
      }
    }
    return { ignored: disposition };
  }
  if (parsed.phoneE164) {
    const { data: openLeads } = await supabase
      .from("leads")
      .select("id, signed_case, case_id, lead_status, lead_name, phone, email, summary, owner_name, quo_link, callrail_tags, lead_source, test")
      .eq("phone_e164", parsed.phoneE164)
      .order("created_at", { ascending: false })
      .limit(5);
    const matches = (openLeads ?? []).filter((lead) => lead.test !== true);
    const open = matches.find((lead) => !leadIsClosed(lead)) ?? matches[0];
    if (open) {
      const patch: Record<string, unknown> = {};
      if (!open.lead_name && parsed.name && looksLikePersonName(parsed.name)) patch.lead_name = parsed.name;
      if (!open.phone && parsed.phone) {
        patch.phone = parsed.phone;
        patch.phone_e164 = parsed.phoneE164;
      }
      if (!open.email && parsed.email) patch.email = parsed.email;
      if (!open.summary && parsed.summary) patch.summary = parsed.summary;
      if (parsed.handledBy && !isPlaceholderOwner(parsed.handledBy) && isPlaceholderOwner(open.owner_name)) {
        patch.owner_name = parsed.handledBy;
      }
      if (!open.quo_link && parsed.quoLink) patch.quo_link = parsed.quoLink;
      if (!open.lead_source) {
        const found = leadSourceFromText(text);
        if (found) {
          patch.lead_source = found.source;
          patch.source_type = found.type || null;
        }
      }
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

  const found = leadSourceFromText(text);
  const website = /website lead to contact|new case is submitted/i.test(text);
  const { data: created, error } = await supabase
    .from("leads")
    .insert({
      lead_date: new Date().toISOString().slice(0, 10),
      lead_name: looksLikePersonName(parsed.name) ? parsed.name : null,
      phone: parsed.phone,
      phone_e164: parsed.phoneE164,
      email: parsed.email,
      lead_source: website ? "Website" : found?.source ?? null,
      source_type: website ? "Marketing" : found?.type || null,
      source_category: website ? "Search" : null,
      source_channel: website || parsed.arrival === "form" ? "Web form" : "Call",
      lead_status: "New",
      kind: parsed.kind,
      arrival: parsed.arrival,
      case_type: parsed.caseType,
      summary: parsed.summary,
      owner_name: isPlaceholderOwner(parsed.handledBy) ? null : parsed.handledBy,
      quo_link: parsed.quoLink,
      callrail_tags: parsed.tags,
      follow_up: true,
      needs_verification: !parsed.name || !parsed.phone,
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
    arrival: parsed.arrival,
    owner_name: isPlaceholderOwner(parsed.handledBy) ? null : parsed.handledBy,
    created_at: new Date().toISOString(),
    priority: false,
  });
  return { created: created.id };
}

const FINISHED_STATUS = new Set(["Signed", "Promoted", "Lost", "Referred"]);
const EMAIL_LEAD_COLUMNS =
  "id, summary, email, phone, phone_e164, lead_name, lead_source, source_type, source_category, source_channel, slack_channel_id, slack_message_ts, slack_thread_ts, slack_permalink, signed_case, case_id, lead_status, test, created_at";

type EmailLeadRow = {
  id: string;
  summary: string | null;
  email: string | null;
  phone: string | null;
  phone_e164: string | null;
  lead_name: string | null;
  lead_source: string | null;
  source_type: string | null;
  source_category: string | null;
  source_channel: string | null;
  slack_channel_id: string | null;
  slack_message_ts: string | null;
  slack_thread_ts: string | null;
  slack_permalink: string | null;
  signed_case: boolean | null;
  case_id: string | null;
  lead_status: string | null;
  test: boolean | null;
  created_at: string;
};

function slackMoment(ts: string): number {
  const seconds = Number(ts);
  return Number.isFinite(seconds) ? seconds * 1000 : Date.now();
}

function chicagoDate(at: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date(at));
}

function finishedLead(lead: EmailLeadRow): boolean {
  if (lead.signed_case || lead.case_id) return true;
  return FINISHED_STATUS.has(lead.lead_status || "");
}

function nearEmail(createdAt: string, at: number): boolean {
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return false;
  return created >= at - 14 * 24 * 60 * 60 * 1000 && created <= at + 2 * 24 * 60 * 60 * 1000;
}

function closestLead(rows: EmailLeadRow[], at: number): EmailLeadRow | null {
  const real = rows.filter((lead) => lead.test !== true);
  real.sort((a, b) => Math.abs(new Date(a.created_at).getTime() - at) - Math.abs(new Date(b.created_at).getTime() - at));
  return real[0] ?? null;
}

function chooseEmailLead(rows: EmailLeadRow[], at: number): EmailLeadRow | null {
  const open = closestLead(rows.filter((lead) => !finishedLead(lead)), at);
  if (open) return open;
  return closestLead(rows.filter((lead) => nearEmail(lead.created_at, at)), at);
}

async function slackBotToken(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase.from("intake_settings").select("slack_bot_token").eq("id", "default").maybeSingle();
  const stored = typeof data?.slack_bot_token === "string" ? data.slack_bot_token.trim() : "";
  return stored || process.env.SLACK_BOT_TOKEN?.trim() || null;
}

async function leadsForEmail(
  supabase: SupabaseClient,
  column: "phone_e164" | "email",
  values: string[],
): Promise<EmailLeadRow[]> {
  if (!values.length) return [];
  const { data, error } = await supabase
    .from("leads")
    .select(EMAIL_LEAD_COLUMNS)
    .in(column, values)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);
  return (data ?? []) as EmailLeadRow[];
}

/** Save a forwarded email onto the lead it belongs to, or open a lead from it. */
async function captureSlackEmail(
  supabase: SupabaseClient,
  event: SlackEvent,
  fileId: string,
): Promise<{ ignored: string; id?: string } | { updated: string } | { created: string } | null> {
  const token = await slackBotToken(supabase);
  if (!token) return { ignored: "no_slack_token" };
  const read = await readSlackEmail(token, fileId);
  if (!read.ok) return read.error === "not_email" ? null : { ignored: "email_unreadable" };
  if (!event.channel || !event.ts) return { ignored: "no_ts" };

  const { data: stamped } = await supabase
    .from("leads")
    .select("id")
    .eq("slack_channel_id", event.channel)
    .eq("slack_message_ts", event.ts)
    .maybeSingle();
  if (stamped) return { ignored: "already_captured", id: stamped.id };

  const at = slackMoment(event.ts);
  const phones = phonesInEmail(read.email.summary);
  const emails = emailsIn(read.email.summary);
  const [byPhone, byEmail] = await Promise.all([
    leadsForEmail(supabase, "phone_e164", phones),
    leadsForEmail(supabase, "email", emails),
  ]);
  let match = chooseEmailLead(byPhone, at) ?? chooseEmailLead(byEmail, at);
  if (!match) {
    const name = nameFromEmail(read.email.summary);
    const needle = name?.replace(/["“”]/g, "").replace(/\s+/g, "%");
    if (needle) {
      const { data, error } = await supabase
        .from("leads")
        .select(EMAIL_LEAD_COLUMNS)
        .ilike("lead_name", `%${needle}%`)
        .gte("created_at", new Date(at - 14 * 24 * 60 * 60 * 1000).toISOString())
        .lte("created_at", new Date(at + 2 * 24 * 60 * 60 * 1000).toISOString())
        .limit(5);
      if (error) throw new Error(error.message);
      const named = ((data ?? []) as EmailLeadRow[]).filter((lead) => lead.test !== true);
      if (named.length === 1) match = named[0];
    }
  }
  if (match) return attachEmail(supabase, event, match, read.email.summary);

  const name = nameFromEmail(read.email.summary);
  const phone = phones[0] ?? null;
  const { data: created, error } = await supabase
    .from("leads")
    .insert({
      lead_date: chicagoDate(at),
      lead_name: name,
      phone: phone ? phoneDisplay(phone) : null,
      phone_e164: phone,
      email: emails[0] ?? null,
      lead_source: "Email",
      source_type: "Marketing",
      source_category: "Direct",
      source_channel: "Email",
      lead_status: "New",
      kind: "pursue",
      arrival: "manual",
      summary: read.email.summary,
      follow_up: Boolean(phone),
      needs_verification: !name || !phone,
      slack_channel_id: event.channel,
      slack_thread_ts: event.ts,
      slack_message_ts: event.ts,
      slack_permalink: slackMessageUrl({
        slack_permalink: null,
        slack_channel_id: event.channel,
        slack_message_ts: event.ts,
        slack_thread_ts: event.ts,
      }),
    })
    .select("id, kind, follow_up, lead_name, case_type, signed_case, case_id, lead_status")
    .single();
  if (error || !created) throw new Error(error?.message ?? "Could not capture the email");

  await supabase.from("lead_events").insert({
    lead_id: created.id,
    event_type: "captured",
    actor: "slack",
    payload: { arrival: "manual", source: "email", ts: event.ts },
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
    arrival: "manual",
    owner_name: null,
    created_at: new Date(at).toISOString(),
    priority: false,
  });
  return { created: created.id };
}

async function attachEmail(
  supabase: SupabaseClient,
  event: SlackEvent,
  lead: EmailLeadRow,
  summary: string,
): Promise<{ updated: string }> {
  const patch: Record<string, unknown> = {};
  const merged = mergeEmailSummary(lead.summary, summary);
  if (merged) patch.summary = merged;
  if (!lead.slack_channel_id && event.channel) patch.slack_channel_id = event.channel;
  if (!lead.slack_message_ts && event.ts) patch.slack_message_ts = event.ts;
  if (!lead.slack_thread_ts && event.ts) patch.slack_thread_ts = event.ts;
  if (!lead.slack_permalink && event.channel && event.ts) {
    patch.slack_permalink = slackMessageUrl({
      slack_permalink: null,
      slack_channel_id: event.channel,
      slack_message_ts: event.ts,
      slack_thread_ts: event.ts,
    });
  }
  if (!lead.source_channel) patch.source_channel = "Email";
  if (Object.keys(patch).length) {
    const { error } = await supabase.from("leads").update(patch).eq("id", lead.id);
    if (error) throw new Error(error.message);
  }
  const { error: eventError } = await supabase.from("lead_events").insert({
    lead_id: lead.id,
    event_type: "slack_email",
    actor: "slack",
    payload: { ts: event.ts },
  });
  if (eventError) throw new Error(eventError.message);
  return { updated: lead.id };
}
