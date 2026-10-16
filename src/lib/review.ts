import { callerClassLabel, EXCLUDED_CALLER_CLASSES } from "@/lib/caller-class";
import { isSourceType, slackMessageUrl } from "@/lib/leads";
import { contractSent, milestoneDesired, milestoneQualified, milestoneSigned } from "@/lib/desired";
import { toE164 } from "@/lib/phone";
import { NOT_QUALIFIED_TAGS, selectedDecline, selectedOne, SIZE_TAGS, TYPE_TAGS } from "@/lib/tags";

const CLOSED_STATUSES = new Set(["Lost", "Referred", "Promoted", "Signed"]);
const EXCLUDED = new Set<string>(EXCLUDED_CALLER_CLASSES);

export const REVIEW_GAPS = [
  "name",
  "phone",
  "email",
  "lead_source",
  "source_type",
  "case_type",
  "qualified",
  "consultation",
  "desired",
  "not_qualified",
] as const;

export type ReviewGap = (typeof REVIEW_GAPS)[number];

export const REVIEW_GAP_LABEL: Record<ReviewGap, string> = {
  name: "Name",
  phone: "Phone",
  email: "Email",
  lead_source: "Lead source",
  source_type: "Source type",
  case_type: "Type",
  qualified: "Qualified",
  consultation: "Consultation",
  desired: "Desired",
  not_qualified: "Not qualified",
};

export const EMAIL_NOT_AVAILABLE = "Not Available";

export function emailIsFilled(value: string): boolean {
  const text = value.trim();
  if (text.toLowerCase() === EMAIL_NOT_AVAILABLE.toLowerCase()) return true;
  return text.includes("@");
}

export type ReviewLead = {
  id: string;
  name: string;
  phone: string;
  email: string;
  leadSource: string;
  sourceType: string;
  caseType: string;
  qualified: "" | "yes" | "no";
  consulted: "" | "yes" | "no";
  consultation: string;
  firstContact: string;
  slackUrl: string | null;
  desired: "" | "yes" | "no";
  desiredLocked: boolean;
  signed: boolean;
  decline: string;
  notQualified: string;
  size: string;
  injury: string;
  status: string;
  closed: boolean;
  leadDate: string;
  updatedBy: string;
};

export type ReviewSource = {
  id: string;
  lead_name: string | null;
  phone: string | null;
  email: string | null;
  lead_source: string | null;
  source_type: string | null;
  source_channel: string | null;
  case_type: string | null;
  qualified: boolean | null;
  consultation: string | null;
  consultation_date: string | null;
  slack_permalink: string | null;
  slack_channel_id: string | null;
  slack_message_ts: string | null;
  slack_thread_ts: string | null;
  desired_case: boolean | null;
  desired_source: string | null;
  signed_case: boolean | null;
  lead_status: string | null;
  callrail_tags: string[] | null;
  caller_class: string | null;
  agreement_status: string | null;
  agreement_sent_at: string | null;
  lead_date: string | null;
  created_at: string | null;
  summary?: string | null;
  case_detail?: string | null;
  source_note?: string | null;
};

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function yesNo(value: boolean | null): "" | "yes" | "no" {
  if (value === true) return "yes";
  if (value === false) return "no";
  return "";
}

export function reviewGaps(lead: Pick<
  ReviewLead,
  "name" | "phone" | "email" | "leadSource" | "sourceType" | "caseType" |   "qualified" | "consulted" | "consultation" | "desired" | "notQualified"
>): ReviewGap[] {
  const gaps: ReviewGap[] = [];
  if (!lead.name.trim()) gaps.push("name");
  if (!toE164(lead.phone)) gaps.push("phone");
  if (!emailIsFilled(lead.email)) gaps.push("email");
  if (!lead.leadSource.trim()) gaps.push("lead_source");
  if (!isSourceType(lead.sourceType)) gaps.push("source_type");
  if (!lead.caseType.trim()) gaps.push("case_type");
  if (!lead.qualified) gaps.push("qualified");
  const consultationAnswered = lead.consulted === "no" || (lead.consulted === "yes" && /^\d{4}-\d{2}-\d{2}$/.test(lead.consultation));
  if (!consultationAnswered) gaps.push("consultation");
  if (!lead.desired) gaps.push("desired");
  if (lead.qualified === "no" && !lead.notQualified) gaps.push("not_qualified");
  return gaps;
}

export function toReviewLead(lead: ReviewSource): ReviewLead {
  const tags = lead.callrail_tags ?? [];
  const qualified = milestoneQualified({ qualified: lead.qualified, callrail_tags: tags });
  const desired = milestoneDesired({
    qualified: lead.qualified,
    desired_case: lead.desired_case,
    desired_source: lead.desired_source,
    agreement_sent_at: lead.agreement_sent_at,
    agreement_status: lead.agreement_status,
    callrail_tags: tags,
  });
  const signed = milestoneSigned({ signed_case: lead.signed_case, lead_status: lead.lead_status });
  const excluded = Boolean(lead.caller_class && EXCLUDED.has(lead.caller_class));
  const status = lead.lead_status || "New";
  const consult = clean(lead.consultation_date).slice(0, 10);
  const consultation = /^\d{4}-\d{2}-\d{2}$/.test(consult) ? consult : "";
  const consulted = consultation ? "yes" : clean(lead.consultation).toLowerCase() === "no" ? "no" : "";
  return {
    id: lead.id,
    name: clean(lead.lead_name),
    phone: clean(lead.phone),
    email: clean(lead.email),
    leadSource: clean(lead.lead_source),
    sourceType: isSourceType(clean(lead.source_type)) ? clean(lead.source_type) : "",
    caseType: clean(lead.case_type),
    qualified: yesNo(qualified),
    consulted,
    consultation,
    firstContact: clean(lead.lead_date || lead.created_at).slice(0, 10),
    slackUrl: slackMessageUrl(lead),
    desired: yesNo(desired),
    desiredLocked: qualified === false || signed || contractSent(lead),
    signed,
    decline: selectedDecline(tags),
    notQualified: selectedOne(tags, NOT_QUALIFIED_TAGS),
    size: selectedOne(tags, SIZE_TAGS),
    injury: selectedOne(tags, TYPE_TAGS),
    status: excluded ? callerClassLabel(lead.caller_class) || status : status,
    closed: excluded || CLOSED_STATUSES.has(status),
    leadDate: clean(lead.lead_date || lead.created_at).slice(0, 10),
    updatedBy: "",
  };
}

export function reviewEditorName(actor: string | null | undefined): string {
  const value = (actor ?? "").trim();
  const at = value.indexOf("@");
  if (at <= 0) return "";
  return value.slice(0, at);
}

function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function reviewCsv(rows: ReviewLead[]): string {
  const headers = [
    "Name",
    "Phone",
    "Email",
    "Lead source",
    "Source type",
    "Type",
    "Qualified",
    "Consultation",
    "Consultation date",
    "First contact",
    "Slack",
    "Desired",
    "Signed",
    "Declined",
    "Not qualified",
    "Status",
    "Open or closed",
    "Missing",
    "Lead date",
    "Updated by",
    "Id",
  ];
  const lines = [headers.join(",")];
  for (const row of rows) {
    const qualified = row.qualified === "yes" ? "Yes" : row.qualified === "no" ? "No" : "";
    const desired = row.desired === "yes" ? "Yes" : row.desired === "no" ? "No" : "";
    lines.push(
      [
        row.name,
        row.phone,
        row.email,
        row.leadSource,
        row.sourceType,
        row.caseType,
        qualified,
        row.consulted === "yes" ? "Yes" : row.consulted === "no" ? "No" : "",
        row.consultation,
        row.firstContact,
        row.slackUrl ?? "",
        desired,
        row.signed ? "Yes" : "No",
        row.decline,
        row.notQualified,
        row.status,
        row.closed ? "Closed" : "Open",
        reviewGaps(row).map((gap) => REVIEW_GAP_LABEL[gap]).join("; "),
        row.leadDate,
        row.updatedBy,
        row.id,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `\uFEFF${lines.join("\r\n")}`;
}
