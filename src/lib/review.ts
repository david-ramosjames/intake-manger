import { callerClassLabel, EXCLUDED_CALLER_CLASSES } from "@/lib/caller-class";
import { isSourceType } from "@/lib/leads";
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
  consultation: "Consultation date",
  desired: "Desired",
  not_qualified: "Not qualified",
};

export type ReviewLead = {
  id: string;
  name: string;
  phone: string;
  email: string;
  leadSource: string;
  sourceType: string;
  caseType: string;
  qualified: "" | "yes" | "no";
  consultation: string;
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
  consultation_date: string | null;
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
  "name" | "phone" | "email" | "leadSource" | "sourceType" | "caseType" | "qualified" | "consultation" | "desired" | "notQualified"
>): ReviewGap[] {
  const gaps: ReviewGap[] = [];
  if (!lead.name.trim()) gaps.push("name");
  if (!toE164(lead.phone)) gaps.push("phone");
  if (!lead.email.includes("@")) gaps.push("email");
  if (!lead.leadSource.trim()) gaps.push("lead_source");
  if (!isSourceType(lead.sourceType)) gaps.push("source_type");
  if (!lead.caseType.trim()) gaps.push("case_type");
  if (!lead.qualified) gaps.push("qualified");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lead.consultation)) gaps.push("consultation");
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
  return {
    id: lead.id,
    name: clean(lead.lead_name),
    phone: clean(lead.phone),
    email: clean(lead.email),
    leadSource: clean(lead.lead_source),
    sourceType: isSourceType(clean(lead.source_type)) ? clean(lead.source_type) : "",
    caseType: clean(lead.case_type),
    qualified: yesNo(qualified),
    consultation: /^\d{4}-\d{2}-\d{2}$/.test(consult) ? consult : "",
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
  };
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
    "Consultation date",
    "Desired",
    "Signed",
    "Declined",
    "Not qualified",
    "Status",
    "Open or closed",
    "Missing",
    "Lead date",
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
        row.consultation,
        desired,
        row.signed ? "Yes" : "No",
        row.decline,
        row.notQualified,
        row.status,
        row.closed ? "Closed" : "Open",
        reviewGaps(row).map((gap) => REVIEW_GAP_LABEL[gap]).join("; "),
        row.leadDate,
        row.id,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `\uFEFF${lines.join("\r\n")}`;
}
