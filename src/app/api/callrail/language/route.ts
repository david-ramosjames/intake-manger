import { languageForCallrailId } from "@/lib/callrail";

export const runtime = "nodejs";

/** The text service asks this before the first missed-call text. CallRail credentials stay here. */
export async function POST(request: Request) {
  const token = process.env.INTAKE_ENROLL_TOKEN || process.env.SMS_FOLLOWUP_TOKEN || "";
  const header = request.headers.get("authorization") ?? "";
  if (!token || header !== `Bearer ${token}`) {
    return new Response("unauthorized", { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { call_id?: unknown } | null;
  const callId = typeof body?.call_id === "string" ? body.call_id.trim() : "";
  if (!/^CAL[0-9a-f]+$/i.test(callId)) {
    return Response.json({ language: null });
  }
  const language = await languageForCallrailId(callId);
  return Response.json({ language });
}
