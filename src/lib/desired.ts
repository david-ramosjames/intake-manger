/** Intake milestones. Each one is recorded on its own. */

const SENT = new Set(["sent", "viewed", "signed", "completed"]);

export function contractSent(input: {
  agreement_sent_at?: string | null;
  agreement_status?: string | null;
}): boolean {
  const status = (input.agreement_status || "").toLowerCase();
  if (status === "failed") return false;
  if (SENT.has(status)) return true;
  return Boolean(input.agreement_sent_at);
}

/** The representation contract is still out. A signed contract, or a finished reminder series, is not. Other documents do not count. */
export function contractOutstanding(input: {
  signed_case?: boolean | null;
  agreement_sent_at?: string | null;
  agreement_status?: string | null;
  agreement_reminder_count?: number | null;
  agreement_next_reminder_at?: string | null;
}): boolean {
  if (input.signed_case) return false;
  const status = (input.agreement_status || "").toLowerCase();
  if (["signed", "completed", "cancelled", "expired", "failed"].includes(status)) return false;
  if ((input.agreement_reminder_count ?? 0) >= 6 && !input.agreement_next_reminder_at && (status === "sent" || status === "viewed")) {
    return false;
  }
  return status === "sent" || status === "viewed" || Boolean(input.agreement_sent_at);
}

export function milestoneConsultation(date: string | null | undefined): boolean {
  return Boolean(date);
}

export function milestoneQualified(input: {
  qualified?: boolean | null;
  callrail_tags?: string[] | null;
}): boolean | null {
  if (input.qualified === true || input.qualified === false) return input.qualified;
  const tags = input.callrail_tags ?? [];
  if (tags.includes("QUALIFIED YES")) return true;
  if (tags.includes("QUALIFIED NO")) return false;
  return null;
}

/** A sent contract marks the case desired. A lead that is not qualified is not desired. A stored value counts only after a person or that contract set it. */
export function milestoneDesired(input: {
  qualified?: boolean | null;
  desired_case?: boolean | null;
  desired_source?: string | null;
  agreement_sent_at?: string | null;
  agreement_status?: string | null;
  callrail_tags?: string[] | null;
}): boolean | null {
  if (milestoneQualified(input) === false) return false;
  if (contractSent(input)) return true;
  if (input.desired_source === "staff" || input.desired_source === "contract") {
    return input.desired_case === true ? true : input.desired_case === false ? false : null;
  }
  if ((input.callrail_tags ?? []).includes("CVR DESIRED")) return true;
  return null;
}

/** Signed is a person confirming the contract is complete. */
export function milestoneSigned(input: {
  signed_case?: boolean | null;
  lead_status?: string | null;
}): boolean {
  return Boolean(input.signed_case) || input.lead_status === "Signed";
}

export function signatureNeedsConfirm(input: {
  signed_case?: boolean | null;
  lead_status?: string | null;
  agreement_status?: string | null;
}): boolean {
  if (milestoneSigned(input)) return false;
  const status = (input.agreement_status || "").toLowerCase();
  return status === "signed" || status === "completed";
}

export function consultedChoice(input: {
  consultation_date?: string | null;
  consultation?: string | null;
}): "yes" | "no" | "" {
  if (input.consultation_date) return "yes";
  const consultation = (input.consultation || "").toLowerCase();
  if (consultation === "no") return "no";
  if (consultation) return "yes";
  return "";
}

export function consultationWhen(value: string | null | undefined): string {
  if (!value) return "No consult";
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return "No consult";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}

export function desiredWord(value: boolean | null | undefined): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "—";
}
