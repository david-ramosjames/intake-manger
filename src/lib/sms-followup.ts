/** Talk to the SMS Follow-Up service (enroll / stop text sequences). */

import type { SupabaseClient } from "@supabase/supabase-js";
import { phoneTail } from "@/lib/phone";
import { isPracticeTestPhone } from "@/lib/test-phone";

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

export type LiveTextSequence = {
  slug: string;
  nextAt: string | null;
};

/**
 * Numbers that currently have a series sending, keyed by the last 10 digits.
 * Null means the sender could not be asked — leave the lead column alone.
 */
export async function lookupLiveTextSequences(phones: string[]): Promise<Map<string, LiveTextSequence> | null> {
  const { base, token } = config();
  const unique = [...new Set(phones.map((phone) => phone.trim()).filter(Boolean))].slice(0, 500);
  if (!base || !token || unique.length === 0) return null;
  const response = await fetch(`${base}/api/intake/status`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ phones: unique }),
    cache: "no-store",
    signal: AbortSignal.timeout(4000),
  }).catch(() => null);
  if (!response?.ok) return null;
  const data = (await response.json().catch(() => null)) as {
    ok?: boolean;
    active?: { phone_e164?: string; slug?: string; next_run_at?: string | null }[];
  } | null;
  if (!data?.ok || !Array.isArray(data.active)) return null;
  const live = new Map<string, LiveTextSequence>();
  for (const row of data.active) {
    const tail = phoneTail(row.phone_e164);
    if (tail.length < 10 || !row.slug) continue;
    live.set(tail, { slug: row.slug, nextAt: row.next_run_at ?? null });
  }
  return live;
}

type LeadTextFields = {
  id: string;
  phone?: string | null;
  phone_e164?: string | null;
  text_sequence_status?: string | null;
  text_sequence_slug?: string | null;
  text_next_at?: string | null;
  lead_status?: string | null;
  signed_case?: boolean | null;
  case_id?: string | null;
};

const CLOSED_FOR_TEXTS = new Set(["Lost", "Referred", "Promoted", "Signed"]);

function closedForTexts(lead: LeadTextFields): boolean {
  if (isPracticeTestPhone(lead.phone_e164 || lead.phone)) return false;
  return Boolean(lead.signed_case || lead.case_id || CLOSED_FOR_TEXTS.has(String(lead.lead_status ?? "")));
}

/**
 * Copy the sender's live series onto these leads. The lead column is a mirror
 * and can lag, which left Start SMS up while texts were already going out.
 * Closed leads never get re-activated — leftover live series are stopped.
 */
export async function applyLiveTextSequences<T extends LeadTextFields>(
  supabase: SupabaseClient,
  leads: T[],
): Promise<T[]> {
  if (leads.length === 0) return leads;
  const live = await lookupLiveTextSequences(leads.map((lead) => lead.phone_e164 || lead.phone || ""));
  if (!live) return leads;
  const heal: { phone: string; id: string }[] = [];
  const next = leads.map((lead) => {
    const phone = lead.phone_e164 || lead.phone || "";
    const tail = phoneTail(phone);
    const hit = tail.length >= 10 ? live.get(tail) : undefined;
    if (!hit) return lead;
    if (closedForTexts(lead)) {
      heal.push({ phone, id: lead.id });
      if ((lead.text_sequence_status || "").toLowerCase() === "stopped" && !lead.text_next_at) return lead;
      return {
        ...lead,
        text_sequence_status: "stopped",
        text_next_at: null,
      };
    }
    const wasActive = (lead.text_sequence_status || "").toLowerCase() === "active";
    if (wasActive && (lead.text_sequence_slug || "") === hit.slug) return lead;
    return {
      ...lead,
      text_sequence_status: "active",
      text_sequence_slug: hit.slug,
      text_next_at: hit.nextAt,
    };
  });
  const stale = next.filter((lead, index) => lead !== leads[index]);
  if (stale.length) {
    await Promise.all(
      stale.map((lead) =>
        supabase
          .from("leads")
          .update({
            text_sequence_status: lead.text_sequence_status,
            text_sequence_slug: lead.text_sequence_slug,
            text_next_at: lead.text_next_at,
          })
          .eq("id", lead.id),
      ),
    ).catch(() => undefined);
  }
  if (heal.length) {
    await Promise.all(
      heal.map(({ phone }) => stopSmsFollowUp(phone, "intake-manager:closed").catch(() => ({ ok: false }))),
    ).catch(() => undefined);
  }
  return next;
}
