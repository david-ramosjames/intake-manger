import { canonicalLeadSource } from "@/lib/leads";
import { languageFromCallrailCall, languageFromPageViews, type PreferredLanguage } from "@/lib/preferred-language";

export function callrailConfigured(): boolean {
  return Boolean(process.env.CALLRAIL_API_KEY && process.env.CALLRAIL_ACCOUNT_ID);
}

async function callrail(path: string, init?: RequestInit) {
  const account = process.env.CALLRAIL_ACCOUNT_ID;
  const key = process.env.CALLRAIL_API_KEY;
  if (!account || !key) throw new Error("CallRail is not configured.");
  const response = await fetch(`https://api.callrail.com/v3/a/${account}${path}`, {
    ...init,
    headers: {
      Authorization: `Token token=${key}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`CallRail returned ${response.status}: ${raw.slice(0, 240)}`);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

export async function fetchCallrailTags(): Promise<{ id: string; name: string }[]> {
  const payload = await callrail("/tags.json");
  const list = Array.isArray(payload.tags) ? payload.tags : [];
  return list
    .map((tag) => {
      const row = tag as { id?: string | number; name?: string };
      return { id: String(row.id ?? ""), name: String(row.name ?? "").trim() };
    })
    .filter((tag) => tag.name);
}

export function callrailCallId(text: string | null | undefined): string | null {
  return text?.match(/event_id=(CAL[0-9a-f]+)/i)?.[1] ?? null;
}

export type CallrailCallMeta = {
  id: string;
  source: string | null;
  trackingName: string | null;
  landingPageUrl: string | null;
  lastRequestedUrl: string | null;
  campaign: string | null;
  utmCampaign: string | null;
  milestones: unknown;
};

const CALL_LANGUAGE_FIELDS = [
  "source",
  "source_name",
  "landing_page_url",
  "last_requested_url",
  "milestones",
  "campaign",
  "utm_campaign",
].join(",");

/** One CallRail call — landing page and tracker name for language / source. */
export async function fetchCallrailCall(callId: string): Promise<CallrailCallMeta | null> {
  const id = callId.trim();
  if (!id || !callrailConfigured()) return null;
  try {
    // landing_page_url and milestones are omitted unless requested. Website Pool
    // (Bing, ChatGPT, and other session calls) keeps lang= on those fields.
    const payload = await callrail(
      `/calls/${encodeURIComponent(id)}.json?fields=${CALL_LANGUAGE_FIELDS}`,
    );
    const row = payload as {
      id?: string;
      source?: string | null;
      source_name?: string | null;
      tracking_number_name?: string | null;
      name?: string | null;
      landing_page_url?: string | null;
      last_requested_url?: string | null;
      campaign?: string | null;
      utm_campaign?: string | null;
      milestones?: unknown;
    };
    return {
      id: String(row.id || id),
      source: String(row.source ?? "").trim() || null,
      trackingName: String(row.source_name ?? row.tracking_number_name ?? row.name ?? "").trim() || null,
      landingPageUrl: String(row.landing_page_url ?? "").trim() || null,
      lastRequestedUrl: String(row.last_requested_url ?? "").trim() || null,
      campaign: String(row.campaign ?? "").trim() || null,
      utmCampaign: String(row.utm_campaign ?? "").trim() || null,
      milestones: row.milestones ?? null,
    };
  } catch {
    return null;
  }
}

type CallrailPageView = { page_url?: string | null; referrer_url?: string | null };

/** Newest page view first. Later pages hold the earlier landing page. */
export async function fetchCallrailPageViews(callId: string): Promise<CallrailPageView[]> {
  const id = callId.trim();
  if (!id || !callrailConfigured()) return [];
  try {
    const first = await callrail(`/calls/${encodeURIComponent(id)}/page_views.json?per_page=100&page=1`);
    const newest = Array.isArray(first.page_views) ? (first.page_views as CallrailPageView[]) : [];
    const pages = Number(first.total_pages ?? 1);
    if (!Number.isFinite(pages) || pages <= 1) return newest;
    const last = await callrail(`/calls/${encodeURIComponent(id)}/page_views.json?per_page=100&page=${pages}`);
    const oldest = Array.isArray(last.page_views) ? (last.page_views as CallrailPageView[]) : [];
    return [...newest, ...oldest];
  } catch {
    return [];
  }
}

/** Landing page, campaign, then the session page the caller opened before dialing. */
export async function languageForCallrailId(callId: string): Promise<PreferredLanguage | null> {
  const id = callId.trim();
  if (!id) return null;
  const meta = await fetchCallrailCall(id);
  const fromCall = meta ? languageFromCallrailCall(meta) : null;
  if (fromCall) return fromCall;
  return languageFromPageViews(await fetchCallrailPageViews(id));
}

function isoDate(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function metaFromCall(row: Record<string, unknown>, fallbackId: string): CallrailCallMeta {
  return {
    id: String(row.id || fallbackId),
    source: String(row.source ?? "").trim() || null,
    trackingName: String(row.source_name ?? row.tracking_number_name ?? row.name ?? "").trim() || null,
    landingPageUrl: String(row.landing_page_url ?? "").trim() || null,
    lastRequestedUrl: String(row.last_requested_url ?? "").trim() || null,
    campaign: String(row.campaign ?? "").trim() || null,
    utmCampaign: String(row.utm_campaign ?? "").trim() || null,
    milestones: row.milestones ?? null,
  };
}

/**
 * The missed-call text has the caller's number and no CallRail id.
 * The newest call for that number already has the landing page.
 */
export async function languageForCallerPhone(
  phone: string,
): Promise<{ language: PreferredLanguage | null; callId: string | null }> {
  const digits = phone.replace(/\D/g, "").slice(-10);
  if (digits.length < 10 || !callrailConfigured()) return { language: null, callId: null };
  try {
    const params = new URLSearchParams({
      search: digits,
      start_date: isoDate(-1),
      end_date: isoDate(1),
      per_page: "5",
    });
    const payload = await callrail(`/calls.json?${params.toString()}&fields=${CALL_LANGUAGE_FIELDS}`);
    const calls = (Array.isArray(payload.calls) ? payload.calls : [])
      .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
      .sort((a, b) => {
        const left = Date.parse(String(a.start_time ?? ""));
        const right = Date.parse(String(b.start_time ?? ""));
        return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0);
      });
    const newest = calls[0];
    if (!newest) return { language: null, callId: null };
    const callId = String(newest.id ?? "").trim().toUpperCase() || null;
    const fromCall = languageFromCallrailCall(metaFromCall(newest, callId ?? ""));
    if (fromCall) return { language: fromCall, callId };
    if (!callId) return { language: null, callId: null };
    return { language: languageFromPageViews(await fetchCallrailPageViews(callId)), callId };
  } catch {
    return { language: null, callId: null };
  }
}

export async function fetchCallrailSources(startDate: string, endDate: string): Promise<Map<string, string>> {
  const sources = new Map<string, string>();
  for (let page = 1; page <= 20; page += 1) {
    const params = new URLSearchParams({
      start_date: startDate,
      end_date: endDate,
      per_page: "250",
      page: String(page),
    });
    const payload = await callrail(`/calls.json?${params.toString()}`);
    const calls = Array.isArray(payload.calls) ? payload.calls : [];
    for (const call of calls) {
      const row = call as { id?: string; source?: string | null };
      const source = String(row.source ?? "").trim();
      if (row.id && source) sources.set(String(row.id).toUpperCase(), source);
    }
    const total = Number(payload.total_pages ?? page);
    if (page >= total || calls.length === 0) break;
  }
  return sources;
}

export async function attachCallrailSources<T extends {
  id: string;
  lead_source: string | null;
  lead_date: string | null;
  created_at: string;
  case_detail: string | null;
  callrail_call_id?: string | null;
}>(
  leads: T[],
  save: (id: string, source: string, type: string | null) => Promise<void>,
): Promise<number> {
  if (!callrailConfigured()) return 0;
  const missing = leads.filter(
    (lead) =>
      !lead.lead_source?.trim() &&
      (Boolean(lead.callrail_call_id?.trim()) || /callrail\.com/i.test(lead.case_detail ?? "")),
  );
  if (!missing.length) return 0;
  const dates = missing.map((lead) => (lead.lead_date ?? lead.created_at).slice(0, 10)).sort();
  const end = new Date(`${dates[dates.length - 1]}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  let sources: Map<string, string>;
  try {
    sources = await fetchCallrailSources(dates[0], end.toISOString().slice(0, 10));
  } catch {
    return 0;
  }
  let filled = 0;
  await Promise.all(
    missing.map(async (lead) => {
      const callId = (lead.callrail_call_id?.trim() || callrailCallId(lead.case_detail) || "").toUpperCase();
      const raw = callId ? sources.get(callId) : null;
      if (!raw) return;
      const canonical = canonicalLeadSource(raw);
      if (!canonical.source) return;
      try {
        await save(lead.id, canonical.source, canonical.type || null);
        lead.lead_source = canonical.source;
        filled += 1;
      } catch {
        // Keep going. A later pass can retry this CallRail source.
      }
    }),
  );
  return filled;
}

function tagNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((tag) => {
      if (typeof tag === "string") return tag.trim();
      if (tag && typeof tag === "object" && "name" in tag) return String((tag as { name?: string }).name ?? "").trim();
      return "";
    })
    .filter(Boolean);
}

/** Keep tags that are not part of this set, then apply the lead's current tags. */
export async function pushCallrailTags(callId: string, tags: string[], managed: readonly string[]): Promise<void> {
  const payload = await callrail(`/calls/${encodeURIComponent(callId)}.json`);
  const owned = new Set(managed);
  const kept = tagNames(payload.tags).filter((tag) => !owned.has(tag));
  const next = [...new Set([...kept, ...tags])];
  await callrail(`/calls/${encodeURIComponent(callId)}.json`, {
    method: "PUT",
    body: JSON.stringify({ tags: next }),
  });
}
