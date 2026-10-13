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
}>(leads: T[], save: (id: string, source: string) => Promise<void>): Promise<void> {
  if (!callrailConfigured()) return;
  const missing = leads.filter((lead) => !lead.lead_source?.trim() && /callrail\.com/i.test(lead.case_detail ?? ""));
  if (!missing.length) return;
  const dates = missing.map((lead) => (lead.lead_date ?? lead.created_at).slice(0, 10)).sort();
  const end = new Date(`${dates[dates.length - 1]}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  let sources: Map<string, string>;
  try {
    sources = await fetchCallrailSources(dates[0], end.toISOString().slice(0, 10));
  } catch {
    return;
  }
  await Promise.all(
    missing.map(async (lead) => {
      const callId = callrailCallId(lead.case_detail)?.toUpperCase();
      const source = callId ? sources.get(callId) : null;
      if (!source) return;
      lead.lead_source = source;
      await save(lead.id, source).catch(() => undefined);
    }),
  );
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
