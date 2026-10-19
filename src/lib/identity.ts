import type { SupabaseClient } from "@supabase/supabase-js";
import { nameFromSummary } from "./slack-lead";

export type StaffPerson = {
  name: string;
  email: string | null;
  slackUserId: string | null;
};

export async function loadStaff(supabase: SupabaseClient): Promise<StaffPerson[]> {
  const { data, error } = await supabase
    .from("contacts")
    .select("name, email, slack_user_id, listed")
    .eq("listed", true)
    .order("name");
  if (error) throw new Error(error.message);
  return ((data ?? []) as { name: string | null; email: string | null; slack_user_id: string | null; listed: boolean | null }[])
    .filter((person) => person.listed !== false && person.name && !/^(referred|legal assistant)$/i.test(person.name.trim()))
    .map((person) => ({
      name: person.name!.trim(),
      email: person.email,
      slackUserId: person.slack_user_id,
    }));
}

function norm(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function staffAliases(person: StaffPerson): string[] {
  const aliases = [person.name];
  const local = person.email?.split("@")[0]?.toLowerCase() ?? "";
  const parts = person.name.split(/\s+/);
  const first = parts[0]?.toLowerCase() ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  const lastKey = last.toLowerCase().replace(/[^a-z]/g, "");
  if (
    last &&
    /^[a-z]{4,12}$/.test(local) &&
    local !== first &&
    lastKey &&
    !local.includes(lastKey)
  ) {
    aliases.push(`${local[0]!.toUpperCase()}${local.slice(1)} ${last}`);
  }
  return aliases;
}

export function matchStaff(name: string | null | undefined, staff: StaffPerson[]): StaffPerson | null {
  const key = norm(name ?? "");
  if (key.length < 3) return null;
  return staff.find((person) => staffAliases(person).some((alias) => norm(alias) === key)) ?? null;
}

/** The name from the call, without the explanation stored beside older leads. */
export function heardClientName(evidence: string | null | undefined): string | null {
  const text = String(evidence || "").trim();
  if (!text) return null;
  const current = text.match(/^Heard (.+?)\.?$/);
  if (current) return current[1];
  const legacy = text.match(/heard the client name (.+?)\./) || text.match(/used “([^”]+)”/) || text.match(/used "([^"]+)"/);
  return legacy?.[1] ?? null;
}

export function suggestClientName(summary: string | null | undefined, staff: StaffPerson[]): string | null {
  const hinted = nameFromSummary(summary);
  if (hinted && !matchStaff(hinted, staff)) return hinted;
  const specialist = summary?.match(/intake specialist\s+([A-Z][A-Za-z'’.-]{2,})/)?.[1];
  if (specialist && !matchStaff(specialist, staff)) return specialist;
  return null;
}

export function firmEmail(email: string | null | undefined): boolean {
  return (email ?? "").trim().toLowerCase().endsWith("@ramosjames.com");
}
