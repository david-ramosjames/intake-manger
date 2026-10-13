export const CALL_SEQUENCES = ["want_to_sign", "first_talk", "more_info"] as const;

export type CallSequenceId = (typeof CALL_SEQUENCES)[number];

export const CALL_SEQUENCE_LABEL: Record<CallSequenceId, string> = {
  want_to_sign: "Want to sign",
  first_talk: "First conversation",
  more_info: "Need more information",
};

export const CALL_SEQUENCE_DETAIL: Record<CallSequenceId, string> = {
  want_to_sign: "A lead we want to sign. The call times here are the next call.",
  first_talk: "A lead we still need to talk to for the first time.",
  more_info: "A lead we already talked to, and we still need more information.",
};

export function isCallSequence(value: string | null | undefined): value is CallSequenceId {
  return value === "want_to_sign" || value === "first_talk" || value === "more_info";
}

export function leadSequenceId(input: {
  closed: boolean;
  talked: boolean;
  kind: string | null;
  agreementStatus: string | null;
  agreementSentAt: string | null;
}): CallSequenceId | null {
  if (input.closed) return null;
  const agreement = (input.agreementStatus || "").toLowerCase();
  const contractOut =
    agreement === "sent" ||
    agreement === "viewed" ||
    (Boolean(input.agreementSentAt) && !["failed", "signed", "completed"].includes(agreement));
  if (contractOut) return "want_to_sign";
  if (!input.talked) return "first_talk";
  if (input.kind === "needs_info") return "more_info";
  return "want_to_sign";
}

export function splitDelay(minutes: number): { days: number; hours: number } {
  const safe = Math.max(0, Math.round(minutes));
  return { days: Math.floor(safe / 1440), hours: Math.floor((safe % 1440) / 60) };
}

export function delayMinutes(days: number, hours: number): number {
  return days * 1440 + hours * 60;
}
