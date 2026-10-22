import { isWorkLead } from "@/lib/caller-class";
import { isSourceType } from "@/lib/leads";
import { isSourceCategory } from "@/lib/source-options";
import { QUALIFIED_NO, QUALIFIED_YES, SIZE_TAGS, qualifiedChoice, selectedDecline, selectedOne } from "@/lib/tags";

export const CLOSE_READY_COLUMNS =
  "lead_name, phone, phone_e164, email, identity_status, owner_name, qualified, callrail_tags, desired_case, signed_case, date_signed, caller_class, case_type, lead_source, source_type, source_category, consultation, consultation_date";

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
  source_category?: string | null;
  consultation?: string | null;
  consultation_date?: string | null;
};

/** What has to be finished before this kind of close. */
export type ClosePath = "nonlead" | "base" | "chase" | "declined" | "signed" | "lost";

export function closeGaps(lead: CloseReadyLead, path: ClosePath = "base"): string[] {
  if (path === "nonlead" || !isWorkLead(lead)) {
    return lead.identity_status === "needs_review" ? ["Confirm the client name"] : [];
  }
  const gaps = baseCloseGaps(lead);
  if (path === "base" || path === "chase") return gaps;
  if (path === "declined") {
    if (lead.desired_case !== false) gaps.push("Desired");
    if (!selectedDecline(lead.callrail_tags ?? [])) gaps.push("Decline reason");
    return gaps;
  }
  if (path === "signed") {
    if (!selectedOne(lead.callrail_tags ?? [], SIZE_TAGS)) gaps.push("Size");
    if (!/^\d{4}-\d{2}-\d{2}/.test(lead.date_signed ?? "")) gaps.push("Signed date");
    return gaps;
  }
  const qualified = qualifiedValue(lead);
  if (qualified !== true && qualified !== false) gaps.push("Qualified");
  if (desiredValue(lead) == null) gaps.push("Desired");
  return gaps;
}

function baseCloseGaps(lead: CloseReadyLead): string[] {
  const gaps: string[] = [];
  if (lead.identity_status === "needs_review") gaps.push("Confirm the client name");
  const name = lead.lead_name?.trim() ?? "";
  if (!name || /^not captured$/i.test(name)) gaps.push("Lead name");
  const phone = (lead.phone_e164 || lead.phone || "").replace(/\D/g, "");
  if (phone.length < 7) gaps.push("Phone");
  if (!isSourceType(lead.source_type) || lead.source_type === "Unknown") gaps.push("Source type");
  if (!isSourceCategory(lead.source_category)) gaps.push("Source category");
  if (!lead.lead_source?.trim()) gaps.push("Lead source");
  if (!lead.case_type?.trim()) gaps.push("Case type");
  const consultDate = (lead.consultation_date ?? "").slice(0, 10);
  const consultNo = (lead.consultation ?? "").toLowerCase() === "no";
  const consultYes = /^\d{4}-\d{2}-\d{2}$/.test(consultDate);
  if (!consultNo && !consultYes) gaps.push(lead.consultation ? "Consultation date" : "Consultation");
  return gaps;
}

function qualifiedValue(lead: CloseReadyLead): boolean | null {
  const tag = qualifiedChoice(lead.callrail_tags ?? []);
  if (tag === QUALIFIED_YES) return true;
  if (tag === QUALIFIED_NO) return false;
  if (lead.qualified === true || lead.qualified === false) return lead.qualified;
  return null;
}

function desiredValue(lead: CloseReadyLead): boolean | null {
  if (lead.desired_case === true || lead.desired_case === false) return lead.desired_case;
  if ((lead.callrail_tags ?? []).includes("CVR DESIRED")) return true;
  return null;
}

export function closeIncompleteMessage(gaps: string[]): string {
  return `Finish the lead before closing it: ${gaps.join(", ")}.`;
}

export function assertCloseReady(lead: CloseReadyLead, path: ClosePath = "base"): void {
  const gaps = closeGaps(lead, path);
  if (gaps.length) throw new Error(closeIncompleteMessage(gaps));
}
