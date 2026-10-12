import type { Lead } from "./leads";

export type ClientTouch = {
  type: string | null;
  direction: string | null;
};

const SIGNING = new Set(["sent", "viewed"]);

export type LeadCycle = "contact" | "information" | "signing" | "signed" | "closed";

export const CYCLE_LABEL: Record<LeadCycle, string> = {
  contact: "Need to contact",
  information: "Need more information",
  signing: "Finish signing",
  signed: "Signed",
  closed: "Closed",
};

type CycleLead = {
  signed_case?: boolean | null;
  lead_status?: string | null;
  agreement_status?: string | null;
  agreement_sent_at?: string | null;
  arrival?: string | null;
  grade?: string | null;
  case_type?: string | null;
  case_detail?: string | null;
};

function contractIsOut(lead: CycleLead): boolean {
  const status = lead.agreement_status || "";
  if (["signed", "completed", "cancelled", "expired", "failed"].includes(status)) return false;
  return SIGNING.has(status) || Boolean(lead.agreement_sent_at);
}

function reachedClient(lead: CycleLead, touches: ClientTouch[]): boolean {
  if (talkedWithClient(touches)) return true;
  return lead.arrival === "human_call" || lead.arrival === "qualified_call" || lead.arrival === "sona";
}

export function leadCycle(lead: CycleLead, touches: ClientTouch[] = []): LeadCycle {
  if (lead.signed_case || lead.lead_status === "Signed" || lead.agreement_status === "signed" || lead.agreement_status === "completed") {
    return "signed";
  }
  if (lead.lead_status === "Lost") return "closed";
  if (contractIsOut(lead)) return "signing";
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

export function textSequenceLive(status: string | null | undefined): boolean {
  return (status || "").toLowerCase() === "active";
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
      title: "Need to contact",
      detail: "A call or text that they have not answered still counts as not in contact. Reach them before sending a contract.",
    };
  }
  return {
    title: "Need more information",
    detail: "There is a conversation, and this lead still needs more before a contract.",
  };
}
