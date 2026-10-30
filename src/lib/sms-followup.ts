/** Talk to the SMS Follow-Up service (enroll / stop text sequences). */

function config() {
  const base = process.env.SMS_FOLLOWUP_URL?.replace(/\/$/, "");
  const token = process.env.SMS_FOLLOWUP_TOKEN || process.env.INTAKE_ENROLL_TOKEN;
  return { base, token };
}

export async function stopSmsFollowUp(
  phone: string,
  actor: string,
): Promise<{ ok: boolean; reason?: string; stopped?: number }> {
  const { base, token } = config();
  if (!base || !token) return { ok: false, reason: "not_configured" };
  const response = await fetch(`${base}/api/intake/stop`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ phone, actor }),
  });
  const data = (await response.json().catch(() => null)) as { ok?: boolean; reason?: string; stopped?: number } | null;
  if (!data) return { ok: false, reason: "unreachable" };
  return { ok: Boolean(data.ok), reason: data.reason, stopped: data.stopped };
}

export async function updateSmsFollowUpContact(body: {
  phone: string;
  first_name?: string | null;
  last_name?: string | null;
  actor?: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const { base, token } = config();
  if (!base || !token) return { ok: false, reason: "not_configured" };
  const response = await fetch(`${base}/api/intake/contact`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => null)) as { ok?: boolean; reason?: string } | null;
  if (!data) return { ok: false, reason: "unreachable" };
  return { ok: Boolean(data.ok), reason: data.reason };
}

export async function enrollSmsFollowUp(body: Record<string, unknown>): Promise<{
  ok: boolean;
  reason?: string;
  next_run_at?: string | null;
  sequence?: { slug?: string };
  status?: string | null;
}> {
  const { base, token } = config();
  if (!base || !token) return { ok: false, reason: "not_configured" };
  const response = await fetch(`${base}/api/intake/enroll`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => null)) as {
    ok?: boolean;
    reason?: string;
    next_run_at?: string | null;
    sequence?: { slug?: string };
    status?: string | null;
  } | null;
  if (!data) return { ok: false, reason: "unreachable" };
  return {
    ok: Boolean(data.ok),
    reason: data.reason,
    next_run_at: data.next_run_at,
    sequence: data.sequence,
    status: data.status ?? null,
  };
}
