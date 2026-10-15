import type { LeadCycle } from "@/lib/next-step";

export type QueueId =
  | "all"
  | "attention"
  | "contact"
  | "information"
  | "signing"
  | "signed"
  | "closed"
  | "nonleads"
  | "fresh"
  | "working";

export function isQueue(value: string | undefined): value is QueueId {
  return (
    value === "all" ||
    value === "attention" ||
    value === "contact" ||
    value === "information" ||
    value === "signing" ||
    value === "signed" ||
    value === "closed" ||
    value === "nonleads" ||
    value === "fresh" ||
    value === "working"
  );
}

export function receivedLabel(age: number | null): string {
  if (age == null) return "";
  if (age === 0) return "Today";
  if (age === 1) return "Yesterday";
  return `${age}d ago`;
}

export function waitingTooLong(cycle: LeadCycle, age: number | null, lastDays: number | null, nextCallAt: string | undefined): boolean {
  if (cycle === "signed" || cycle === "closed") return false;
  if (lastDays == null && (age ?? 0) >= 1) return true;
  if (lastDays != null && lastDays >= 2) return true;
  if (nextCallAt && new Date(nextCallAt).getTime() < Date.now()) return true;
  return false;
}

export function needsAttention(input: {
  cycle: LeadCycle;
  waiting: boolean;
  identityStatus: string | null | undefined;
  agreementStatus: string | null | undefined;
}): boolean {
  if (input.cycle === "signed" || input.cycle === "closed") return false;
  if (input.waiting) return true;
  if (input.identityStatus === "needs_review") return true;
  return (input.agreementStatus || "").toLowerCase() === "failed";
}

export function matchesQueue(queue: QueueId, cycle: LeadCycle, attention: boolean): boolean {
  if (queue === "attention") return attention;
  if (queue === "contact" || queue === "fresh") return cycle === "contact";
  if (queue === "information") return cycle === "information";
  if (queue === "signing") return cycle === "signing";
  if (queue === "working") return cycle === "information" || cycle === "signing";
  if (queue === "signed") return cycle === "signed";
  if (queue === "closed") return cycle === "closed";
  if (queue === "nonleads") return true;
  return true;
}

export function stageClass(label: string): string {
  if (label === "Signed") return "bg-emerald-50 text-emerald-800";
  if (label === "Finish signing" || label === "Confirm signature") return "bg-violet-50 text-violet-800";
  if (label === "Need more information") return "bg-sky-50 text-sky-800";
  if (label === "Need to contact") return "bg-amber-50 text-amber-900";
  if (label === "Outside practice") return "bg-orange-50 text-orange-900";
  return "bg-slate-100 text-slate-600";
}

const TEXT_SEQUENCE_LABEL: Record<string, string> = {
  "new-lead": "New lead",
  "more-info": "More info",
  "qualified-lead": "Qualified lead",
  "qualified-lead-copy": "Referral",
};

export function textSequenceLabel(slug: string | null | undefined): string | null {
  const key = (slug || "").trim().toLowerCase();
  if (!key) return null;
  return TEXT_SEQUENCE_LABEL[key] ?? key.replaceAll("-", " ");
}

export function automationLine(lead: {
  text_sequence_status: string | null;
  text_sequence_slug?: string | null;
  text_next_at?: string | null;
  agreement_status: string | null;
  agreement_sent_at?: string | null;
}): { label: string; bad: boolean } {
  if ((lead.text_sequence_status || "").toLowerCase() === "active") {
    return { label: textSequenceLabel(lead.text_sequence_slug) ?? "Texts", bad: false };
  }
  const agreement = (lead.agreement_status || "").toLowerCase();
  if (agreement === "failed") return { label: "Contract failed", bad: true };
  return { label: "—", bad: false };
}
