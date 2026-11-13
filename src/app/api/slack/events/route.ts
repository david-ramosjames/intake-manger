import { captureSlackMessage } from "@/lib/ingest";
import { verifySlackRequest } from "@/lib/slack";
import type { SlackEmailFile } from "@/lib/slack-email";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

function asEvent(value: Record<string, unknown>) {
  const stringOr = (key: string) => (typeof value[key] === "string" ? (value[key] as string) : undefined);
  return {
    type: stringOr("type"),
    subtype: stringOr("subtype"),
    channel: stringOr("channel"),
    ts: stringOr("ts"),
    thread_ts: stringOr("thread_ts"),
    text: stringOr("text"),
    bot_id: stringOr("bot_id"),
    app_id: stringOr("app_id"),
    attachments: Array.isArray(value.attachments) ? value.attachments : [],
    blocks: Array.isArray(value.blocks) ? value.blocks : [],
    files: emailFiles(value.files),
  };
}

function emailFiles(value: unknown): SlackEmailFile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const file = item as Record<string, unknown>;
    const text = (key: string) => (typeof file[key] === "string" ? (file[key] as string) : undefined);
    const id = text("id");
    if (!id) return [];
    return [{ id, mode: text("mode"), filetype: text("filetype"), mimetype: text("mimetype"), name: text("name"), title: text("title"), subject: text("subject") }];
  });
}

export async function POST(request: Request) {
  const raw = await request.text();
  let payload: { type?: string; challenge?: string; event?: Record<string, unknown> };
  try {
    payload = JSON.parse(raw) as typeof payload;
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  if (payload.type === "url_verification" && payload.challenge) {
    if (!verifySlackRequest(raw, request.headers)) {
      return new Response("invalid signature", { status: 401 });
    }
    return Response.json({ challenge: payload.challenge });
  }

  if (!verifySlackRequest(raw, request.headers)) {
    return new Response("invalid signature", { status: 401 });
  }

  if (payload.type === "event_callback" && payload.event) {
    try {
      await captureSlackMessage(createSupabaseServiceClient(), asEvent(payload.event));
    } catch (error) {
      console.error("slack lead capture failed", error);
    }
  }

  return new Response("ok");
}
