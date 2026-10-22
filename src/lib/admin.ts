const FIRM_ADMINS = ["david@ramosjames.com", "jon@ramosjames.com"] as const;

function listedAdminEmails(): string[] {
  const raw = [process.env.ADMIN_EMAILS, process.env.BOOTSTRAP_ADMIN_EMAIL]
    .filter(Boolean)
    .join(",");
  const fromEnv = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([...FIRM_ADMINS, ...fromEnv])];
}

export function isAdminEmail(email: string | null | undefined): boolean {
  const needle = (email || "").trim().toLowerCase();
  if (!needle) return false;
  return listedAdminEmails().includes(needle);
}
