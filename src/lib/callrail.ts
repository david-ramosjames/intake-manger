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

export async function pushCallrailTags(callId: string, tags: string[]): Promise<void> {
  await callrail(`/calls/${encodeURIComponent(callId)}.json`, {
    method: "PUT",
    body: JSON.stringify({ tags }),
  });
}
