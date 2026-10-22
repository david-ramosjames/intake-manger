import crypto from "node:crypto";

export const LEAD_CHANNEL_ID = process.env.SLACK_LEAD_CHANNEL_ID || "C026G89PPSS";

export function verifySlackRequest(rawBody: string, headers: Headers): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET;
  const timestamp = headers.get("x-slack-request-timestamp") ?? "";
  const signature = headers.get("x-slack-signature") ?? "";
  if (!secret || !timestamp || !signature) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 60 * 5) return false;
  const expected = `v0=${crypto.createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export async function postToSlack(input: {
  channel: string;
  text: string;
  threadTs?: string | null;
  token?: string | null;
}): Promise<{ ok: true; ts: string | null } | { ok: false; error: string }> {
  const token = input.token || process.env.SLACK_BOT_TOKEN;
  if (!token) return { ok: false, error: "The Quo Router Slack bot token is not saved." };
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: input.channel,
      text: input.text,
      thread_ts: input.threadTs || undefined,
      unfurl_links: false,
    }),
  });
  const payload = (await response.json()) as { ok?: boolean; error?: string; ts?: string };
  if (!payload.ok) return { ok: false, error: payload.error || `Slack returned ${response.status}` };
  return { ok: true, ts: payload.ts ?? null };
}

const mentionCache = new Map<string, { at: number; mention: string }>();

export async function channelLeadMention(channel: string, token?: string | null): Promise<string> {
  const cached = mentionCache.get(channel);
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.mention;
  const mention = await lookupChannelLead(channel, token || process.env.SLACK_BOT_TOKEN || "");
  mentionCache.set(channel, { at: Date.now(), mention });
  return mention;
}

async function topicMention(topic: string, label: string, token: string): Promise<string> {
  const linked = topic.match(new RegExp(`${label}\\s+<@([A-Z0-9]+)(?:\\|[^>]+)?>`, "i"))?.[1];
  if (linked) return `<@${linked}>`;
  const named = topic.match(new RegExp(`${label}\\s+@([^\\s|]+)`, "i"))?.[1];
  if (!named || !token) return "";
  const userId = await findUserId(token, named);
  return userId ? `<@${userId}>` : "";
}

async function channelTopic(channel: string, token: string): Promise<string> {
  if (!token) return "";
  const info = await slackApi(token, "conversations.info", { channel });
  return String((info.channel as { topic?: { value?: string } } | undefined)?.topic?.value ?? "");
}

async function lookupChannelLead(channel: string, token: string): Promise<string> {
  return topicMention(await channelTopic(channel, token), "Lead", token);
}

export async function channelOutboundMention(channel: string, token?: string | null): Promise<string> {
  const slackToken = token || process.env.SLACK_BOT_TOKEN || "";
  const topic = await channelTopic(channel, slackToken);
  return (await topicMention(topic, "Outbound", slackToken)) || (await topicMention(topic, "Lead", slackToken));
}

export async function mentionForName(name: string, token?: string | null): Promise<string> {
  const id = await findUserId(token || process.env.SLACK_BOT_TOKEN || "", name);
  return id ? `<@${id}>` : "";
}

async function findUserId(token: string, name: string): Promise<string | null> {
  const needle = name.trim().toLowerCase();
  let cursor = "";
  for (let page = 0; page < 8; page += 1) {
    const payload = await slackApi(token, "users.list", { limit: "200", cursor });
    const members = (payload.members as { id?: string; name?: string; real_name?: string; profile?: { display_name?: string; real_name?: string } }[]) ?? [];
    const match = members.find((member) => {
      const names = [member.name, member.real_name, member.profile?.display_name, member.profile?.real_name];
      return names.some((value) => (value || "").trim().toLowerCase() === needle);
    });
    if (match?.id) return match.id;
    cursor = String((payload.response_metadata as { next_cursor?: string } | undefined)?.next_cursor ?? "");
    if (!cursor) break;
  }
  return null;
}

async function slackApi(token: string, method: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const query = new URLSearchParams(params);
  const response = await fetch(`https://slack.com/api/${method}?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!payload.ok) return {};
  return payload;
}

const SKIP_SUBTYPE = new Set([
  "channel_join",
  "channel_leave",
  "channel_purpose",
  "channel_topic",
  "channel_name",
  "channel_archive",
  "group_join",
  "group_leave",
  "bot_add",
  "bot_remove",
  "pinned_item",
  "unpinned_item",
]);

type SlackHistoryMessage = {
  ts?: string;
  text?: string;
  user?: string;
  username?: string;
  bot_id?: string;
  app_id?: string;
  subtype?: string;
  reply_count?: number;
  attachments?: { fallback?: string; text?: string }[];
};

export type LeadChannelMessage = {
  ts: string;
  text: string;
  permalink: string;
};

const channelNameCache = new Map<string, { at: number; name: string }>();

async function slackChannelLabel(token: string, channelId: string): Promise<string> {
  const cached = channelNameCache.get(channelId);
  if (cached && Date.now() - cached.at < 30 * 60_000) return cached.name;
  const info = await slackMethod(token, "conversations.info", { channel: channelId });
  const channel = info.ok ? (info.payload.channel as { name?: string; name_normalized?: string } | undefined) : undefined;
  const name = channel?.name?.trim() || channel?.name_normalized?.trim() || "";
  const label = name ? `#${name}` : `#${channelId}`;
  channelNameCache.set(channelId, { at: Date.now(), name: label });
  return label;
}

/** Turn Slack user/channel markup leftovers into readable names. */
async function slackTextWithNames(token: string, text: string): Promise<string> {
  let out = text;
  const userIds = [...out.matchAll(/@([UW][A-Z0-9]{6,})/g)].map((match) => match[1]);
  const userNames = new Map<string, string>();
  for (const id of [...new Set(userIds)]) userNames.set(id, await slackUserName(token, id, "a teammate"));
  out = out.replace(/@([UW][A-Z0-9]{6,})/g, (_mention, id: string) => userNames.get(id) || _mention);

  // Bare channel ids (often from <#C…> after markup strip) → #channel-name
  const channelIds = [...out.matchAll(/#?([CGD][A-Z0-9]{8,})\b/g)].map((match) => match[1]);
  const channelNames = new Map<string, string>();
  for (const id of [...new Set(channelIds)]) channelNames.set(id, await slackChannelLabel(token, id));
  out = out.replace(/#?([CGD][A-Z0-9]{8,})\b/g, (_match, id: string) => channelNames.get(id) || `#${id}`);
  return out;
}

function slackMessageText(message: SlackHistoryMessage): string {
  const chunks = [message.text || ""];
  for (const attachment of message.attachments ?? []) {
    chunks.push(attachment.fallback || attachment.text || "");
  }
  return chunks
    .join("\n")
    .replace(/<#([CGD][A-Z0-9]+)(?:\|([^>]+))?>/gi, (_match, id: string, label?: string) =>
      label?.trim() ? `#${label.trim()}` : `#${id}`,
    )
    .replace(/<([^|>]+)\|([^>]+)>/g, "$2")
    .replace(/<tel:[^|>]*\|([^>]+)>/g, "$1")
    .replace(/<([^>]+)>/g, "$1")
    .trim();
}

function channelPermalink(channel: string, ts: string): string {
  return `https://ramosjames.slack.com/archives/${channel}/p${ts.replace(".", "")}`;
}

async function slackMethod(
  token: string,
  method: string,
  params: Record<string, string>,
): Promise<{ ok: true; payload: Record<string, unknown> } | { ok: false; error: string }> {
  const query = new URLSearchParams(params);
  const response = await fetch(`https://slack.com/api/${method}?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!payload.ok) return { ok: false, error: String(payload.error || `Slack returned ${response.status}`) };
  return { ok: true, payload };
}

function visibleMessages(channel: string, messages: SlackHistoryMessage[]): LeadChannelMessage[] {
  const rows: LeadChannelMessage[] = [];
  for (const message of messages) {
    if (!message.ts || (message.subtype && SKIP_SUBTYPE.has(message.subtype))) continue;
    const text = slackMessageText(message);
    if (!text) continue;
    rows.push({ ts: message.ts, text: text.slice(0, 2000), permalink: channelPermalink(channel, message.ts) });
  }
  return rows;
}

/** Parent posts in #lead-calls, including the thread replies under each one. */
export async function readLeadChannel(input: {
  token: string | null;
  channel: string;
  cursor?: string;
}): Promise<{ messages: LeadChannelMessage[]; nextCursor: string | null; error: string | null }> {
  if (!input.token) return { messages: [], nextCursor: null, error: "no_token" };
  const params: Record<string, string> = { channel: input.channel, limit: "15" };
  if (input.cursor) params.cursor = input.cursor;
  const history = await slackMethod(input.token, "conversations.history", params);
  if (!history.ok) return { messages: [], nextCursor: null, error: history.error };

  const parents = (history.payload.messages as SlackHistoryMessage[]) ?? [];
  const threads = await Promise.all(
    parents.map(async (message) => {
      if (!message.ts || !(message.reply_count && message.reply_count > 0)) return [message];
      const replies = await slackMethod(input.token || "", "conversations.replies", {
        channel: input.channel,
        ts: message.ts,
        limit: "100",
      });
      if (!replies.ok) return [message];
      return (replies.payload.messages as SlackHistoryMessage[]) ?? [message];
    }),
  );

  const seen = new Set<string>();
  const messages = threads
    .flatMap((thread) => visibleMessages(input.channel, thread))
    .filter((message) => {
      if (seen.has(message.ts)) return false;
      seen.add(message.ts);
      return true;
    })
    .sort((a, b) => Number(b.ts) - Number(a.ts))
    .slice(0, 80);

  const nextCursor = String(
    (history.payload.response_metadata as { next_cursor?: string } | undefined)?.next_cursor ?? "",
  );
  return { messages, nextCursor: nextCursor || null, error: null };
}

export type SlackThreadNote = {
  id: string;
  ts: string;
  occurred_at: string;
  userName: string;
  text: string;
};

const userNameCache = new Map<string, { at: number; name: string }>();

function looksLikeQuoPost(text: string): boolean {
  if (/view in quo|openphone\.com|app\.quo\.com/i.test(text) && /handled by:|summary:|^from:/im.test(text)) return true;
  const first = text.trim().split("\n")[0]?.replace(/\*/g, "").trim() ?? "";
  if (first.startsWith("Excluded ·") || first === "Return call") return true;
  if (/outside practice/i.test(first) && /view in quo|openphone/i.test(text)) return true;
  if (/human call completed|qualified lead|lead call|missed call/i.test(first) && /handled by:|view in quo/i.test(text)) {
    return true;
  }
  return false;
}

function isHumanSlackNote(message: SlackHistoryMessage): boolean {
  if (!message.ts || !message.user) return false;
  if (message.bot_id || message.app_id) return false;
  if (message.subtype && message.subtype !== "file_share" && message.subtype !== "thread_broadcast") return false;
  const text = slackMessageText(message);
  if (!text || looksLikeQuoPost(text)) return false;
  return true;
}

function slackTsToIso(ts: string): string {
  const seconds = Number(ts);
  if (!Number.isFinite(seconds)) return new Date().toISOString();
  return new Date(seconds * 1000).toISOString();
}

export function parseSlackPermalink(url: string | null | undefined): { channel: string; ts: string } | null {
  const match = (url || "").match(/\/archives\/([CGD][A-Z0-9]+)\/p(\d{16,})/i);
  if (!match) return null;
  const stamp = match[2];
  return { channel: match[1], ts: `${stamp.slice(0, -6)}.${stamp.slice(-6)}` };
}

async function slackUserName(token: string, userId: string, fallback: string): Promise<string> {
  const cached = userNameCache.get(userId);
  if (cached && Date.now() - cached.at < 30 * 60_000) return cached.name;
  const info = await slackMethod(token, "users.info", { user: userId });
  const user = info.ok
    ? (info.payload.user as { real_name?: string; profile?: { display_name?: string; real_name?: string } } | undefined)
    : undefined;
  const name =
    user?.profile?.real_name?.trim() ||
    user?.real_name?.trim() ||
    user?.profile?.display_name?.trim() ||
    fallback ||
    "Staff";
  userNameCache.set(userId, { at: Date.now(), name });
  return name;
}

async function threadMessages(token: string, channel: string, ts: string): Promise<SlackHistoryMessage[]> {
  const rows: SlackHistoryMessage[] = [];
  let cursor = "";
  for (let page = 0; page < 8; page += 1) {
    const params: Record<string, string> = { channel, ts, limit: "200" };
    if (cursor) params.cursor = cursor;
    const replies = await slackMethod(token, "conversations.replies", params);
    if (!replies.ok) break;
    rows.push(...((replies.payload.messages as SlackHistoryMessage[]) ?? []));
    cursor = String((replies.payload.response_metadata as { next_cursor?: string } | undefined)?.next_cursor ?? "");
    if (!cursor) break;
  }
  return rows;
}

/** Staff notes in the lead Slack thread. Quo app posts are left out; those already live as calls and texts. */
export async function slackThreadNotes(input: {
  token: string | null;
  channelId: string | null;
  threadTs: string | null;
  permalink?: string | null;
}): Promise<SlackThreadNote[]> {
  if (!input.token) return [];
  const parsed = parseSlackPermalink(input.permalink);
  const channel = input.channelId || parsed?.channel || "";
  const ts = input.threadTs || parsed?.ts || "";
  if (!channel || !ts) return [];
  const messages = (await threadMessages(input.token, channel, ts)).filter(isHumanSlackNote);
  const notes: SlackThreadNote[] = [];
  for (const message of messages) {
    const userId = message.user || "";
    const userName = userId ? await slackUserName(input.token, userId, message.username || "Staff") : message.username || "Staff";
    notes.push({
      id: `slack-${message.ts}`,
      ts: message.ts || "",
      occurred_at: slackTsToIso(message.ts || ""),
      userName,
      text: (await slackTextWithNames(input.token, slackMessageText(message))).slice(0, 4000),
    });
  }
  notes.sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : a.occurred_at > b.occurred_at ? -1 : 0));
  return notes;
}
