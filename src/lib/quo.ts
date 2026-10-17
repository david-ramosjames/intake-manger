import { loadQuoSettings } from "./quo-settings";

export async function sendQuoText(to: string, content: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const settings = await loadQuoSettings();
  const key = settings.apiKey;
  const from = settings.fromNumber;
  if (!key) return { ok: false, error: "Quo sending is not configured." };
  if (!from) return { ok: false, error: "Choose the Quo number on How it fits." };
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
