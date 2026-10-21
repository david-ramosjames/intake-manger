import { contractOutstanding, contractSent, milestoneSigned, signatureNeedsConfirm } from "./desired";
import type { Lead } from "./leads";
import { phoneTail } from "./phone";

export type ClientTouch = {
  type: string | null;
  direction: string | null;
};

export type LeadCycle = "contact" | "information" | "signing" | "signed" | "closed";

export const CYCLE_LABEL: Record<LeadCycle, string> = {
  contact: "Initial Contact",
  information: "Follow up Contact",
  signing: "Finish signing",
  signed: "Signed",
  closed: "Closed",
};

export function leadStatusLabel(
  lead: {
    close_reason?: string | null;
    signed_case?: boolean | null;
    lead_status?: string | null;
    agreement_status?: string | null;
  },
  cycle: LeadCycle,
): string {
  if (cycle === "signed" || lead.close_reason === "signed") return "Signed";
  if (signatureNeedsConfirm(lead)) return "Confirm signature";
  if (lead.close_reason === "declined") return "Declined";
  if (lead.close_reason === "referred" || lead.close_reason === "outside_practice") return "Referred";
  if (lead.close_reason === "signed_elsewhere") return "Signed elsewhere";
  if (lead.close_reason === "not_interested") return "Not interested";
  if (lead.close_reason === "no_response") return "No response";
  if (lead.close_reason === "not_a_lead") return "Not a lead";
  return CYCLE_LABEL[cycle];
}

type CycleLead = {
  signed_case?: boolean | null;
  lead_status?: string | null;
  agreement_status?: string | null;
  agreement_sent_at?: string | null;
  agreement_reminder_count?: number | null;
  agreement_next_reminder_at?: string | null;
  arrival?: string | null;
  grade?: string | null;
  case_type?: string | null;
  case_detail?: string | null;
  close_reason?: string | null;
};

function contractIsOut(lead: CycleLead): boolean {
  return contractOutstanding(lead);
}

function reachedClient(lead: CycleLead, touches: ClientTouch[]): boolean {
  if (talkedWithClient(touches)) return true;
  return lead.arrival === "human_call" || lead.arrival === "qualified_call" || lead.arrival === "sona";
}

export function leadCycle(lead: CycleLead, touches: ClientTouch[] = []): LeadCycle {
  if (contractOutstanding(lead)) return "signing";
  if (lead.signed_case || lead.lead_status === "Signed") return "signed";
  if (lead.lead_status === "Lost" || lead.lead_status === "Referred" || lead.lead_status === "Promoted") return "closed";
  if (contractIsOut(lead) || signatureNeedsConfirm(lead)) return "signing";
  if (!reachedClient(lead, touches)) return "contact";
  return "information";
}

function injuryStrength(lead: CycleLead): "strong" | "possible" | "weak" {
  if (lead.grade === "A") return "strong";
  if (lead.grade === "B") return "possible";
  if (lead.grade === "C") return "weak";
  const text = `${lead.case_type ?? ""} ${lead.case_detail ?? ""}`;
  if (/\b(car|truck|motor|motorcycle|pedestrian|rideshare|18-wheeler|auto)\b/i.test(text)) return "strong";
  if (/\b(assault|dog|slip|work|premises|bicycle)\b/i.test(text)) return "possible";
  return "weak";
}

export type PriorityPlace = "contract" | "flagged" | "suggested";

export const PRIORITY_PLACE_LABEL: Record<PriorityPlace, string> = {
  contract: "Contract out",
  flagged: "Flagged",
  suggested: "Suggested",
};

export async function countCurrentPriority(
  supabase: import("@supabase/supabase-js").SupabaseClient,
): Promise<number> {
  const { data, error } = await supabase
    .from("leads")
    .select("id, phone, signed_case, lead_status, agreement_status, agreement_sent_at, agreement_reminder_count, agreement_next_reminder_at, case_id, priority, priority_suggestion")
    .eq("signed_case", false)
    .not("lead_status", "in", "(Lost,Referred)")
    .or("and(case_id.is.null,lead_status.not.in.(Promoted,Signed)),agreement_status.in.(sent,viewed,signed,completed)")
    .order("lead_date", { ascending: false, nullsFirst: false })
    .limit(300);
  if (error) return 0;
  const placed = (data ?? []).filter((lead) => priorityPlace(lead));
  const phones = [...new Set(placed.map((lead) => lead.phone).filter((phone): phone is string => Boolean(phone)))];
  if (phones.length === 0) return placed.length;
  const { data: signedSiblings } = await supabase.from("leads").select("phone, phone_e164").eq("signed_case", true).in("phone", phones);
  const signedPhones = new Set<string>();
  for (const row of signedSiblings ?? []) {
    const key = phoneTail(row.phone) || phoneTail(row.phone_e164);
    if (key.length >= 10) signedPhones.add(key);
  }
  return placed.filter((lead) => phoneTail(lead.phone).length < 10 || !signedPhones.has(phoneTail(lead.phone))).length;
}

export function priorityPlace(lead: {
  signed_case?: boolean | null;
  lead_status?: string | null;
  agreement_status?: string | null;
  agreement_sent_at?: string | null;
  agreement_reminder_count?: number | null;
  agreement_next_reminder_at?: string | null;
  case_id?: string | null;
  priority?: boolean | null;
  priority_suggestion?: string | null;
}): PriorityPlace | null {
  if (contractOutstanding(lead)) return "contract";
  if (lead.case_id || lead.lead_status === "Promoted") return null;
  if (milestoneSigned(lead) || lead.lead_status === "Lost" || lead.lead_status === "Referred") return null;
  if (signatureNeedsConfirm(lead)) return "contract";
  if (lead.priority) return "flagged";
  if (lead.priority_suggestion) return "suggested";
  return null;
}

export function openLeadAction(
  lead: { next_action?: string | null; agreement_status?: string | null; agreement_sent_at?: string | null; signed_case?: boolean | null; lead_status?: string | null; referral_opportunity?: boolean | null },
  cycle: LeadCycle,
  calls: number,
): string | null {
  if (cycle === "signed" || cycle === "closed") return null;
  const note = lead.next_action?.trim();
  if (note) return note;
  if (lead.referral_opportunity) return "Send the referral text";
  if (signatureNeedsConfirm(lead)) return "Confirm the signature";
  if (contractSent(lead) || cycle === "signing") return "Follow up on the signature";
  return nextCallPurpose(cycle, calls);
}

export function leadPriority(lead: CycleLead, cycle: LeadCycle): "High" | "Medium" | "Low" | null {
  if (cycle === "signed" || cycle === "closed") return null;
  if (cycle === "contact") return "High";
  const strength = injuryStrength(lead);
  if (strength === "strong") return "High";
  if (cycle === "signing") return strength === "weak" ? "Medium" : "High";
  if (strength === "possible") return "Medium";
  return "Low";
}

export function nextCallPurpose(cycle: LeadCycle, calls: number): string | null {
  if (cycle === "signed" || cycle === "closed") return null;
  if (cycle === "signing") return calls > 0 ? "Call again to establish the contract" : "Call to establish the contract";
  if (cycle === "information") return "Call again to gather more information";
  return calls > 0 ? "Call again to capture their details" : "Call to capture their details";
}

const NEXT_STEP_LABEL: Record<string, string> = {
  "Call to capture their details": "Capture details",
  "Call again to capture their details": "Capture details",
  "Call again to gather more information": "Gather information",
  "Call to establish the contract": "Establish contract",
  "Call again to establish the contract": "Establish contract",
};

export function nextStepLabel(purpose: string | null): string {
  if (!purpose) return "—";
  return NEXT_STEP_LABEL[purpose] ?? "—";
}

export function textSequenceLive(status: string | null | undefined): boolean {
  return (status || "").toLowerCase() === "active";
}

/** The contract reminder sequence is on while the contract is still out. SMS Follow-Up is a separate text sequence. */
export function outreachSequence(lead: {
  signed_case?: boolean | null;
  agreement_status?: string | null;
  agreement_sent_at?: string | null;
  agreement_via_sms?: boolean | null;
  agreement_via_email?: boolean | null;
  text_sequence_status?: string | null;
}): { label: string; on: boolean } {
  if (contractOutstanding(lead)) {
    const sms = lead.agreement_via_sms === true;
    const email = lead.agreement_via_email === true;
    if (sms && email) return { label: "Text and email", on: true };
    if (email) return { label: "Email", on: true };
    if (sms) return { label: "Text", on: true };
    return { label: "On", on: true };
  }
  if (textSequenceLive(lead.text_sequence_status)) return { label: "Text", on: true };
  return { label: "Off", on: false };
}

export function talkedWithClient(touches: ClientTouch[]): boolean {
  return touches.some((touch) => {
    const type = (touch.type || "").toLowerCase();
    const direction = (touch.direction || "").toLowerCase();
    if (type === "call" || type === "sona_call") return true;
    if (direction === "inbound" && (type === "text" || type === "email")) return true;
    return false;
  });
}

export function leadNeed(lead: Lead, touches: ClientTouch[]): { title: string; detail: string } | null {
  if (lead.case_id || lead.lead_status === "Promoted") return null;
  const cycle = leadCycle(lead, touches);
  if (cycle === "signed" || cycle === "closed") return null;
  if (cycle === "signing") {
    return {
      title: "Finish signing",
      detail: "The contract has been sent. The next step is the signature.",
    };
  }
  if (cycle === "contact") {
    return {
      title: "Initial Contact",
      detail: "A call or text that they have not answered still counts as not in contact. Reach them before sending a contract.",
    };
  }
  return {
    title: "Follow up Contact",
    detail: "There is a conversation, and this lead still needs more before a contract.",
  };
}
