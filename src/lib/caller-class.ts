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

/** A bad record, not a bad call. Kept out of the work queue and out of the non-lead counts. */
export const DATA_ERROR_CLASS = "data_error" as const;
export const DATA_ERROR_TAG = "NL: Data Error";

export type CallerClass = ExcludedCallerClass | "non_pi" | typeof DATA_ERROR_CLASS;

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
  data_error: "Data error",
};

export const NON_LEAD_TAG: Record<ExcludedCallerClass, string> = {
  spam: "NL: Spam / Robo Call",
  vendor: "NL: Vendor / Sales",
  employment: "NL: Seeking Employment",
  existing_client: "NL: Existing Client",
  insurance: "NL: Insurance Company / Provider",
  other_law_office: "NL: Law Office",
  wrong_number: "NL: Wrong Number / Misdial",
  return_call: "NL: Return Call",
};

export function isWorkLead(lead: { caller_class?: string | null }): boolean {
  if (lead.caller_class === DATA_ERROR_CLASS) return false;
  if (lead.caller_class && EXCLUDED.has(lead.caller_class)) return false;
  return true;
}

export function callerClassLabel(value: string | null | undefined): string | null {
  if (!value || !(value in CALLER_CLASS_LABEL)) return null;
  return CALLER_CLASS_LABEL[value as CallerClass];
}
