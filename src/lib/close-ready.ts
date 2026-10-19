import { isPiCaseType } from "@/lib/leads";
import { isPlaceholderOwner } from "@/lib/talked-with";
import { NOT_QUALIFIED_TAGS, SIZE_TAGS, qualifiedChoice, selectedDecline, selectedOne } from "@/lib/tags";

export type CloseReadyLead = {
  lead_name?: string | null;
  phone?: string | null;
  phone_e164?: string | null;
  identity_status?: string | null;
  owner_name?: string | null;
  qualified?: boolean | null;
  callrail_tags?: string[] | null;
  desired_case?: boolean | null;
  signed_case?: boolean | null;
  caller_class?: string | null;
  case_type?: string | null;
  consultation_date?: string | null;
};

export function closeGaps(lead: CloseReadyLead, kind: "lead" | "nonlead" = "lead"): string[] {
  const gaps: string[] = [];
  if (lead.identity_status === "needs_review") gaps.push("Confirm the client name");
  if (kind === "nonlead") return gaps;

  const name = lead.lead_name?.trim() ?? "";
  if (!name || /^not captured$/i.test(name)) gaps.push("Lead name");
  const phone = (lead.phone_e164 || lead.phone || "").replace(/\D/g, "");
  if (phone.length < 7) gaps.push("Phone");
  if (isPlaceholderOwner(lead.owner_name)) gaps.push("Handled by");

  const tags = lead.callrail_tags ?? [];
  const qualifiedTag = qualifiedChoice(tags);
  const qualified = qualifiedTag === "QUALIFIED YES" ? true : qualifiedTag === "QUALIFIED NO" ? false : lead.qualified;
  if (qualified !== true && qualified !== false) gaps.push("Qualified YES or NO");

  const nonPi =
    lead.caller_class === "non_pi" ||
    lead.case_type === "Non-PI Legal Matter" ||
    selectedOne(tags, NOT_QUALIFIED_TAGS) === "NQ: Non-PI Legal Matter";
  if (!nonPi && qualified !== false && !isPiCaseType(lead.case_type)) {
    gaps.push("Case type");
  }
  if ((lead.desired_case || lead.signed_case) && !selectedOne(tags, SIZE_TAGS)) gaps.push("Size");
  if (qualified === false && !selectedDecline(tags) && !selectedOne(tags, NOT_QUALIFIED_TAGS)) {
    gaps.push("Decline or not-qualified reason");
  }
  return gaps;
}

export function closeIncompleteMessage(gaps: string[]): string {
  return `Finish the lead before closing it: ${gaps.join(", ")}.`;
}

export function assertCloseReady(lead: CloseReadyLead, kind: "lead" | "nonlead" = "lead"): void {
  const gaps = closeGaps(lead, kind);
  if (gaps.length) throw new Error(closeIncompleteMessage(gaps));
}
