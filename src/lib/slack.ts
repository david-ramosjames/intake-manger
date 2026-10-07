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
}): Promise<{ ok: true; ts: string | null } | { ok: false; error: string }> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return { ok: false, error: "SLACK_BOT_TOKEN is not set." };
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
