import { callerClassLabel, EXCLUDED_CALLER_CLASSES } from "@/lib/caller-class";
import { CLOSED_LEAD_STATUSES } from "@/lib/funnel";
import { PI_CASE_TYPES, SOURCE_TYPES, priorityReasonText, slackMessageUrl } from "@/lib/leads";
import { textSequenceLabel } from "@/lib/queue";
import { CALL_SEQUENCE_LABEL, type CallSequenceId } from "@/lib/sequences";
import { SIZE_TAGS, selectedOne } from "@/lib/tags";
import { chicagoDay, chicagoLocalToIso, chicagoParts } from "@/lib/time";

export const EXPORT_RANGES = ["all", "7", "30", "90", "month", "custom"] as const;
export type ExportRange = (typeof EXPORT_RANGES)[number];

export const EXPORT_SETS = ["all", "leads", "nonleads"] as const;
export type ExportSet = (typeof EXPORT_SETS)[number];

export const EXPORT_STATUSES = ["all", "open", "closed", "New", "Working", "Signed", "Lost", "Referred", "Promoted"] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

export const EXPORT_CHOICES = ["any", "yes", "no", "unset"] as const;
export type ExportChoice = (typeof EXPORT_CHOICES)[number];

export const EXPORT_SIGNED = ["any", "yes", "no"] as const;
export type ExportSigned = (typeof EXPORT_SIGNED)[number];

export type ExportFieldGroup = "Contact" | "Lead" | "Marketing" | "Decisions" | "More";

export type ExportField = {
  id: string;
  label: string;
  group: ExportFieldGroup;
  /** Included until an admin turns it off. */
  defaultOn: boolean;
};

export const EXPORT_FIELDS: ExportField[] = [
  { id: "name", label: "Name", group: "Contact", defaultOn: true },
  { id: "phone", label: "Phone", group: "Contact", defaultOn: true },
  { id: "email", label: "Email", group: "Contact", defaultOn: true },
  { id: "arrived", label: "Arrived", group: "Lead", defaultOn: true },
  { id: "status", label: "Status", group: "Lead", defaultOn: true },
  { id: "owner", label: "Owner", group: "Lead", defaultOn: true },
  { id: "case_type", label: "Case type", group: "Lead", defaultOn: true },
  { id: "grade", label: "Grade", group: "Lead", defaultOn: true },
  { id: "priority", label: "Priority", group: "Lead", defaultOn: true },
  { id: "summary", label: "Summary", group: "Lead", defaultOn: true },
  { id: "close_reason", label: "Close reason", group: "Lead", defaultOn: true },
  { id: "source_type", label: "Source type", group: "Marketing", defaultOn: true },
  { id: "source_category", label: "Source category", group: "Marketing", defaultOn: true },
  { id: "lead_source", label: "Lead source", group: "Marketing", defaultOn: true },
  { id: "qualified", label: "Qualified", group: "Decisions", defaultOn: true },
  { id: "desired", label: "Desired", group: "Decisions", defaultOn: true },
  { id: "decline", label: "Decline reason", group: "Decisions", defaultOn: true },
  { id: "size", label: "Size", group: "Decisions", defaultOn: true },
  { id: "consultation", label: "Consultation", group: "Decisions", defaultOn: true },
  { id: "consultation_date", label: "Consultation date", group: "Decisions", defaultOn: true },
  { id: "signed", label: "Signed", group: "Decisions", defaultOn: true },
  { id: "signed_date", label: "Signed date", group: "Decisions", defaultOn: true },
  { id: "case_detail", label: "Case detail", group: "More", defaultOn: false },
  { id: "caller_class", label: "Caller type", group: "More", defaultOn: false },
  { id: "identity", label: "Name check", group: "More", defaultOn: false },
  { id: "tags", label: "Tags", group: "More", defaultOn: false },
  { id: "case_number", label: "Case number", group: "More", defaultOn: false },
  { id: "agreement", label: "Contract", group: "More", defaultOn: false },
  { id: "texts", label: "Text sequence", group: "More", defaultOn: false },
  { id: "calls", label: "Call sequence", group: "More", defaultOn: false },
  { id: "follow_up", label: "Follow up", group: "More", defaultOn: false },
  { id: "quo", label: "Quo link", group: "More", defaultOn: false },
  { id: "slack", label: "Slack link", group: "More", defaultOn: false },
  { id: "source_channel", label: "Source channel", group: "More", defaultOn: false },
  { id: "priority_reason", label: "Priority reason", group: "More", defaultOn: false },
  { id: "lead_id", label: "Lead id", group: "More", defaultOn: false },
];

export const EXPORT_FIELD_GROUPS: ExportFieldGroup[] = ["Contact", "Lead", "Marketing", "Decisions", "More"];

export type ExportLead = {
  id?: string | null;
  lead_name?: string | null;
  phone?: string | null;
  phone_e164?: string | null;
  email?: string | null;
  created_at?: string | null;
  lead_status?: string | null;
  owner_name?: string | null;
  case_type?: string | null;
  case_detail?: string | null;
  grade?: string | null;
  priority?: boolean | null;
  priority_reason?: string | null;
  summary?: string | null;
  close_reason?: string | null;
  source_type?: string | null;
  source_category?: string | null;
  lead_source?: string | null;
  source_channel?: string | null;
  qualified?: boolean | null;
  desired_case?: boolean | null;
  decline_reason?: string | null;
  callrail_tags?: string[] | null;
  consultation?: string | null;
  consultation_date?: string | null;
  signed_case?: boolean | null;
  date_signed?: string | null;
  caller_class?: string | null;
  identity_status?: string | null;
  case_number?: string | null;
  agreement_status?: string | null;
  agreement_sent_at?: string | null;
  text_sequence_slug?: string | null;
  text_sequence_status?: string | null;
  sequence?: string | null;
  follow_up?: boolean | null;
  quo_link?: string | null;
  slack_permalink?: string | null;
  slack_channel_id?: string | null;
  slack_message_ts?: string | null;
  slack_thread_ts?: string | null;
};

export type ExportQuery = {
  fields: ExportField[];
  range: ExportRange;
  from: string;
  to: string;
  set: ExportSet;
  status: ExportStatus;
  caseTypes: string[];
  sourceTypes: string[];
  qualified: ExportChoice;
  desired: ExportChoice;
  signed: ExportSigned;
  owner: string;
  includeTest: boolean;
  includeMarkedTest: boolean;
};

const CLOSE_REASON_LABEL: Record<string, string> = {
  signed: "Signed",
  signed_elsewhere: "Signed elsewhere",
  declined: "Declined",
  referred: "Referred",
  not_interested: "No longer interested",
  no_response: "Unresponsive",
  not_a_lead: "Not a lead",
  outside_practice: "Outside practice",
};

const IDENTITY_LABEL: Record<string, string> = {
  ok: "Ok",
  needs_review: "Needs review",
  confirmed: "Confirmed",
};

export function exportColumns(fields: ExportField[]): string {
  const columns = new Set(["id", "created_at", "phone", "phone_e164"]);
  for (const field of fields) {
    for (const column of columnsFor(field.id)) columns.add(column);
  }
  return [...columns].join(", ");
}

function columnsFor(id: string): string[] {
  switch (id) {
    case "name":
      return ["lead_name"];
    case "phone":
      return ["phone", "phone_e164"];
    case "email":
      return ["email"];
    case "arrived":
      return ["created_at"];
    case "status":
      return ["lead_status"];
    case "owner":
      return ["owner_name"];
    case "case_type":
      return ["case_type"];
    case "grade":
      return ["grade"];
    case "priority":
      return ["priority"];
    case "summary":
      return ["summary"];
    case "close_reason":
      return ["close_reason"];
    case "source_type":
      return ["source_type"];
    case "source_category":
      return ["source_category"];
    case "lead_source":
      return ["lead_source"];
    case "qualified":
      return ["qualified"];
    case "desired":
      return ["desired_case"];
    case "decline":
      return ["decline_reason"];
    case "size":
    case "tags":
      return ["callrail_tags"];
    case "consultation":
      return ["consultation"];
    case "consultation_date":
      return ["consultation_date"];
    case "signed":
      return ["signed_case"];
    case "signed_date":
      return ["date_signed"];
    case "case_detail":
      return ["case_detail"];
    case "caller_class":
      return ["caller_class"];
    case "identity":
      return ["identity_status"];
    case "case_number":
      return ["case_number"];
    case "agreement":
      return ["agreement_status", "agreement_sent_at"];
    case "texts":
      return ["text_sequence_slug", "text_sequence_status"];
    case "calls":
      return ["sequence"];
    case "follow_up":
      return ["follow_up"];
    case "quo":
      return ["quo_link"];
    case "slack":
      return ["slack_permalink", "slack_channel_id", "slack_message_ts", "slack_thread_ts"];
    case "source_channel":
      return ["source_channel"];
    case "priority_reason":
      return ["priority_reason"];
    case "lead_id":
      return ["id"];
    default:
      return [];
  }
}

export function parseExportForm(form: FormData): ExportQuery {
  const picked = new Set(form.getAll("field").map((value) => String(value)));
  const fields = EXPORT_FIELDS.filter((field) => picked.has(field.id));
  if (!fields.length) throw new ExportInputError("Choose at least one field.");

  const range = oneOf(form.get("range"), EXPORT_RANGES, "all");
  const from = dayValue(form.get("from"));
  const to = dayValue(form.get("to"));
  if (range === "custom") {
    if (!from || !to) throw new ExportInputError("Enter a start and end date.");
    if (from > to) throw new ExportInputError("The start date has to be on or before the end date.");
  }

  const caseTypes = form
    .getAll("case_type")
    .map((value) => String(value))
    .filter((value) => (PI_CASE_TYPES as readonly string[]).includes(value));
  const sourceTypes = form
    .getAll("source_type")
    .map((value) => String(value))
    .filter((value) => (SOURCE_TYPES as readonly string[]).includes(value));

  return {
    fields,
    range,
    from,
    to,
    set: oneOf(form.get("set"), EXPORT_SETS, "all"),
    status: oneOf(form.get("status"), EXPORT_STATUSES, "all"),
    caseTypes,
    sourceTypes,
    qualified: oneOf(form.get("qualified"), EXPORT_CHOICES, "any"),
    desired: oneOf(form.get("desired"), EXPORT_CHOICES, "any"),
    signed: oneOf(form.get("signed"), EXPORT_SIGNED, "any"),
    owner: String(form.get("owner") ?? "").trim(),
    includeTest: form.get("include_test") === "yes",
    includeMarkedTest: form.get("include_marked_test") === "yes",
  };
}

export function exportWindow(query: Pick<ExportQuery, "range" | "from" | "to">, now = new Date()): { start: string; end: string } | null {
  if (query.range === "all") return null;
  const today = chicagoDay(now);
  if (query.range === "custom") {
    return { start: dayStart(query.from), end: dayStart(addDays(query.to, 1)) };
  }
  if (query.range === "month") {
    return { start: dayStart(`${today.slice(0, 8)}01`), end: dayStart(addDays(today, 1)) };
  }
  const days = query.range === "7" ? 7 : query.range === "30" ? 30 : 90;
  return { start: dayStart(addDays(today, 1 - days)), end: dayStart(addDays(today, 1)) };
}

export function nonLeadFilter(): string {
  return EXCLUDED_CALLER_CLASSES.join(",");
}

export function closedStatusList(): string {
  return `(${CLOSED_LEAD_STATUSES.join(",")})`;
}

export function leadsToCsv(rows: ExportLead[], fields: ExportField[]): string {
  const header = fields.map((field) => csvCell(field.label)).join(",");
  const lines = rows.map((row) => fields.map((field) => csvCell(exportCell(row, field.id))).join(","));
  return `\uFEFF${[header, ...lines].join("\r\n")}\r\n`;
}

export function exportFilename(now = new Date()): string {
  return `leads-${chicagoDay(now)}.csv`;
}

function exportCell(row: ExportLead, id: string): string {
  switch (id) {
    case "name":
      return text(row.lead_name);
    case "phone":
      return text(row.phone_e164 || row.phone);
    case "email":
      return text(row.email);
    case "arrived":
      return chicagoStamp(row.created_at);
    case "status":
      return text(row.lead_status);
    case "owner":
      return text(row.owner_name);
    case "case_type":
      return text(row.case_type);
    case "grade":
      return text(row.grade);
    case "priority":
      return yesNo(row.priority);
    case "summary":
      return text(row.summary);
    case "close_reason":
      return CLOSE_REASON_LABEL[text(row.close_reason)] ?? text(row.close_reason);
    case "source_type":
      return text(row.source_type);
    case "source_category":
      return text(row.source_category);
    case "lead_source":
      return text(row.lead_source);
    case "qualified":
      return yesNo(row.qualified);
    case "desired":
      return yesNo(row.desired_case);
    case "decline":
      return text(row.decline_reason);
    case "size":
      return selectedOne(row.callrail_tags ?? [], SIZE_TAGS).replace(/^S:\s*/, "");
    case "consultation":
      return consultationLabel(row.consultation);
    case "consultation_date":
      return text(row.consultation_date).slice(0, 10);
    case "signed":
      return yesNo(row.signed_case);
    case "signed_date":
      return text(row.date_signed).slice(0, 10);
    case "case_detail":
      return text(row.case_detail);
    case "caller_class":
      return callerClassLabel(row.caller_class) ?? text(row.caller_class);
    case "identity":
      return IDENTITY_LABEL[text(row.identity_status)] ?? text(row.identity_status);
    case "tags":
      return (row.callrail_tags ?? []).join("; ");
    case "case_number":
      return text(row.case_number);
    case "agreement":
      return agreementLabel(row);
    case "texts":
      return textSequence(row);
    case "calls":
      return callSequence(row.sequence);
    case "follow_up":
      return yesNo(row.follow_up);
    case "quo":
      return text(row.quo_link);
    case "slack":
      return slackMessageUrl({
        slack_permalink: row.slack_permalink ?? null,
        slack_channel_id: row.slack_channel_id ?? null,
        slack_message_ts: row.slack_message_ts ?? null,
        slack_thread_ts: row.slack_thread_ts ?? null,
      }) ?? "";
    case "source_channel":
      return text(row.source_channel);
    case "priority_reason":
      return priorityReasonText(row.priority_reason) ?? "";
    case "lead_id":
      return text(row.id);
    default:
      return "";
  }
}

function agreementLabel(row: ExportLead): string {
  const status = text(row.agreement_status);
  const label = status ? status.charAt(0).toUpperCase() + status.slice(1).toLowerCase() : "";
  const sent = chicagoStamp(row.agreement_sent_at);
  if (label && sent) return `${label} · ${sent}`;
  return label || sent;
}

function textSequence(row: ExportLead): string {
  const name = textSequenceLabel(row.text_sequence_slug) ?? text(row.text_sequence_slug);
  const status = text(row.text_sequence_status);
  if (name && status) return `${name} · ${status}`;
  return name || status;
}

function callSequence(value: string | null | undefined): string {
  const sequence = text(value);
  if (!sequence) return "";
  if (sequence === "stop") return "Stopped";
  if (sequence in CALL_SEQUENCE_LABEL) return CALL_SEQUENCE_LABEL[sequence as CallSequenceId];
  return sequence;
}

function consultationLabel(value: string | null | undefined): string {
  const consultation = text(value).toLowerCase();
  if (consultation === "staff" || consultation === "yes") return "Yes";
  if (consultation === "no") return "No";
  return text(value);
}

function yesNo(value: boolean | null | undefined): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "";
}

function text(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function chicagoStamp(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return text(value).slice(0, 10);
  const parts = chicagoParts(date);
  const pad = (part: number) => String(part).padStart(2, "0");
  const hour = parts.hour % 12 || 12;
  const suffix = parts.hour >= 12 ? "PM" : "AM";
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${hour}:${pad(parts.minute)} ${suffix}`;
}

function csvCell(value: string): string {
  let cell = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (/^[=+\-@]/.test(cell)) cell = `'${cell}`;
  if (/[",\n]/.test(cell)) return `"${cell.replaceAll('"', '""')}"`;
  return cell;
}

function dayValue(value: FormDataEntryValue | null): string {
  const day = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : "";
}

function oneOf<T extends string>(value: FormDataEntryValue | null, allowed: readonly T[], fallback: T): T {
  const picked = String(value ?? "");
  return (allowed as readonly string[]).includes(picked) ? (picked as T) : fallback;
}

function dayStart(day: string): string {
  return chicagoLocalToIso(`${day}T00:00`);
}

function addDays(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

export class ExportInputError extends Error {}
