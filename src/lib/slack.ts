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
