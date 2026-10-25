import { toE164 } from "./phone";
import { createSupabaseServiceClient } from "./supabase/service";

export type QuoLine = {
  number: string;
  label: string;
};

/** Firm lines, used when Quo has not returned a list yet. */
const FIRM_LINES: QuoLine[] = [
  { number: "+15125373369", label: "RJL Main Line" },
  { number: "+19563137771", label: "RGV Number" },
  { number: "+15127643037", label: "Leads" },
  { number: "+15126010647", label: "Intake" },
  { number: "+15125005266", label: "RJL Outbound" },
  { number: "+15126300907", label: "RJL Transfers" },
];

/** Referral texts start on the Leads line unless staff pick another number. */
export const DEFAULT_REFERRAL_FROM = "+15127643037";

export type QuoSettings = {
  apiKey: string | null;
  keySet: boolean;
  fromNumber: string | null;
};

export function formatQuoNumber(number: string): string {
  const digits = number.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return number;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

export function quoLineLabel(line: QuoLine): string {
  return `${line.label} · ${formatQuoNumber(line.number)}`;
}

export async function loadQuoSettings(): Promise<QuoSettings> {
  const supabase = createSupabaseServiceClient();
  const { data } = await supabase
    .from("intake_settings")
    .select("quo_api_key, quo_from_number")
    .eq("id", "default")
    .maybeSingle();
  const storedKey = typeof data?.quo_api_key === "string" ? data.quo_api_key.trim() : "";
  const storedFrom = typeof data?.quo_from_number === "string" ? data.quo_from_number.trim() : "";
  const apiKey = storedKey || process.env.QUO_API_KEY?.trim() || null;
  const fromNumber = toE164(storedFrom) || toE164(process.env.QUO_FROM_NUMBER) || null;
  return { apiKey, keySet: Boolean(apiKey), fromNumber };
}

export async function listQuoLines(apiKey: string | null): Promise<{ lines: QuoLine[]; warning: string | null }> {
  if (!apiKey) return { lines: FIRM_LINES, warning: null };
  const base = (process.env.QUO_API_BASE || "https://api.quo.com/v1").replace(/\/$/, "");
  try {
    const response = await fetch(`${base}/phone-numbers`, {
      headers: { Authorization: apiKey },
      cache: "no-store",
    });
    const raw = await response.text();
    if (!response.ok) {
      return { lines: FIRM_LINES, warning: `Quo returned ${response.status} for the number list. Showing the firm lines.` };
    }
    const parsed = raw ? (JSON.parse(raw) as { data?: unknown }) : {};
    const list = Array.isArray(parsed?.data) ? parsed.data : [];
    const lines = list
      .map((item) => {
        const row = item as { name?: string; label?: string; number?: string; phoneNumber?: string; e164?: string };
        const number = toE164(row.number || row.phoneNumber || row.e164);
        if (!number) return null;
        const label = String(row.name || row.label || "Quo number").trim() || "Quo number";
        return { number, label };
      })
      .filter((line): line is QuoLine => Boolean(line));
    if (!lines.length) return { lines: FIRM_LINES, warning: "Quo returned no numbers. Showing the firm lines." };
    lines.sort((a, b) => a.label.localeCompare(b.label));
    return { lines, warning: null };
  } catch {
    return { lines: FIRM_LINES, warning: "Could not reach Quo. Showing the firm lines." };
  }
}
