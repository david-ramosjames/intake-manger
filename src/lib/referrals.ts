export const PRACTICE_AREAS = [
  { id: "family", label: "Family" },
  { id: "immigration", label: "Immigration" },
  { id: "criminal", label: "Criminal defense" },
  { id: "real_estate", label: "Real estate" },
  { id: "medmal", label: "Medical malpractice" },
  { id: "personal_injury", label: "Personal injury" },
  { id: "workers_comp", label: "Workers compensation" },
  { id: "miscellaneous", label: "Miscellaneous" },
  { id: "labor", label: "Labor" },
  { id: "employment", label: "Employment" },
] as const;

export type PracticeAreaId = (typeof PRACTICE_AREAS)[number]["id"];

const AREA_LABEL = new Map(PRACTICE_AREAS.map((area) => [area.id, area.label]));

export function isPracticeArea(value: string | null | undefined): value is PracticeAreaId {
  return Boolean(value && AREA_LABEL.has(value as PracticeAreaId));
}

export function practiceAreaLabel(value: string | null | undefined): string {
  if (!value) return "this kind of";
  return AREA_LABEL.get(value as PracticeAreaId) ?? value;
}

/** Firms that take matters this office refers out. Personal-injury-only firms stay off this list. */
export function referralFirms<T extends { active: boolean; practice_areas: string[] }>(destinations: T[]): T[] {
  return destinations.filter(
    (destination) => destination.active && destination.practice_areas.some((area) => area !== "personal_injury" && isPracticeArea(area)),
  );
}

export function referralFirmArea(destination: { practice_areas: string[] }, leadArea: string | null | undefined): PracticeAreaId | "" {
  if (leadArea && leadArea !== "personal_injury" && destination.practice_areas.includes(leadArea) && isPracticeArea(leadArea)) return leadArea;
  const match = destination.practice_areas.find((area) => area !== "personal_injury" && isPracticeArea(area));
  return match && isPracticeArea(match) ? match : "";
}

const REFERRAL_SMS_CLOSE = {
  en: "If you have any other questions, or if you need help with an injury in the future, please call us at (512) 764-3037.",
  es: "Si tiene alguna otra pregunta, o si en el futuro necesita ayuda con una lesión, llámenos al (512) 764-3037.",
} as const;

export const DEFAULT_REFERRAL_SMS = {
  en: `{{greeting}}, this is Ramos James Law. We are not able to help with {{area}}. Please contact {{attorney}} at {{phone}}. {{details}}\n\n${REFERRAL_SMS_CLOSE.en}`,
  es: `{{greeting}}, le habla Ramos James Law. No podemos ayudar con asuntos de {{area}}. Comuníquese con {{attorney}} al {{phone}}. {{details}}\n\n${REFERRAL_SMS_CLOSE.es}`,
} as const;

export type ReferralDestination = {
  id: string;
  name: string;
  phone: string | null;
  practice_areas: string[];
  address: string | null;
  email: string | null;
  website: string | null;
  spanish: boolean;
  matters: string | null;
  notes: string | null;
  active: boolean;
};

export function referralDetails(destination: Pick<ReferralDestination, "address" | "email" | "website">): string {
  return [destination.address, destination.website, destination.email].filter(Boolean).join(". ");
}

export function renderReferralSms(input: {
  language: "en" | "es";
  template: string;
  leadName: string | null;
  area: string;
  destination: Pick<ReferralDestination, "name" | "phone" | "address" | "email" | "website">;
}): string {
  const name = input.leadName?.trim().split(/\s+/)[0] || "";
  const greeting = input.language === "es" ? (name ? `Hola ${name}` : "Hola") : name ? `Hi ${name}` : "Hi";
  const details = referralDetails(input.destination);
  const area =
    input.area === "miscellaneous" ? (input.language === "es" ? "su caso" : "case") : practiceAreaLabel(input.area);
  const body = input.template
    .replaceAll("{{greeting}}", greeting)
    .replaceAll("{{name}}", name || (input.language === "es" ? "hola" : "there"))
    .replaceAll("{{area}}", area)
    .replaceAll("{{attorney}}", input.destination.name)
    .replaceAll("{{phone}}", input.destination.phone || "")
    .replaceAll("{{details}}", details)
    .replace(/[^\S\n]+\./g, ".")
    .replace(/[^\S\n]{2,}/g, " ")
    .replace(/[^\S\n]*\n[^\S\n]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const close = REFERRAL_SMS_CLOSE[input.language];
  if (body.includes(close)) return body;
  return `${body}\n\n${close}`;
}
