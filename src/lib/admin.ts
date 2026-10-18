const FIRM_ADMIN = "david@ramosjames.com";

function listedAdminEmails(): string[] {
  const raw = [process.env.ADMIN_EMAILS, process.env.BOOTSTRAP_ADMIN_EMAIL]
    .filter(Boolean)
    .join(",");
  return raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  const needle = (email || "").trim().toLowerCase();
  if (!needle) return false;
  const listed = listedAdminEmails();
  if (listed.includes(needle)) return true;
  return listed.length === 0 && needle === FIRM_ADMIN;
}
