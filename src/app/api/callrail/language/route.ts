import { languageForCallerPhone, languageForCallrailId } from "@/lib/callrail";

export const runtime = "nodejs";

/** The text service asks this before the first missed-call text. CallRail credentials stay here. */
export async function POST(request: Request) {
  const token = process.env.INTAKE_ENROLL_TOKEN || process.env.SMS_FOLLOWUP_TOKEN || "";
  const header = request.headers.get("authorization") ?? "";
  if (!token || header !== `Bearer ${token}`) {
    return new Response("unauthorized", { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { call_id?: unknown; phone?: unknown } | null;
  const callId = typeof body?.call_id === "string" ? body.call_id.trim() : "";
  if (/^CAL[0-9a-f]+$/i.test(callId)) {
    const language = await languageForCallrailId(callId);
    return Response.json({ language, call_id: callId.toUpperCase() });
  }
  const phone = typeof body?.phone === "string" ? body.phone : "";
  if (phone.replace(/\D/g, "").length < 10) {
    return Response.json({ language: null, call_id: null });
  }
  const found = await languageForCallerPhone(phone);
  return Response.json({ language: found.language, call_id: found.callId });
}
