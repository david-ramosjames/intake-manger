import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "./supabase/service";

const FIRM = "@ramosjames.com";

export type StaffContact = {
  id: string;
  name: string;
  email: string;
  slackUserId: string | null;
  listed: boolean;
};

export function isDirectoryPlaceholder(name: string, email: string): boolean {
  return /^(referred|legal assistant)$/i.test(name.trim()) || email.trim().toLowerCase() === "referred";
}

export async function loadStaffDirectory(supabase: SupabaseClient): Promise<StaffContact[]> {
  const { data, error } = await supabase
    .from("contacts")
    .select("id, name, email, slack_user_id, listed")
    .order("name");
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; name: string; email: string; slack_user_id: string | null; listed: boolean | null }[])
    .filter((person) => !isDirectoryPlaceholder(person.name, person.email))
    .map((person) => ({
      id: person.id,
      name: person.name,
      email: person.email,
      slackUserId: person.slack_user_id,
      listed: person.listed !== false,
    }));
}

/** Firm logins that are not already a contact. */
export async function loginsMissingFromDirectory(takenEmails: string[]): Promise<string[]> {
  const service = createSupabaseServiceClient();
  const taken = new Set(takenEmails.map((email) => email.trim().toLowerCase()));
  const missing: string[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const users = data.users ?? [];
    for (const user of users) {
      const email = user.email?.trim().toLowerCase() ?? "";
      if (!email.endsWith(FIRM) || taken.has(email)) continue;
      missing.push(email);
    }
    if (users.length < 200) break;
  }
  missing.sort();
  return missing;
}

export async function firmUserId(email: string): Promise<string | null> {
  const service = createSupabaseServiceClient();
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const users = data.users ?? [];
    const match = users.find((user) => user.email?.trim().toLowerCase() === email);
    if (match) return match.id;
    if (users.length < 200) break;
  }
  return null;
}
