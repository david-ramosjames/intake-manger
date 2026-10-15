export const EXCLUDED_CALLER_CLASSES = [
  "spam",
  "vendor",
  "employment",
  "existing_client",
  "insurance",
  "other_law_office",
  "wrong_number",
  "return_call",
] as const;

export type ExcludedCallerClass = (typeof EXCLUDED_CALLER_CLASSES)[number];
export type CallerClass = ExcludedCallerClass | "non_pi";

const EXCLUDED = new Set<string>(EXCLUDED_CALLER_CLASSES);

export const CALLER_CLASS_LABEL: Record<CallerClass, string> = {
  spam: "Spam / robocall",
  vendor: "Vendor",
  employment: "Employment inquiry",
  existing_client: "Existing client",
  insurance: "Insurance company",
  other_law_office: "Other law office",
  wrong_number: "Wrong number",
  return_call: "Return call",
  non_pi: "Non-PI legal matter",
};

export const NON_LEAD_TAG: Record<ExcludedCallerClass, string> = {
  spam: "NQ: Spam / Robo Call",
  vendor: "NL: Vendor / Sales",
  employment: "NL: Seeking Employment",
  existing_client: "NL: Existing Client",
  insurance: "NL: Insurance Company / Provider",
  other_law_office: "NL: Law Office",
  wrong_number: "NL: Wrong Number / Misdial",
  return_call: "NL: Return Call",
};

export function isWorkLead(lead: { caller_class?: string | null }): boolean {
  if (lead.caller_class && EXCLUDED.has(lead.caller_class)) return false;
  return true;
}

export function callerClassLabel(value: string | null | undefined): string | null {
  if (!value || !(value in CALLER_CLASS_LABEL)) return null;
  return CALLER_CLASS_LABEL[value as CallerClass];
}
