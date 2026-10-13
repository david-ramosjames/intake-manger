export const QUALIFIED_YES = "QUALIFIED YES";
export const QUALIFIED_NO = "QUALIFIED NO";

export const COVERAGE_TAGS = ["CVR DESIRED", "CVR SIGNED"] as const;

export const DECLINE_TAGS = [
  "DEC: At Fault / Bad Facts",
  "DEC: Has Attorney",
  "DEC: Medmal",
  "DEC: No Injury / Property Damage",
  "DEC: No Insurance",
  "DEC: Referred",
  "DEC: Statue Issue",
] as const;

export const LEAD_TAGS = [QUALIFIED_YES, QUALIFIED_NO, ...COVERAGE_TAGS, ...DECLINE_TAGS] as const;

export const TAG_LABEL: Record<(typeof LEAD_TAGS)[number], string> = {
  "QUALIFIED YES": "QUALIFIED YES",
  "QUALIFIED NO": "QUALIFIED NO",
  "CVR DESIRED": "CVR DESIRED (want to sign)",
  "CVR SIGNED": "CVR SIGNED (signed)",
  "DEC: At Fault / Bad Facts": "DEC: At Fault / Bad Facts",
  "DEC: Has Attorney": "DEC: Has Attorney",
  "DEC: Medmal": "DEC: Medmal",
  "DEC: No Injury / Property Damage": "DEC: No Injury / Property Damage",
  "DEC: No Insurance": "DEC: No Insurance",
  "DEC: Referred": "DEC: Referred",
  "DEC: Statue Issue": "DEC: Statue Issue",
};

export type DeclineTag = (typeof DECLINE_TAGS)[number];

const DECLINE_SET = new Set<string>(DECLINE_TAGS);

export function declineReasonFromTag(tag: string | null | undefined): string | null {
  if (!tag || !DECLINE_SET.has(tag)) return null;
  const reason = tag.slice("DEC:".length).trim();
  return reason || null;
}

export function selectedDecline(tags: string[]): string {
  return tags.find((tag) => DECLINE_SET.has(tag)) ?? "";
}

export function qualifiedChoice(tags: string[]): typeof QUALIFIED_YES | typeof QUALIFIED_NO | "" {
  if (tags.includes(QUALIFIED_YES)) return QUALIFIED_YES;
  if (tags.includes(QUALIFIED_NO)) return QUALIFIED_NO;
  return "";
}

export function tagsFromSelection(input: {
  qualified: string;
  coverage: string[];
  decline: string;
  signed?: boolean;
}): { tags: string[]; qualified: boolean; decline_reason: string | null } {
  let qualified = input.qualified;
  if (input.signed) qualified = QUALIFIED_YES;
  if (qualified !== QUALIFIED_YES && qualified !== QUALIFIED_NO) {
    throw new Error("Every lead needs Qualified yes or Qualified no.");
  }

  const decline = DECLINE_SET.has(input.decline) ? input.decline : "";
  if (decline && qualified === QUALIFIED_YES) {
    throw new Error("A declined lead is Qualified no. Clear the decline tag, or choose Qualified no.");
  }

  const coverage = COVERAGE_TAGS.filter((tag) => input.coverage.includes(tag));
  if (input.signed && !coverage.includes("CVR SIGNED")) coverage.push("CVR SIGNED");
  if (decline && coverage.includes("CVR SIGNED")) {
    throw new Error("A signed lead is not declined. Clear the decline tag.");
  }

  const tags = [qualified, ...coverage];
  if (decline) tags.push(decline);
  return {
    tags,
    qualified: qualified === QUALIFIED_YES,
    decline_reason: declineReasonFromTag(decline),
  };
}

export function qualifiedLine(tags: string[], declineReason: string | null): string {
  const summary = qualifiedSummary(tags, declineReason);
  return summary === "Not tagged" ? summary : `Qualified ${summary}`;
}

export function qualifiedSummary(tags: string[], declineReason: string | null): string {
  if (tags.includes(QUALIFIED_YES)) return "Yes";
  if (tags.includes(QUALIFIED_NO)) return declineReason ? `No · ${declineReason}` : "No";
  return "Not tagged";
}
