export const QUALIFIED_YES = "QUALIFIED YES";
export const QUALIFIED_NO = "QUALIFIED NO";

export const COVERAGE_TAGS = ["CVR DESIRED", "CVR SIGNED"] as const;

export const DECLINE_TAGS = [
  "DEC: At Fault / Bad Facts",
  "DEC: Has Attorney",
  "DEC: Medmal",
  "DEC: No Injury / Property Damage",
  "DEC: No Insurance",
  "DEC: Non-PI Legal Matter",
  "DEC: Outside Service Area",
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
  "NL: Spam / Robo Call",
  "NL: Vendor / Sales",
  "NL: Wrong Number / Misdial",
] as const;

/** Staff do not pick this. The 16-day follow-up assigns it when the sequence ends with no connection. */
export const NOT_QUALIFIED_TAGS = ["NQ: Unresponsive"] as const;

const RETIRED_NOT_QUALIFIED_TAGS = ["NQ: Spam / Robo Call", "NQ: Outside Service Area", "NQ: Non-PI Legal Matter"] as const;

export const SIZE_TAGS = ["S: Small", "S: Medium", "S: Large"] as const;

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

/** Tags this app may replace on a CallRail call. The old spam tag is listed so a push removes it. */
export const MANAGED_CALLRAIL_TAGS = [...LEAD_TAGS, ...RETIRED_NOT_QUALIFIED_TAGS] as const;

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
  "NL: Spam / Robo Call": "NL: Spam / Robo Call",
  "NL: Vendor / Sales": "NL: Vendor / Sales",
  "NL: Wrong Number / Misdial": "NL: Wrong Number / Misdial",
  "NQ: Unresponsive": "NQ: Unresponsive",
  "DEC: Non-PI Legal Matter": "DEC: Non-PI Legal Matter",
  "DEC: Outside Service Area": "DEC: Outside Service Area",
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

const LEGACY_DECLINE: Record<string, (typeof DECLINE_TAGS)[number]> = {
  "NQ: Outside Service Area": "DEC: Outside Service Area",
  "NQ: Non-PI Legal Matter": "DEC: Non-PI Legal Matter",
};

export function selectedDecline(tags: string[]): string {
  const direct = tags.find((tag) => DECLINE_SET.has(tag));
  if (direct) return direct;
  for (const tag of tags) {
    const mapped = LEGACY_DECLINE[tag];
    if (mapped) return mapped;
  }
  return "";
}

export function qualifiedChoice(tags: string[]): typeof QUALIFIED_YES | typeof QUALIFIED_NO | "" {
  if (tags.includes(QUALIFIED_YES)) return QUALIFIED_YES;
  if (tags.includes(QUALIFIED_NO)) return QUALIFIED_NO;
  return "";
}

const SIZE_SET = new Set<string>(SIZE_TAGS);
const TYPE_SET = new Set<string>(TYPE_TAGS);

const CASE_TO_INJURY: Record<string, (typeof TYPE_TAGS)[number]> = {
  "Auto Accident": "T: Auto Accident",
  "Commercial / 18 Wheeler": "T: Commercial / 18 Wheeler",
  "Dog Bite": "T: Dog Bite",
  "Other Injury": "T: Other Injury",
  "Pedestrian / Bicycle / Scooter": "T: Pedestrian / Bicycle / Scooter",
  "Premises Liability": "T: Premises Liability",
  "Sexual Assault / Child Abuse": "T: Sexual Assault / Child Abuse",
  "Wrongful Death": "T: Wrongful Death",
};

/** The injury tag follows the case type. They are one choice. */
export function injuryTagForCaseType(caseType: string | null | undefined): string {
  const text = String(caseType || "").trim();
  return CASE_TO_INJURY[text] ?? "";
}

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
  requireQualified?: boolean;
}): { tags: string[]; qualified: boolean | null; decline_reason: string | null } {
  const legacy = input.notQualified || "";
  const nonPi = Boolean(input.nonPi) || legacy === "NQ: Non-PI Legal Matter";
  const qualified =
    legacy === "NQ: Unresponsive" || nonPi
      ? QUALIFIED_NO
      : input.qualified === QUALIFIED_YES || input.qualified === QUALIFIED_NO
        ? input.qualified
        : "";
  if (!qualified && input.requireQualified !== false) throw new Error("Choose Qualified YES or Qualified NO.");
  const decline =
    DECLINE_SET.has(input.decline)
      ? input.decline
      : legacy === "NQ: Outside Service Area"
        ? "DEC: Outside Service Area"
        : legacy === "NQ: Non-PI Legal Matter"
          ? "DEC: Non-PI Legal Matter"
          : "";
  const wanted = qualified === QUALIFIED_NO ? false : Boolean(input.desired || input.signed);
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

  const tags: string[] = qualified ? [qualified, ...coverage] : [...coverage];
  if (decline) tags.push(decline);
  if (legacy === "NQ: Unresponsive") tags.push("NQ: Unresponsive");
  if (SIZE_SET.has(input.size || "")) tags.push(String(input.size));
  if (!nonPi && TYPE_SET.has(input.injuryType || "")) tags.push(String(input.injuryType));
  return {
    tags,
    qualified: qualified === QUALIFIED_YES ? true : qualified === QUALIFIED_NO ? false : null,
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
