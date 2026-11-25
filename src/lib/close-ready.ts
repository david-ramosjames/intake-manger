import { isWorkLead } from "@/lib/caller-class";
import { isSourceType } from "@/lib/leads";
import { isSourceCategory } from "@/lib/source-options";
import { QUALIFIED_NO, QUALIFIED_YES, SIZE_TAGS, qualifiedChoice, selectedDecline, selectedOne } from "@/lib/tags";

export const CLOSE_READY_COLUMNS =
  "lead_name, phone, phone_e164, email, identity_status, owner_name, arrival, qualified, callrail_tags, desired_case, signed_case, date_signed, caller_class, case_type, lead_source, source_type, source_category, consultation, consultation_date, screen_by, intake_by, lead_date, created_at";

export type CloseReadyLead = {
  lead_name?: string | null;
  phone?: string | null;
  phone_e164?: string | null;
  email?: string | null;
  identity_status?: string | null;
  owner_name?: string | null;
  arrival?: string | null;
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
  screen_by?: string | null;
  intake_by?: string | null;
  lead_date?: string | null;
  created_at?: string | null;
  /** Days since the lead arrived. Used when the close check does not have the dates. */
  age_days?: number | null;
  /** Reason this close is using, such as no_response. */
  closing_as?: string | null;
};

/** What has to be finished before this kind of close. */
export type ClosePath = "nonlead" | "base" | "chase" | "declined" | "signed" | "lost";

export function closeGaps(lead: CloseReadyLead, path: ClosePath = "base"): string[] {
  if (path === "nonlead" || !isWorkLead(lead)) {
    return lead.identity_status === "needs_review" ? ["Confirm the client name"] : [];
  }
  const gaps = baseCloseGaps(lead);
  addHandlerGaps(lead, gaps, path);
  if (path === "base" || path === "chase") return gaps;
  if (path === "declined") {
    // Referrals still need a Qualified Yes/No — same bar as Lost, even when
    // Desired is already No and a decline reason is set.
    const qualified = qualifiedValue(lead);
    if (qualified !== true && qualified !== false) gaps.push("Qualified");
    if (lead.desired_case !== false) gaps.push("Desired");
    if (!selectedDecline(lead.callrail_tags ?? [])) gaps.push("Decline reason");
    return gaps;
  }
  if (path === "signed") {
    if (qualifiedValue(lead) !== true) gaps.push("Qualified");
    if (desiredValue(lead) !== true) gaps.push("Desired");
    if (!selectedOne(lead.callrail_tags ?? [], SIZE_TAGS)) gaps.push("Size");
    if (!/^\d{4}-\d{2}-\d{2}/.test(lead.date_signed ?? "")) gaps.push("Signed date");
    return gaps;
  }
  if (path === "lost") {
    // Lost still needs the file filled (consult / qualified / desired). Save can
    // leave those blank; closing as lost cannot.
    const qualified = qualifiedValue(lead);
    if (qualified !== true && qualified !== false) gaps.push("Qualified");
    if (desiredValue(lead) == null) gaps.push("Desired");
    return gaps;
  }
  const qualified = qualifiedValue(lead);
  if (qualified !== true && qualified !== false) gaps.push("Qualified");
  if (desiredValue(lead) == null) gaps.push("Desired");
  return gaps;
}

function daysSinceArrival(lead: CloseReadyLead): number | null {
  const raw = (lead.lead_date || lead.created_at || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const start = Date.parse(`${raw}T00:00:00Z`);
    if (Number.isFinite(start)) return Math.floor((Date.now() - start) / 86400000);
  }
  return lead.age_days ?? null;
}

function consultedYes(lead: CloseReadyLead): boolean {
  if ((lead.consultation ?? "").trim().toLowerCase() === "no") return false;
  if ((lead.consultation ?? "").trim()) return true;
  return /^\d{4}-\d{2}-\d{2}/.test((lead.consultation_date ?? "").slice(0, 10));
}

/** Not a lead, and unresponsive after the 14-day chase, can close with screening blank. */
function screeningOptional(lead: CloseReadyLead, path: ClosePath): boolean {
  if (path === "nonlead" || path === "chase") return true;
  if (lead.closing_as === "no_response" && (daysSinceArrival(lead) ?? 0) >= 14) return true;
  return false;
}

function addHandlerGaps(lead: CloseReadyLead, gaps: string[], path: ClosePath) {
  if (!screeningOptional(lead, path) && !lead.screen_by?.trim()) gaps.push("Screening");
  const needsIntake = consultedYes(lead) || qualifiedValue(lead) === true;
  if (needsIntake && !lead.intake_by?.trim()) gaps.push("Intake");
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
  if (!consultNo && !consultYes) {
    // "staff" / other truthy means Yes was chosen but the date is still blank.
    gaps.push(lead.consultation ? "Consultation date" : "Consultation (Yes or No)");
  }
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

/** The contract is signed and every field a signed file needs is filled in. */
export function signedFileReady(lead: CloseReadyLead): boolean {
  return closeGaps(lead, "signed").length === 0;
}

export function closeIncompleteMessage(gaps: string[]): string {
  return `Finish the lead before closing it: ${gaps.join(" · ")}.`;
}

export function lostCloseMessage(gaps: string[]): string {
  if (gaps.length === 1) return `Still needed before this can close as lost: ${gaps[0]}.`;
  return `Still needed before this can close as lost (${gaps.length}): ${gaps.join(" · ")}.`;
}

/** Pull field names back out of a close error so the form can mark those boxes. */
export function gapsFromCloseMessage(message: string): string[] | null {
  const match = /^Finish the lead before closing it: (.+)\.$/.exec(message.trim());
  if (!match) return null;
  const gaps = match[1].split(" · ").map((part) => part.trim()).filter(Boolean);
  return gaps.length ? gaps : null;
}

export function referralCloseMessage(gaps: string[]): string {
  const parts = gaps.map((gap) => {
    if (gap === "Desired") return "Desired has to be No";
    if (gap === "Decline reason") return "Decline reason under Desired";
    return gap;
  });
  if (parts.length === 1) return `Still needed before the referral can close: ${parts[0]}.`;
  return `Still needed before the referral can close (${parts.length}): ${parts.join(" · ")}.`;
}

export function assertCloseReady(lead: CloseReadyLead, path: ClosePath = "base"): void {
  const gaps = closeGaps(lead, path);
  if (gaps.length) throw new Error(closeIncompleteMessage(gaps));
}
