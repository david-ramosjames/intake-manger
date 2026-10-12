export const CALL_OUTCOMES = [
  { id: "answered", label: "Answered" },
  { id: "no_answer", label: "No answer" },
  { id: "voicemail", label: "Left voicemail" },
  { id: "callback", label: "Callback" },
  { id: "wrong_number", label: "Wrong number" },
  { id: "not_interested", label: "Not interested" },
] as const;

export type CallOutcome = (typeof CALL_OUTCOMES)[number]["id"];

export function isCallOutcome(value: string | null | undefined): value is CallOutcome {
  return CALL_OUTCOMES.some((outcome) => outcome.id === value);
}

export function callOutcomeLabel(value: string | null | undefined): string {
  return CALL_OUTCOMES.find((outcome) => outcome.id === value)?.label ?? value ?? "Attempt";
}
