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
  "DEC: Workers Comp",
] as const;

export const NOT_A_LEAD_TAGS = [
  "NL: Existing Client",
  "NL: Insurance Company / Provider",
  "NL: Law Office",
  "NL: Return Call",
  "NL: Seeking Employment",
  "NL: Vendor / Sales",
  "NL: Wrong Number / Misdial",
] as const;

export const NOT_QUALIFIED_TAGS = [
  "NQ: Non-PI Legal Matter",
  "NQ: Outside Service Area",
  "NQ: Spam / Robo Call",
  "NQ: Unresponsive",
] as const;

export const SIZE_TAGS = ["S: Large", "S: Medium", "S: Small"] as const;

export const TYPE_TAGS = [
  "T: Auto Accident",
  "T: Commercial / 18 Wheeler",
  "T: Dog Bite",
  "T: Other Injury",
  "T: Pedestrian / Bicycle / Scooter",
  "T: Premises Liability",
  "T: Sexual Assault / Child Abuse",
  "T: Wrongful Death",
] as const;

export const LEAD_TAGS = [
  QUALIFIED_YES,
  QUALIFIED_NO,
  ...COVERAGE_TAGS,
  ...DECLINE_TAGS,
  ...NOT_A_LEAD_TAGS,
  ...NOT_QUALIFIED_TAGS,
  ...SIZE_TAGS,
  ...TYPE_TAGS,
] as const;

export const TAG_LABEL: Record<(typeof LEAD_TAGS)[number], string> = {
  "QUALIFIED YES": "QUALIFIED YES",
  "QUALIFIED NO": "QUALIFIED NO",
  "CVR DESIRED": "CVR DESIRED",
  "CVR SIGNED": "CVR SIGNED",
  "DEC: At Fault / Bad Facts": "DEC: At Fault / Bad Facts",
  "DEC: Has Attorney": "DEC: Has Attorney",
  "DEC: Medmal": "DEC: Medmal",
  "DEC: No Injury / Property Damage": "DEC: No Injury / Property Damage",
  "DEC: No Insurance": "DEC: No Insurance",
  "DEC: Referred": "DEC: Referred",
  "DEC: Statue Issue": "DEC: Statue Issue",
  "DEC: Workers Comp": "DEC: Workers Comp",
  "NL: Existing Client": "NL: Existing Client",
  "NL: Insurance Company / Provider": "NL: Insurance Company / Provider",
  "NL: Law Office": "NL: Law Office",
  "NL: Return Call": "NL: Return Call",
  "NL: Seeking Employment": "NL: Seeking Employment",
  "NL: Vendor / Sales": "NL: Vendor / Sales",
  "NL: Wrong Number / Misdial": "NL: Wrong Number / Misdial",
  "NQ: Non-PI Legal Matter": "NQ: Non-PI Legal Matter",
  "NQ: Outside Service Area": "NQ: Outside Service Area",
  "NQ: Spam / Robo Call": "NQ: Spam / Robo Call",
  "NQ: Unresponsive": "NQ: Unresponsive",
  "S: Large": "S: Large",
  "S: Medium": "S: Medium",
  "S: Small": "S: Small",
  "T: Auto Accident": "T: Auto Accident",
  "T: Commercial / 18 Wheeler": "T: Commercial / 18 Wheeler",
  "T: Dog Bite": "T: Dog Bite",
  "T: Other Injury": "T: Other Injury",
  "T: Pedestrian / Bicycle / Scooter": "T: Pedestrian / Bicycle / Scooter",
  "T: Premises Liability": "T: Premises Liability",
  "T: Sexual Assault / Child Abuse": "T: Sexual Assault / Child Abuse",
  "T: Wrongful Death": "T: Wrongful Death",
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

const NOT_QUALIFIED_SET = new Set<string>(NOT_QUALIFIED_TAGS);
const SIZE_SET = new Set<string>(SIZE_TAGS);
const TYPE_SET = new Set<string>(TYPE_TAGS);

export function selectedOne(tags: string[], options: readonly string[]): string {
  return tags.find((tag) => options.includes(tag)) ?? "";
}

export function tagsFromSelection(input: {
  qualified: string;
  coverage: string[];
  decline: string;
  signed?: boolean;
  desired?: boolean;
  nonPi?: boolean;
  size?: string;
  injuryType?: string;
  notQualified?: string;
}): { tags: string[]; qualified: boolean | null; decline_reason: string | null } {
  const notQualified = NOT_QUALIFIED_SET.has(input.notQualified || "") ? String(input.notQualified) : "";
  const nonPi = Boolean(input.nonPi) || notQualified === "NQ: Non-PI Legal Matter";
  const qualified =
    notQualified || nonPi
      ? QUALIFIED_NO
      : input.qualified === QUALIFIED_YES || input.qualified === QUALIFIED_NO
        ? input.qualified
        : "";
  if (!qualified) throw new Error("Choose Qualified YES or Qualified NO.");
  const decline = DECLINE_SET.has(input.decline) ? input.decline : "";
  const wanted = Boolean(input.desired || input.signed);
  const coverage = COVERAGE_TAGS.filter((tag) => input.coverage.includes(tag)).filter((tag) => {
    if (tag === "CVR DESIRED") return wanted;
    if (tag === "CVR SIGNED") return Boolean(input.signed);
    return true;
  });
  if (wanted && !coverage.includes("CVR DESIRED")) coverage.push("CVR DESIRED");
  if (input.signed && !coverage.includes("CVR SIGNED")) coverage.push("CVR SIGNED");
  if (decline && coverage.includes("CVR SIGNED")) {
    throw new Error("A signed lead is not declined. Clear the decline tag.");
  }

  const tags: string[] = [qualified, ...coverage];
  if (decline) tags.push(decline);
  if (notQualified) tags.push(notQualified);
  if (wanted && SIZE_SET.has(input.size || "")) tags.push(String(input.size));
  if (!nonPi && TYPE_SET.has(input.injuryType || "")) tags.push(String(input.injuryType));
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
