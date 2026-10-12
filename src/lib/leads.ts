export const LEAD_STATUSES = [
  "New",
  "Working",
  "Consultation",
  "Signed",
  "Promoted",
  "Lost",
  "Referred",
] as const;

export type LeadGrade = "A" | "B" | "C";
export type LeadSentiment = "positive" | "neutral" | "negative";
export type LeadKind = "pursue" | "needs_info";
export type LeadArrival = "form" | "missed" | "sona" | "human_call" | "qualified_call" | "manual";

export const LEAD_SENTIMENT_LABEL: Record<LeadSentiment, string> = {
  positive: "Positive",
  neutral: "Neutral",
  negative: "Negative",
};

export const LEAD_KIND_LABEL: Record<LeadKind, string> = {
  pursue: "Want to sign",
  needs_info: "Need more info",
};

export const SOURCE_CHANNELS = ["Call", "Web form", "Meta", "Facebook", "WhatsApp", "Website"] as const;

export const LEAD_ARRIVAL_LABEL: Record<LeadArrival, string> = {
  form: "Form",
  missed: "Missed call",
  sona: "Sona",
  human_call: "Human call",
  qualified_call: "Qualified call",
  manual: "Added by hand",
};

export type Lead = {
  id: string;
  lead_date: string | null;
  lead_name: string | null;
  phone: string | null;
  phone_e164: string | null;
  email: string | null;
  lead_source: string | null;
  source_type: string | null;
  source_channel: string | null;
  source_note: string | null;
  case_type: string | null;
  lead_status: string;
  consultation: string | null;
  consultation_date: string | null;
  desired_case: boolean | null;
  signed_case: boolean;
  case_number: string | null;
  date_signed: string | null;
  grade: LeadGrade | null;
  grade_reason: string | null;
  grade_source: string | null;
  sentiment: LeadSentiment | null;
  sentiment_reason: string | null;
  sentiment_source: string | null;
  qualified: boolean | null;
  quo_link: string | null;
  intake_call_id: string | null;
  callrail_call_id: string | null;
  case_id: string | null;
  slack_permalink: string | null;
  summary: string | null;
  owner_name: string | null;
  kind: LeadKind;
  sequence: string | null;
  arrival: LeadArrival | null;
  callrail_tags: string[];
  confirmed_at: string | null;
  confirmed_by: string | null;
  follow_up: boolean;
  needs_verification: boolean;
  identity_status: "ok" | "needs_review" | "confirmed";
  identity_evidence: string | null;
  agreement_status: string | null;
  agreement_sent_at: string | null;
  agreement_last_reminder_at: string | null;
  agreement_next_reminder_at: string | null;
  agreement_reminder_count: number | null;
  agreement_signing_url: string | null;
  text_sequence_slug: string | null;
  text_sequence_status: string | null;
  text_next_at: string | null;
  priority: boolean;
  priority_reason: PriorityReason | null;
  last_action: string | null;
  next_action: string | null;
  slack_channel_id: string | null;
  slack_thread_ts: string | null;
  slack_message_ts: string | null;
  signed_at: string | null;
  form_fill_closed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type LeadEvent = {
  id: string;
  lead_id: string;
  event_type: string;
  actor: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export type LeadView = "all" | "open" | "signed" | "promoted" | "pursue" | "needs_info" | "verify";

export const PRIORITY_REASONS = ["contract_out", "send_contract", "high_potential"] as const;
export type PriorityReason = (typeof PRIORITY_REASONS)[number];

export const PRIORITY_REASON_LABEL: Record<PriorityReason, string> = {
  contract_out: "Contract sent, not signed",
  send_contract: "Ready to send the contract",
  high_potential: "High potential, not triaged",
};

export function isPriorityReason(value: string | null | undefined): value is PriorityReason {
  return value === "contract_out" || value === "send_contract" || value === "high_potential";
}

export function daysOpen(start: string | null, closedOn: string | null): number | null {
  const from = dayStamp(start);
  if (from == null) return null;
  const end = closedOn ? dayStamp(closedOn) : todayStamp();
  if (end == null) return null;
  return Math.max(0, Math.round((end - from) / 86_400_000));
}

function dayStamp(value: string | null): number | null {
  if (!value) return null;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  return Date.UTC(year, month - 1, day);
}

function todayStamp(): number {
  const now = new Date();
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

export function slackMessageUrl(lead: {
  slack_permalink: string | null;
  slack_channel_id: string | null;
  slack_message_ts: string | null;
  slack_thread_ts: string | null;
}): string | null {
  if (lead.slack_permalink) return lead.slack_permalink;
  const channel = lead.slack_channel_id;
  const ts = lead.slack_message_ts || lead.slack_thread_ts;
  if (!channel || !ts) return null;
  return `https://slack.com/archives/${channel}/p${ts.replace(".", "")}`;
}

export function leadTitle(lead: {
  lead_name: string | null;
  phone: string | null;
  identity_status?: string | null;
}): string {
  const name = lead.lead_name?.trim() ?? "";
  if (name && lead.identity_status === "needs_review") return `${name} · identity needs review`;
  if (name) return name;
  const ending = (lead.phone ?? "").replace(/\D/g, "").slice(-4);
  if (ending.length === 4) return `Name not captured · phone ending ${ending}`;
  return "Name not captured";
}

export function isLeadView(value: string | undefined): value is LeadView {
  return (
    value === "all" ||
    value === "open" ||
    value === "signed" ||
    value === "promoted" ||
    value === "pursue" ||
    value === "needs_info" ||
    value === "verify"
  );
}

const JUNK_CONTACT = /^(null|undefined|none|n\/a|na|-)$/i;

export function displayContact(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || JUNK_CONTACT.test(trimmed)) return null;
  return trimmed;
}
