import { captureSlackMessage } from "@/lib/ingest";
import { verifySlackRequest } from "@/lib/slack";
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
  };
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
