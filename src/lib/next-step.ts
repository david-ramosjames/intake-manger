import type { Lead } from "./leads";

export type ClientTouch = {
  type: string | null;
  direction: string | null;
};

const SIGNING = new Set(["sent", "viewed"]);

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
  if (lead.signed_case || lead.lead_status === "Signed") return null;

  const status = lead.agreement_status || "";
  const contractOut = SIGNING.has(status) || (Boolean(lead.agreement_sent_at) && !["signed", "completed", "cancelled", "expired", "failed"].includes(status));
  if (contractOut) {
    return {
      title: "Finish signing the contract",
      detail: "The contract has been sent. The next step is the signature.",
    };
  }

  const formLead = lead.arrival === "form" || lead.source_channel === "Web form";
  if (formLead && !talkedWithClient(touches)) {
    return {
      title: "Contact this web form first",
      detail: "They submitted a form. Talk to them before deciding whether to send the contract or keep gathering information.",
    };
  }

  if (lead.kind === "needs_info" || lead.sequence === "needs_info") {
    return {
      title: "Still gathering information",
      detail: "There is a conversation, and this lead still needs more before a contract.",
    };
  }

  if (lead.kind === "pursue" || lead.sequence === "want_to_sign") {
    return {
      title: "Send the contract",
      detail: "The conversation is far enough along to send the contract.",
    };
  }

  return {
    title: "Still gathering information",
    detail: "Use the conversation to decide whether this is ready for a contract.",
  };
}
