export function quoTextReady(): boolean {
  return Boolean(process.env.QUO_API_KEY && process.env.QUO_FROM_NUMBER);
}

export async function sendQuoText(to: string, content: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = process.env.QUO_API_KEY;
  const from = process.env.QUO_FROM_NUMBER;
  if (!key || !from) return { ok: false, error: "Quo sending is not configured." };
  const base = (process.env.QUO_API_BASE || "https://api.quo.com/v1").replace(/\/$/, "");
  const response = await fetch(`${base}/messages`, {
    method: "POST",
    headers: { Authorization: key, "Content-Type": "application/json" },
    body: JSON.stringify({ content, from, to: [to] }),
  });
  if (response.ok) return { ok: true };
  const raw = await response.text();
  return { ok: false, error: `Quo returned ${response.status}: ${raw.slice(0, 240)}` };
}
