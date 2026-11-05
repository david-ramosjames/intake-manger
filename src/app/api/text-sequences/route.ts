import { lookupLiveTextSequences } from "@/lib/sms-followup";
import { requireStaff } from "@/lib/session";

export async function POST(request: Request) {
  await requireStaff();
  const body = (await request.json().catch(() => null)) as { phones?: unknown } | null;
  const phones = Array.isArray(body?.phones) ? body.phones.filter((phone): phone is string => typeof phone === "string") : [];
  const live = await lookupLiveTextSequences(phones);
  if (!live) return Response.json({ ok: false, active: {} });
  const active: Record<string, { slug: string; nextAt: string | null }> = {};
  for (const [tail, row] of live) active[tail] = row;
  return Response.json({ ok: true, active });
}
