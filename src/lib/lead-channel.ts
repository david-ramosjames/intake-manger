import type { SupabaseClient } from "@supabase/supabase-js";
import { callerClassLabel } from "./caller-class";
import { consultationWhen, desiredWord, milestoneDesired, milestoneQualified, milestoneSigned } from "./desired";
import { listAccident, slackMessageUrl } from "./leads";
import { readLeadChannel, type LeadChannelMessage } from "./slack";
import { leadIsClosed, parseSlackLead, slackPostDisposition } from "./slack-lead";
import { DECLINE_TAGS, NOT_QUALIFIED_TAGS, SIZE_TAGS, TYPE_TAGS } from "./tags";

const LEAD_COLUMNS =
  "id, lead_name, phone, phone_e164, source_channel, case_type, case_detail, grade, consultation_date, qualified, desired_case, desired_source, signed_case, lead_status, caller_class, callrail_tags, decline_reason, owner_name, agreement_status, agreement_sent_at, slack_permalink, slack_channel_id, slack_message_ts, slack_thread_ts, summary, created_at";

export type ChannelCapture = "stored" | "same_phone" | "kept_out" | "not_stored" | "no_lead";

type ChannelLead = {
  id: string;
  lead_name: string | null;
  phone: string | null;
  phone_e164: string | null;
  source_channel: string | null;
  case_type: string | null;
  case_detail: string | null;
  grade: string | null;
  consultation_date: string | null;
  qualified: boolean | null;
  desired_case: boolean | null;
  desired_source: string | null;
  signed_case: boolean | null;
  lead_status: string | null;
  caller_class: string | null;
  callrail_tags: string[] | null;
  decline_reason: string | null;
  owner_name: string | null;
  agreement_status: string | null;
  agreement_sent_at: string | null;
  slack_permalink: string | null;
  slack_channel_id: string | null;
  slack_message_ts: string | null;
  slack_thread_ts: string | null;
  summary: string | null;
  created_at: string | null;
};

export type ChannelAuditRow = {
  id: string;
  when: string | null;
  post: string;
  slackUrl: string | null;
  quoUrl: string | null;
  leadId: string | null;
  leadName: string | null;
  phone: string | null;
  capture: ChannelCapture;
  channel: string;
  accident: string;
  grade: string;
  consult: string;
  qualified: string;
  desired: string;
  signed: string;
  notALead: string;
  decline: string;
  injury: string;
  size: string;
  notQualified: string;
  handledBy: string;
  blanks: string;
};

export const CAPTURE_LABEL: Record<ChannelCapture, string> = {
  stored: "Stored",
  same_phone: "Same phone",
  kept_out: "Kept out",
  not_stored: "Not stored",
  no_lead: "No lead",
};

const PAGE_SIZE = 40;

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function tagAfter(tags: string[] | null | undefined, options: readonly string[]): string {
  const tag = (tags ?? []).find((item) => options.includes(item));
  if (!tag) return "—";
  const split = tag.indexOf(":");
  return split >= 0 ? tag.slice(split + 1).trim() : tag;
}

function notALead(lead: ChannelLead): string {
  const label = callerClassLabel(lead.caller_class);
  if (label) return label;
  const nl = (lead.callrail_tags ?? []).find((tag) => tag.startsWith("NL:"));
  return nl ? nl.slice("NL:".length).trim() : "—";
}

function blanksFor(lead: ChannelLead | null, capture: ChannelCapture): string {
  if (!lead || capture === "kept_out" || capture === "not_stored" || capture === "no_lead") return "";
  if (lead.caller_class && lead.caller_class !== "non_pi") return "";
  const missing: string[] = [];
  if (!lead.lead_name) missing.push("name");
  if (!lead.phone && !lead.phone_e164) missing.push("phone");
  if (milestoneQualified(lead) === null) missing.push("qualified");
  if (!lead.grade) missing.push("grade");
  if (listAccident(lead) === "—") missing.push("accident");
  return missing.join(", ");
}

function rowFromLead(
  lead: ChannelLead | null,
  base: {
    id: string;
    when: string | null;
    post: string;
    slackUrl: string | null;
    quoUrl: string | null;
    phone: string | null;
    capture: ChannelCapture;
  },
): ChannelAuditRow {
  const tags = lead?.callrail_tags ?? [];
  return {
    ...base,
    leadId: lead?.id ?? null,
    leadName: lead?.lead_name ?? null,
    phone: base.phone || lead?.phone || lead?.phone_e164 || null,
    channel: lead?.source_channel || "—",
    accident: lead ? listAccident(lead) : "—",
    grade: lead?.grade || "—",
    consult: lead ? consultationWhen(lead.consultation_date) : "—",
    qualified: lead ? desiredWord(milestoneQualified(lead)) : "—",
    desired: lead ? desiredWord(milestoneDesired(lead)) : "—",
    signed: lead && milestoneSigned(lead) ? "Yes" : "—",
    notALead: lead ? notALead(lead) : "—",
    decline: lead?.decline_reason || tagAfter(tags, DECLINE_TAGS),
    injury: tagAfter(tags, TYPE_TAGS),
    size: tagAfter(tags, SIZE_TAGS),
    notQualified: tagAfter(tags, NOT_QUALIFIED_TAGS),
    handledBy: lead?.owner_name || "—",
    blanks: blanksFor(lead, base.capture),
  };
}

function preferLead(leads: ChannelLead[]): ChannelLead | null {
  return leads.find((lead) => !leadIsClosed(lead)) ?? leads[0] ?? null;
}

async function leadsForMessages(supabase: SupabaseClient, messages: LeadChannelMessage[]): Promise<Map<string, ChannelLead>> {
  const stamps = messages.map((message) => message.ts);
  const phones = [
    ...new Set(messages.map((message) => parseSlackLead(message.text).phoneE164).filter((phone): phone is string => Boolean(phone))),
  ];
  const byStamp = new Map<string, ChannelLead>();
  const byPhone = new Map<string, ChannelLead[]>();

  if (stamps.length) {
    const list = stamps.join(",");
    const { data } = await supabase
      .from("leads")
      .select(LEAD_COLUMNS)
      .or(`slack_message_ts.in.(${list}),slack_thread_ts.in.(${list})`);
    for (const lead of (data ?? []) as ChannelLead[]) {
      if (lead.slack_message_ts) byStamp.set(lead.slack_message_ts, lead);
      if (lead.slack_thread_ts) byStamp.set(lead.slack_thread_ts, lead);
    }
  }

  if (phones.length) {
    const { data } = await supabase
      .from("leads")
      .select(LEAD_COLUMNS)
      .in("phone_e164", phones)
      .order("created_at", { ascending: false })
      .limit(200);
    for (const lead of (data ?? []) as ChannelLead[]) {
      if (!lead.phone_e164) continue;
      const group = byPhone.get(lead.phone_e164) ?? [];
      group.push(lead);
      byPhone.set(lead.phone_e164, group);
    }
  }

  const matched = new Map<string, ChannelLead>();
  for (const message of messages) {
    const exact = byStamp.get(message.ts);
    if (exact) {
      matched.set(message.ts, exact);
      continue;
    }
    const phone = parseSlackLead(message.text).phoneE164;
    const found = phone ? preferLead(byPhone.get(phone) ?? []) : null;
    if (found) matched.set(message.ts, found);
  }
  return matched;
}

function rowsFromSlack(messages: LeadChannelMessage[], matched: Map<string, ChannelLead>): ChannelAuditRow[] {
  return messages.map((message) => {
    const lead = matched.get(message.ts) ?? null;
    const exact = lead?.slack_message_ts === message.ts || lead?.slack_thread_ts === message.ts;
    const disposition = slackPostDisposition(message.text);
    let capture: ChannelCapture = "not_stored";
    if (lead && exact) capture = "stored";
    else if (lead) capture = "same_phone";
    else if (disposition === "exclude" || disposition === "return") capture = "kept_out";
    const when = new Date(Number(message.ts) * 1000).toISOString();
    return rowFromLead(lead, {
      id: message.ts,
      when,
      post: message.text,
      slackUrl: message.permalink,
      quoUrl: parseSlackLead(message.text).quoLink,
      phone: lead?.phone || parseSlackLead(message.text).phone,
      capture,
    });
  });
}

type StoredTouch = {
  id: string;
  occurred_at: string | null;
  content: string | null;
  quo_link: string | null;
  slack_permalink: string | null;
  phone: string | null;
  phone_e164: string | null;
  lead_id: string | null;
  leads: ChannelLead | ChannelLead[] | null;
};

async function rowsFromStored(
  supabase: SupabaseClient,
  channelId: string,
  page: number,
  q: string,
  gapsOnly: boolean,
): Promise<{ rows: ChannelAuditRow[]; total: number }> {
  let query = supabase
    .from("intake_interactions")
    .select(
      `id, occurred_at, content, quo_link, slack_permalink, phone, phone_e164, lead_id, leads(${LEAD_COLUMNS})`,
      { count: "exact" },
    )
    .ilike("slack_permalink", `%${channelId}%`)
    .order("occurred_at", { ascending: false });

  if (gapsOnly) query = query.is("lead_id", null);

  const digits = q.replace(/\D/g, "");
  const safe = q.replace(/[%(),]/g, "");
  if (digits.length >= 7) {
    query = query.or(`phone.ilike.%${digits}%,phone_e164.ilike.%${digits}%`);
  } else if (safe) {
    const { data: named } = await supabase.from("leads").select("id").ilike("lead_name", `%${safe}%`).limit(40);
    const ids = (named ?? []).map((row) => row.id as string);
    const leadMatch = ids.length ? `,lead_id.in.(${ids.join(",")})` : "";
    query = query.or(`content.ilike.%${safe}%${leadMatch}`);
  }

  const from = (page - 1) * PAGE_SIZE;
  const { data, count } = await query.range(from, from + PAGE_SIZE - 1);
  const touches = (data ?? []) as StoredTouch[];
  const newest = touches[0]?.occurred_at;
  const oldest = touches[touches.length - 1]?.occurred_at;

  let forms: ChannelLead[] = [];
  if (gapsOnly) {
    const { data: thin } = await supabase
      .from("leads")
      .select(LEAD_COLUMNS)
      .eq("slack_channel_id", channelId)
      .is("qualified", null)
      .or("caller_class.is.null,caller_class.eq.non_pi")
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);
    forms = (thin ?? []) as ChannelLead[];
  } else if (newest && oldest) {
    const { data: leadRows } = await supabase
      .from("leads")
      .select(LEAD_COLUMNS)
      .eq("slack_channel_id", channelId)
      .gte("created_at", oldest)
      .lte("created_at", newest)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);
    const seen = new Set(touches.map((touch) => touch.slack_permalink).filter(Boolean));
    forms = ((leadRows ?? []) as ChannelLead[]).filter((lead) => {
      const url = slackMessageUrl(lead);
      return url ? !seen.has(url) : true;
    });
  }

  const rows = [
    ...touches.map((touch) => {
      const lead = one(touch.leads);
      return rowFromLead(lead, {
        id: touch.id,
        when: touch.occurred_at,
        post: touch.content || lead?.summary || "",
        slackUrl: touch.slack_permalink,
        quoUrl: touch.quo_link,
        phone: touch.phone_e164 || touch.phone,
        capture: lead ? "stored" : "no_lead",
      });
    }),
    ...forms.map((lead) =>
      rowFromLead(lead, {
        id: `lead-${lead.id}`,
        when: lead.created_at,
        post: lead.summary || "",
        slackUrl: slackMessageUrl(lead),
        quoUrl: null,
        phone: lead.phone_e164 || lead.phone,
        capture: "stored",
      }),
    ),
  ].sort((a, b) => (b.when || "").localeCompare(a.when || ""));

  return { rows, total: count ?? touches.length };
}

export async function loadChannelAudit(
  supabase: SupabaseClient,
  input: {
    token: string | null;
    channelId: string;
    cursor?: string;
    page: number;
    q: string;
    gapsOnly: boolean;
  },
): Promise<{
  rows: ChannelAuditRow[];
  total: number | null;
  nextCursor: string | null;
  source: "slack" | "stored";
  notice: string | null;
}> {
  const live = await readLeadChannel({ token: input.token, channel: input.channelId, cursor: input.cursor });
  if (!live.error) {
    const matched = await leadsForMessages(supabase, live.messages);
    let rows = rowsFromSlack(live.messages, matched);
    const needle = input.q.toLowerCase();
    if (needle) {
      rows = rows.filter((row) =>
        `${row.post} ${row.leadName || ""} ${row.phone || ""}`.toLowerCase().includes(needle),
      );
    }
    if (input.gapsOnly) rows = rows.filter((row) => row.capture === "not_stored" || row.capture === "no_lead" || row.blanks);
    return { rows, total: null, nextCursor: live.nextCursor, source: "slack", notice: null };
  }

  const stored = await rowsFromStored(supabase, input.channelId, input.page, input.q, input.gapsOnly);
  const notice =
    live.error === "no_token"
      ? "The Slack bot token is not saved here, so this list is the #lead-calls posts already stored on each call and form."
      : live.error === "missing_scope"
        ? "The Slack bot cannot read channel history yet. This list is the #lead-calls posts already stored."
        : `Slack history could not be read (${live.error}). This list is the #lead-calls posts already stored.`;
  return { rows: stored.rows, total: stored.total, nextCursor: null, source: "stored", notice };
}

export const CHANNEL_PAGE_SIZE = PAGE_SIZE;
