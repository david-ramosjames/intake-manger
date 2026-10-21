import { isWorkLead } from "@/lib/caller-class";
import { isSourceType } from "@/lib/leads";
import { isPlaceholderOwner } from "@/lib/talked-with";
import { SIZE_TAGS, qualifiedChoice, selectedDecline, selectedOne } from "@/lib/tags";

export const CLOSE_READY_COLUMNS =
  "lead_name, phone, phone_e164, email, identity_status, owner_name, qualified, callrail_tags, desired_case, signed_case, date_signed, caller_class, case_type, lead_source, source_type, consultation, consultation_date";

export type CloseReadyLead = {
  lead_name?: string | null;
  phone?: string | null;
  phone_e164?: string | null;
  email?: string | null;
  identity_status?: string | null;
  owner_name?: string | null;
  qualified?: boolean | null;
  callrail_tags?: string[] | null;
  desired_case?: boolean | null;
  signed_case?: boolean | null;
  date_signed?: string | null;
  caller_class?: string | null;
  case_type?: string | null;
  lead_source?: string | null;
  source_type?: string | null;
  consultation?: string | null;
  consultation_date?: string | null;
};

export function closeGaps(lead: CloseReadyLead, kind: "lead" | "nonlead" = "lead"): string[] {
  const gaps: string[] = [];
  if (lead.identity_status === "needs_review") gaps.push("Confirm the client name");
  if (kind === "nonlead" || !isWorkLead(lead)) return gaps;

  const name = lead.lead_name?.trim() ?? "";
  if (!name || /^not captured$/i.test(name)) gaps.push("Lead name");
  const phone = (lead.phone_e164 || lead.phone || "").replace(/\D/g, "");
  if (phone.length < 7) gaps.push("Phone");
  if (!lead.lead_source?.trim()) gaps.push("Lead source");
  if (!isSourceType(lead.source_type)) gaps.push("Source type");
  if (!lead.case_type?.trim()) gaps.push("Case type");
  if (isPlaceholderOwner(lead.owner_name)) gaps.push("Slack tag");

  const tags = lead.callrail_tags ?? [];
  const qualifiedTag = qualifiedChoice(tags);
  const qualified = qualifiedTag === "QUALIFIED YES" ? true : qualifiedTag === "QUALIFIED NO" ? false : lead.qualified;
  if (qualified !== true && qualified !== false) gaps.push("Qualified");

  const consultDate = (lead.consultation_date ?? "").slice(0, 10);
  const consultNo = (lead.consultation ?? "").toLowerCase() === "no";
  const consultYes = /^\d{4}-\d{2}-\d{2}$/.test(consultDate);
  if (!consultNo && !consultYes) gaps.push(lead.consultation ? "Consultation date" : "Consultation");

  const desiredYes = lead.signed_case === true || lead.desired_case === true || tags.includes("CVR DESIRED");
  if (!desiredYes && lead.desired_case !== false) gaps.push("Desired");
  if (desiredYes && !selectedOne(tags, SIZE_TAGS)) gaps.push("Size");
  if (!desiredYes && lead.desired_case === false && !selectedDecline(tags)) gaps.push("Decline reason");
  if (lead.signed_case && !/^\d{4}-\d{2}-\d{2}/.test(lead.date_signed ?? "")) gaps.push("Signed date");
  return gaps;
}

export function closeIncompleteMessage(gaps: string[]): string {
  return `Finish the lead before closing it: ${gaps.join(", ")}.`;
}

export function assertCloseReady(lead: CloseReadyLead, kind: "lead" | "nonlead" = "lead"): void {
  const gaps = closeGaps(lead, kind);
  if (gaps.length) throw new Error(closeIncompleteMessage(gaps));
}
