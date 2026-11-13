import { firmEmail } from "./identity";
import { looksLikePersonName } from "./leads";
import { toE164 } from "./phone";

export type SlackEmailFile = {
  id?: string;
  mode?: string;
  filetype?: string;
  mimetype?: string;
  name?: string;
  title?: string;
  subject?: string;
};

const SUMMARY_CAP = 8000;

/** Slack email-app posts in #lead-calls. The body is a file, not message text. */
export function slackEmailFile(files: SlackEmailFile[] | undefined): SlackEmailFile | null {
  if (!files?.length) return null;
  return (
    files.find((file) => {
      if (!file.id) return false;
      if (file.mode === "email" || file.filetype === "email") return true;
      const title = file.subject || file.title || file.name || "";
      return file.mimetype === "text/html" && /^fwd:/i.test(title);
    }) ?? null
  );
}

export function emailSummary(subject: string | null | undefined, plain: string | null | undefined): string {
  const body = (plain ?? "").replace(/\u00a0/g, " ").trim();
  const title = (subject ?? "").replace(/\s+/g, " ").trim();
  if (!body) return title.slice(0, SUMMARY_CAP);
  const marker = title.slice(0, 40).toLowerCase();
  if (title && marker && !body.toLowerCase().includes(marker)) {
    return `${title}\n\n${body}`.slice(0, SUMMARY_CAP);
  }
  return body.slice(0, SUMMARY_CAP);
}

/** Keep a note staff already wrote. Returns null when the email is already stored. */
export function mergeEmailSummary(current: string | null | undefined, incoming: string): string | null {
  const email = incoming.trim();
  if (!email) return null;
  const existing = (current ?? "").trim();
  if (!existing) return email.slice(0, SUMMARY_CAP);
  const marker = email.slice(0, 80);
  if (marker && existing.includes(marker)) return null;
  return `${existing}\n\n${email}`.slice(0, SUMMARY_CAP);
}

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

export function emailsIn(text: string): string[] {
  const found = text.match(EMAIL) ?? [];
  const unique: string[] = [];
  for (const raw of found) {
    const email = raw.toLowerCase();
    if (firmEmail(email)) continue;
    if (!unique.includes(email)) unique.push(email);
  }
  return unique;
}

export function phonesInEmail(text: string): string[] {
  const matches = text.match(/(?:^|[^\d])(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}(?!\d)/g) ?? [];
  const unique: string[] = [];
  for (const match of matches) {
    const phone = toE164(match);
    if (phone && !unique.includes(phone)) unique.push(phone);
  }
  return unique;
}

/** "the family of Alfonso \"Chop\" Chapa, 36" → Alfonso "Chop" Chapa */
export function nameFromEmail(text: string): string | null {
  const family = text.match(/family of\s+([A-Z][^,\n]{2,80})/)?.[1]?.replace(/\s+/g, " ").trim();
  if (!family) return null;
  const readable = family.replace(/[“”]/g, '"');
  if (!looksLikePersonName(readable.replace(/"/g, ""))) return null;
  return readable;
}

export function phoneDisplay(e164: string): string {
  if (/^\+1\d{10}$/.test(e164)) return e164.slice(2);
  return e164;
}
