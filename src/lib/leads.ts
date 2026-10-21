import { chicagoDay } from "@/lib/time";

export const LEAD_STATUSES = [
  "New",
  "Working",
  "Consultation",
  "Signed",
  "Promoted",
  "Lost",
  "Referred",
] as const;

export type LeadGrade = "A" | "B" | "C";
export type LeadSentiment = "positive" | "neutral" | "negative";
export type LeadKind = "pursue" | "needs_info";
export type LeadArrival = "form" | "missed" | "sona" | "human_call" | "qualified_call" | "manual";

export const LEAD_SENTIMENT_LABEL: Record<LeadSentiment, string> = {
  positive: "Positive",
  neutral: "Neutral",
  negative: "Negative",
};

export const LEAD_KIND_LABEL: Record<LeadKind, string> = {
  pursue: "Want to sign",
  needs_info: "Follow up Contact",
};

export const SOURCE_CHANNELS = ["Call", "Facebook", "Meta", "Web form", "Website", "WhatsApp"] as const;

export const SOURCE_TYPES = ["Marketing", "Referral", "Repeat", "Unknown"] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

/** Source types staff can pick. Unknown stays valid on older rows. */
export const SOURCE_TYPE_OPTIONS = ["Marketing", "Referral", "Repeat"] as const;

/** Specific lead sources staff should use. Source type is the bucket each one belongs to. */
export const LEAD_SOURCES: { source: string; type: SourceType }[] = [
  { source: "Attorney", type: "Referral" },
  { source: "Avvo", type: "Marketing" },
  { source: "Bing", type: "Marketing" },
  { source: "ChatGPT", type: "Marketing" },
  { source: "Client", type: "Referral" },
  { source: "Current client", type: "Repeat" },
  { source: "Direct", type: "Marketing" },
  { source: "Email", type: "Marketing" },
  { source: "Employee", type: "Referral" },
  { source: "Facebook", type: "Marketing" },
  { source: "Family", type: "Referral" },
  { source: "Friend", type: "Referral" },
  { source: "Google", type: "Marketing" },
  { source: "Google Maps", type: "Marketing" },
  { source: "Google My Business", type: "Marketing" },
  { source: "Instagram", type: "Marketing" },
  { source: "Internet", type: "Marketing" },
  { source: "Law firm", type: "Referral" },
  { source: "Meta", type: "Marketing" },
  { source: "Neighbor", type: "Referral" },
  { source: "Nextdoor", type: "Marketing" },
  { source: "Previous client", type: "Repeat" },
  { source: "Radio", type: "Marketing" },
  { source: "Reddit", type: "Marketing" },
  { source: "Repeat", type: "Repeat" },
  { source: "Returning client", type: "Repeat" },
  { source: "Social media", type: "Marketing" },
  { source: "Super Lawyers", type: "Marketing" },
  { source: "TikTok", type: "Marketing" },
  { source: "TV", type: "Marketing" },
  { source: "Walk-in", type: "Marketing" },
  { source: "Web chat", type: "Marketing" },
  { source: "Website", type: "Marketing" },
  { source: "WhatsApp", type: "Marketing" },
  { source: "Word of mouth", type: "Referral" },
  { source: "YouTube", type: "Marketing" },
];

const LEAD_SOURCE_ALIASES: Record<string, string> = {
  "google ads": "Google",
  "google lsa": "Google",
  "google organic": "Google",
  "google my business": "Google My Business",
  gmb: "Google My Business",
  maps: "Google Maps",
  "apple maps": "Google Maps",
  "local services": "Google",
  "local service ads": "Google",
  "meta form": "Meta",
  "meta lead": "Meta",
  "meta ads": "Meta",
  "facebook ads": "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  "google/tiktok": "TikTok",
  whatsapp: "WhatsApp",
  "walk in": "Walk-in",
  "walk-in": "Walk-in",
  "in person": "Walk-in",
  webchat: "Web chat",
  "web chat": "Web chat",
  chatgpt: "ChatGPT",
  "chat gpt": "ChatGPT",
  "chat gbt": "ChatGPT",
  "al search": "ChatGPT",
  ai: "ChatGPT",
  website: "Website",
  webite: "Website",
  "website lead": "Website",
  tv: "TV",
  radio: "Radio",
  youtube: "YouTube",
  bing: "Bing",
  nextdoor: "Nextdoor",
  reddit: "Reddit",
  email: "Email",
  avvo: "Avvo",
  internet: "Internet",
  "internet search": "Internet",
  "social media": "Social media",
  "social med": "Social media",
  direct: "Direct",
  friend: "Friend",
  family: "Family",
  attorney: "Attorney",
  "law firm": "Law firm",
  "lawyer referral": "Attorney",
  "word of mouth": "Word of mouth",
  recommendation: "Word of mouth",
  recomended: "Word of mouth",
  recommended: "Word of mouth",
  neighbor: "Neighbor",
  employee: "Employee",
  client: "Client",
  "client referral": "Client",
  repeat: "Repeat",
  "current client": "Current client",
  "existing client": "Current client",
  "previous client": "Previous client",
  "prior client": "Previous client",
  "former client": "Previous client",
  "returning client": "Returning client",
  "return client": "Returning client",
  unknown: "Unknown",
  "n/a": "Unknown",
  na: "Unknown",
};

export function isSourceType(value: string | null | undefined): value is SourceType {
  return SOURCE_TYPES.includes(value as SourceType);
}

/** Lead sources for one source type. Marketing, Referral, and Repeat each have their own list. */
export function leadSourcesFor(type: string | null | undefined): string[] {
  if (!isSourceType(type) || type === "Unknown") return [];
  return LEAD_SOURCES.filter((item) => item.type === type).map((item) => item.source);
}

function canonicalizeLeadSource(trimmed: string): { source: string; type: SourceType | "" } {
  const key = trimmed.toLowerCase();
  const aliased = LEAD_SOURCE_ALIASES[key];
  const source = aliased ?? LEAD_SOURCES.find((item) => item.source.toLowerCase() === key)?.source ?? trimmed;
  const known = LEAD_SOURCES.find((item) => item.source.toLowerCase() === source.toLowerCase());
  return { source: known?.source ?? source, type: known?.type ?? "" };
}

export function canonicalLeadSource(value: string | null | undefined): { source: string; type: SourceType | "" } {
  const trimmed = (value ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed) return { source: "", type: "" };
  const direct = canonicalizeLeadSource(trimmed);
  if (direct.type || !trimmed.includes("/")) return direct;
  for (const part of trimmed.split("/")) {
    const hit = canonicalizeLeadSource(part.trim());
    if (hit.type) return hit;
  }
  return direct;
}

const SOURCE_SNIPPETS = [
  /(?:^|\n)\s*(?:[•\-*]\s*)*\*?\s*(?:lead\s*source|source)\s*\*?\s*:?\s*\*?\s*([^\n]+)/gi,
  /how (?:did|have) you hear(?: about (?:us|ramos(?: james)?))?[^?\n]*\??\s*([^\n]{0,180})/gi,
  /where did you (?:hear|find)[^?\n]*\??\s*([^\n]{0,180})/gi,
  /who referred you[^?\n]*\??\s*([^\n]{0,180})/gi,
  /c[oó]mo (?:se|te) enter[oó][^?\n]*\??\s*([^\n]{0,180})/gi,
  /qui[eé]n (?:lo|la|te) refiri[oó][^?\n]*\??\s*([^\n]{0,180})/gi,
  /(?:found|heard about|saw) (?:us|you|ramos)[^\n]{0,120}/gi,
  /referred by[^\n]{0,80}/gi,
  /referid[oa] por[^\n]{0,80}/gi,
  /(?:friend|family|attorney|client)\s+referral/gi,
];

const SOURCE_PHRASES: { pattern: RegExp; source: string }[] = [
  { pattern: /google\s+my\s+business|\bgmb\b/i, source: "Google My Business" },
  { pattern: /google\s+maps|\bapple\s+maps\b/i, source: "Google Maps" },
  { pattern: /google/i, source: "Google" },
  { pattern: /facebook/i, source: "Facebook" },
  { pattern: /instagram/i, source: "Instagram" },
  { pattern: /tik\s*tok/i, source: "TikTok" },
  { pattern: /whats\s*app/i, source: "WhatsApp" },
  { pattern: /\bmeta\b/i, source: "Meta" },
  { pattern: /youtube/i, source: "YouTube" },
  { pattern: /nextdoor/i, source: "Nextdoor" },
  { pattern: /chatgpt|chat\s*gpt/i, source: "ChatGPT" },
  { pattern: /\bavvo\b/i, source: "Avvo" },
  { pattern: /super\s+lawyers/i, source: "Super Lawyers" },
  { pattern: /\breddit\b/i, source: "Reddit" },
  { pattern: /\bbing\b/i, source: "Bing" },
  { pattern: /\bradio\b/i, source: "Radio" },
  { pattern: /\btv\b/i, source: "TV" },
  { pattern: /walk[\s-]?in|in person/i, source: "Walk-in" },
  { pattern: /web\s*chat/i, source: "Web chat" },
  { pattern: /previous client|prior client|former client/i, source: "Previous client" },
  { pattern: /returning client|return(?:ing)? client|called before/i, source: "Returning client" },
  { pattern: /current client|existing client/i, source: "Current client" },
  { pattern: /word of mouth/i, source: "Word of mouth" },
  { pattern: /\bfriend\b/i, source: "Friend" },
  { pattern: /family member|\bfamily\b/i, source: "Family" },
  { pattern: /\battorney\b|\blawyer\b|\blaw firm\b|\babogad[oa]\b/i, source: "Attorney" },
  { pattern: /\bneighbor\b|\bneighbour\b|\bvecin[oa]\b/i, source: "Neighbor" },
  { pattern: /\bemployee\b/i, source: "Employee" },
  { pattern: /\bclient\b|\bcliente\b/i, source: "Client" },
  { pattern: /\bamig[oa]\b/i, source: "Friend" },
  { pattern: /\bfamilia\b/i, source: "Family" },
];

function sourceByName(name: string): { source: string; type: SourceType } | null {
  const known = LEAD_SOURCES.find((item) => item.source === name);
  return known ? { source: known.source, type: known.type } : null;
}

function sourceInSnippet(snippet: string, labeled: boolean): { source: string; type: SourceType | "" } | null {
  const cleaned = snippet.replace(/\*/g, "").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  if (labeled && /^(other|n\/a|na|none|unknown|-|null)$/i.test(cleaned)) return sourceByName("Unknown");
  const direct = canonicalLeadSource(cleaned);
  if (direct.type) return { source: direct.source, type: direct.type };
  if (/family law/i.test(cleaned)) return null;
  for (const phrase of SOURCE_PHRASES) {
    if (phrase.pattern.test(cleaned)) return sourceByName(phrase.source);
  }
  if (!labeled) return null;
  const named = cleaned.replace(/[·|].*$/, "").trim();
  if (!named || named.length > 80 || named.split(/\s+/).length > 6 || /[.?!]/.test(named)) return null;
  return { source: named, type: "" };
}

/** Read a Slack post or Quo transcript for where the lead came from. */
export function leadSourceFromText(text: string | null | undefined): { source: string; type: SourceType | "" } | null {
  const body = text?.trim() ?? "";
  if (!body) return null;
  let labeled = true;
  for (const pattern of SOURCE_SNIPPETS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(body);
    while (match) {
      const found = sourceInSnippet(match[1] || match[0], labeled);
      if (found) return found;
      match = pattern.exec(body);
    }
    labeled = false;
  }
  return null;
}

export const PI_CASE_TYPES = [
  "Non-PI Legal Matter",
  "Auto Accident",
  "Commercial / 18 Wheeler",
  "Dog Bite",
  "MedMal",
  "No Injuries / Property Damage",
  "Other Injury",
  "Pedestrian / Bicycle / Scooter",
  "Premises Liability",
  "Sexual Assault / Child Abuse",
  "Work Injury",
  "Workers Comp",
  "Wrongful Death",
] as const;

const CASE_TYPE_ALIASES: Record<string, (typeof PI_CASE_TYPES)[number]> = {
  "dog bite": "Dog Bite",
  "car accident": "Auto Accident",
  "auto accident": "Auto Accident",
  motorcycle: "Auto Accident",
  "truck accident": "Commercial / 18 Wheeler",
  "18 wheeler": "Commercial / 18 Wheeler",
  "18-wheeler": "Commercial / 18 Wheeler",
  pedestrian: "Pedestrian / Bicycle / Scooter",
  "slip and fall": "Premises Liability",
  premises: "Premises Liability",
  assault: "Other Injury",
  "work accident": "Work Injury",
  "work injury": "Work Injury",
  "workers comp": "Workers Comp",
  "workers compensation": "Workers Comp",
  "wrongful death": "Wrongful Death",
  "medical malpractice": "MedMal",
  medmal: "MedMal",
  other: "Other Injury",
  "other injury": "Other Injury",
  "non-pi legal matter": "Non-PI Legal Matter",
  "non pi legal matter": "Non-PI Legal Matter",
  "child abuse": "Sexual Assault / Child Abuse",
  "sexual assault": "Sexual Assault / Child Abuse",
  "sexualassault / child abuse": "Sexual Assault / Child Abuse",
};

const OUTSIDE_CASE_TYPES = new Set<string>(["Non-PI Legal Matter", "Unknown / No Response"]);

export const LEAD_ARRIVAL_LABEL: Record<LeadArrival, string> = {
  form: "Form",
  missed: "Missed call",
  sona: "Sona",
  human_call: "Human call",
  qualified_call: "Qualified call",
  manual: "Added by hand",
};

export type Lead = {
  id: string;
  lead_date: string | null;
  lead_name: string | null;
  phone: string | null;
  phone_e164: string | null;
  email: string | null;
  lead_source: string | null;
  source_type: string | null;
  source_channel: string | null;
  source_note: string | null;
  case_type: string | null;
  case_detail: string | null;
  lead_status: string;
  consultation: string | null;
  consultation_date: string | null;
  desired_case: boolean | null;
  desired_source: "staff" | "contract" | null;
  signed_case: boolean;
  case_number: string | null;
  date_signed: string | null;
  grade: LeadGrade | null;
  grade_reason: string | null;
  grade_source: string | null;
  sentiment: LeadSentiment | null;
  sentiment_reason: string | null;
  sentiment_source: string | null;
  qualified: boolean | null;
  quo_link: string | null;
  intake_call_id: string | null;
  callrail_call_id: string | null;
  case_id: string | null;
  slack_permalink: string | null;
  summary: string | null;
  owner_name: string | null;
  kind: LeadKind;
  sequence: string | null;
  arrival: LeadArrival | null;
  callrail_tags: string[];
  decline_reason: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  follow_up: boolean;
  needs_verification: boolean;
  identity_status: "ok" | "needs_review" | "confirmed";
  identity_evidence: string | null;
  close_reason: "signed" | "declined" | "referred" | "not_interested" | "no_response" | "not_a_lead" | "outside_practice" | null;
  close_suggestion: "decline" | "not_interested" | "not_a_lead" | null;
  caller_class: string | null;
  practice_area: string | null;
  referral_opportunity: boolean;
  agreement_status: string | null;
  agreement_sent_at: string | null;
  agreement_last_reminder_at: string | null;
  agreement_next_reminder_at: string | null;
  agreement_reminder_count: number | null;
  agreement_signing_url: string | null;
  agreement_via_sms: boolean | null;
  agreement_via_email: boolean | null;
  text_sequence_slug: string | null;
  text_sequence_status: string | null;
  text_next_at: string | null;
  priority: boolean;
  priority_reason: string | null;
  priority_suggestion: string | null;
  priority_suggestion_dismissed: boolean;
  last_action: string | null;
  next_action: string | null;
  slack_channel_id: string | null;
  slack_thread_ts: string | null;
  slack_message_ts: string | null;
  signed_at: string | null;
  form_fill_closed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type LeadEvent = {
  id: string;
  lead_id: string;
  event_type: string;
  actor: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export type LeadView = "all" | "open" | "signed" | "promoted" | "pursue" | "needs_info" | "verify";

export const PRIORITY_REASONS = ["contract_out", "send_contract", "high_potential"] as const;
export type PriorityReason = (typeof PRIORITY_REASONS)[number];

export const PRIORITY_REASON_LABEL: Record<PriorityReason, string> = {
  contract_out: "Contract sent, not signed",
  send_contract: "Ready to send the contract",
  high_potential: "High potential, need to talk",
};

export const PRIORITY_REASON_SHORT: Record<PriorityReason, string> = {
  contract_out: "Contract out",
  send_contract: "Send contract",
  high_potential: "Need to talk",
};

export function isPriorityReason(value: string | null | undefined): value is PriorityReason {
  return value === "contract_out" || value === "send_contract" || value === "high_potential";
}

export function priorityReasonText(value: string | null | undefined): string | null {
  if (!value) return null;
  if (isPriorityReason(value)) return PRIORITY_REASON_LABEL[value];
  return value;
}

export function daysOpen(start: string | null, closedOn: string | null): number | null {
  const from = dayStamp(start);
  if (from == null) return null;
  const end = closedOn ? dayStamp(closedOn) : todayStamp();
  if (end == null) return null;
  return Math.max(0, Math.round((end - from) / 86_400_000));
}

/** Days since the lead first arrived. A date-only value is that calendar day. A timestamp uses Chicago. */
export function daysSince(value: string | null | undefined): number | null {
  if (!value) return null;
  const day = value.trim().length <= 10 ? value.slice(0, 10) : chicagoDay(value);
  const from = dayStamp(day);
  const today = dayStamp(chicagoDay(new Date()));
  if (from == null || today == null) return null;
  return Math.max(0, Math.round((today - from) / 86_400_000));
}

function dayStamp(value: string | null): number | null {
  if (!value) return null;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  return Date.UTC(year, month - 1, day);
}

function todayStamp(): number {
  const now = new Date();
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

export function slackMessageUrl(lead: {
  slack_permalink: string | null;
  slack_channel_id: string | null;
  slack_message_ts: string | null;
  slack_thread_ts: string | null;
}): string | null {
  if (lead.slack_permalink) return lead.slack_permalink;
  const channel = lead.slack_channel_id;
  const ts = lead.slack_message_ts || lead.slack_thread_ts;
  if (!channel || !ts) return null;
  // A bare slack.com link opens whichever workspace is active. These posts are in Ramos James.
  return `https://ramosjames.slack.com/archives/${channel}/p${ts.replace(".", "")}`;
}

const EMPTY_FACT = /^(other|n\/a|na|none|unknown|yes|no|-|null|undefined)$/i;

function cleanFact(value: string): string {
  return value
    .replace(/<[^|>]*\|([^>]+)>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function usableFact(value: string | null | undefined): string | null {
  const text = cleanFact(value ?? "");
  if (!text || EMPTY_FACT.test(text)) return null;
  return text;
}

function labeledAnswer(text: string, label: string): string | null {
  const pattern = new RegExp(
    `(?:^|\\n)\\s*(?:[•\\-*]\\s*)*\\*?\\s*(?:${label})\\s*:?\\s*\\*?\\s*:?\\s*([^\\n]+)`,
    "i",
  );
  return usableFact(text.match(pattern)?.[1]);
}

function prettySource(raw: string): string {
  return raw
    .split("/")
    .map((part) => {
      const token = part.trim();
      if (/^cpc$/i.test(token)) return "cpc";
      if (/^(gmb|cpm|seo)$/i.test(token)) return token.toUpperCase();
      return token.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
    })
    .join(" / ");
}

export function webLeadFacts(text: string | null | undefined): {
  name: string | null;
  accident: string | null;
  source: string | null;
} {
  const body = text ?? "";
  const heading = body.match(
    /(?:^|\n)\*((?!New lead|Contract path|More details|Details)[A-Z][A-Za-z.'’\-]+(?:\s+[A-Z][A-Za-z.'’\-]+){1,3})\*\s*(?=\n|$)/,
  )?.[1];
  const sourceRaw = body.match(/(?:^|\n)Source:\s*([^·\n]+)/i)?.[1] ?? "";
  return {
    name: labeledAnswer(body, "full name|client name|name") ?? usableFact(heading),
    accident: accidentAnswer(body),
    source: usableFact(sourceRaw) ? prettySource(usableFact(sourceRaw) as string) : null,
  };
}

function callrailTracker(text: string): string | null {
  const match = text.match(/To:\s*\*(?:<[^|>]*\|)?\s*([^*<>\n]+?)\s*>?\s*\*/i);
  const name = match?.[1]?.replace(/\s+/g, " ").trim();
  if (!name || name.length > 80) return null;
  return name;
}

export function listChannel(lead: {
  source_channel: string | null;
  case_detail?: string | null;
}): string {
  const text = lead.case_detail ?? "";
  const web = webLeadFacts(text);
  if (web.source && /intake engine|new lead/i.test(text)) return "Landing page";
  if (/callrail\.com/i.test(text)) return callrailTracker(text) ?? "CallRail";
  if (/meta form/i.test(text)) return "Meta";
  if (/tiktok/i.test(text)) return "TikTok";
  if (/facebook lead/i.test(text)) return "Facebook";
  if (/whatsapp/i.test(text)) return "WhatsApp";
  if (/intake engine|new lead\s*·/i.test(text)) return "Landing page";
  return lead.source_channel || "—";
}

function accidentAnswer(text: string | null | undefined): string | null {
  for (const raw of (text ?? "").split("\n")) {
    const line = raw.trim();
    const answer = line.match(
      /^(?:[•\-*]\s*)*\*?\s*(?:(?:what|qu[eé])\s+type of accident|tipo de accidente|type of accident|case type)\s*\*?\s*(?:—|–|:)\s*\*?\s*([^*\n]+?)\s*\*?\s*$/i,
    )?.[1];
    const usable = usableAccident(answer);
    if (usable) return usable;
  }
  return null;
}

function usableAccident(value: string | null | undefined): string | null {
  const text = usableFact(value);
  if (!text || text.length > 40 || /^(otro|otra)$/i.test(text)) return null;
  if (/[?•—–|]|when did|were you|responsible for|did the accident occur/i.test(text)) return null;
  return text;
}

function narrativeCaseType(text: string | null | undefined): string | null {
  const body = text ?? "";
  if (/\b(?:child abuse|sexual assault|molest)\b/i.test(body)) return "Sexual Assault / Child Abuse";
  if (/\bdog bite|bitten by (?:a |the )?(?:\w+ )?dog|attacked by (?:a |the )?(?:\w+ )?dogs?\b/i.test(body)) return "Dog Bite";
  if (/\bwrongful death\b/i.test(body)) return "Wrongful Death";
  if (/\b(?:medical malpractice|med\s*mal|surgical error)\b/i.test(body)) return "MedMal";
  if (/\bworkers?'?\s*comp(?:ensation)?\b/i.test(body)) return "Workers Comp";
  if (/\b(?:work(?:place)? (?:accident|injury)|injured at work)\b/i.test(body)) return "Work Injury";
  if (/\b(?:18-?\s*wheeler|tractor-?trailer|commercial truck|truck accident)\b/i.test(body)) return "Commercial / 18 Wheeler";
  if (/\b(?:pedestrian|bicycle|scooter)\b/i.test(body)) return "Pedestrian / Bicycle / Scooter";
  if (/\b(?:no injuries|property damage only)\b/i.test(body)) return "No Injuries / Property Damage";
  if (/\b(?:car accident|auto accident|rear-?ended|motorcycle|other driver|hit and run)\b/i.test(body)) return "Auto Accident";
  if (/\b(?:slip(?:ped)? and fall|premises liability|wet floor)\b/i.test(body)) return "Premises Liability";
  if (/\b(?:immigration|divorce|child support|criminal defense|family law)\b/i.test(body)) return "Non-PI Legal Matter";
  if (/\b(?:injur(?:y|ed|ies)|hurt)\b/i.test(body)) return "Other Injury";
  return null;
}

export function isPiCaseType(value: string | null | undefined): boolean {
  const official = officialCaseType(value);
  return Boolean(official && !OUTSIDE_CASE_TYPES.has(official));
}

export function officialCaseType(value: string | null | undefined): (typeof PI_CASE_TYPES)[number] | "Unknown / No Response" | null {
  const text = usableFact(value);
  if (!text) return null;
  if (text.toLowerCase() === "unknown / no response") return "Unknown / No Response";
  return CASE_TYPE_ALIASES[text.toLowerCase()] ?? PI_CASE_TYPES.find((item) => item.toLowerCase() === text.toLowerCase()) ?? null;
}

/** Case types for a dropdown. Non-PI stays first. Unknown is not offered. */
export function caseTypeChoices(current?: string | null): string[] {
  const choices: string[] = [...PI_CASE_TYPES];
  const extra = (current || "").trim();
  if (extra && extra !== "Unknown / No Response" && !choices.includes(extra)) choices.push(extra);
  return choices;
}

export function canonicalCaseType(value: string | null | undefined): string | null {
  return officialCaseType(value) ?? usableFact(value);
}

export function suggestedCaseType(lead: { case_type: string | null; case_detail?: string | null; summary?: string | null }): string {
  const stored = canonicalCaseType(lead.case_type);
  if (stored && stored.length <= 40) return stored;
  return narrativeCaseType(`${lead.summary ?? ""}\n${lead.case_detail ?? ""}`) ?? "";
}

export function listAccident(lead: { case_type: string | null; case_detail?: string | null }): string {
  const stored = officialCaseType(lead.case_type) ?? usableAccident(lead.case_type);
  if (stored) return stored;
  const fromPost = webLeadFacts(lead.case_detail).accident;
  if (fromPost) return fromPost;
  const fromNarrative = narrativeCaseType(lead.case_detail);
  if (fromNarrative) return fromNarrative;
  const fromForm = lead.case_detail?.match(/\*?new lead\*?\s*·\s*([A-Za-z][A-Za-z -]{1,40}?)(?:\s+-|\s+\*|\n|$)/i)?.[1]?.trim();
  if (fromForm && !/^general$/i.test(fromForm)) return fromForm;
  return "—";
}

export function listDetail(lead: {
  lead_source: string | null;
  case_detail?: string | null;
}): string {
  const fromPost = webLeadFacts(lead.case_detail).source;
  if (fromPost) return fromPost;
  return usableFact(lead.lead_source) ?? "—";
}

function displayName(raw: string, phone: string | null): string {
  let name = raw
    .replace(/<[^|>]*\|([^>]+)>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s*\(returning lead\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length >= 10) {
    name = name.replace(new RegExp(`\\s*[-–—]?\\s*\\+?${digits}\\b`), " ").replace(/\s+/g, " ").trim();
  }
  return name.replace(/\s*[-–—]\s*$/, "").trim();
}

export function leadTitle(lead: {
  lead_name: string | null;
  phone: string | null;
  identity_status?: string | null;
  case_detail?: string | null;
}): string {
  const stored = lead.lead_name?.trim() ? displayName(lead.lead_name, lead.phone) : "";
  const name = usableFact(stored) ?? webLeadFacts(lead.case_detail).name;
  if (name) return name;
  return "Not captured";
}

export function isLeadView(value: string | undefined): value is LeadView {
  return (
    value === "all" ||
    value === "open" ||
    value === "signed" ||
    value === "promoted" ||
    value === "pursue" ||
    value === "needs_info" ||
    value === "verify"
  );
}

export const EMAIL_NOT_AVAILABLE = "N/A";

const EMAIL_UNAVAILABLE =
  /^(n\/a|n\.a\.?|na|none|not available|not avail\.?|no email|no e-?mail|unavailable|not provided|unknown|no)$/i;

/** Blank stays blank. Typed stand-ins for a missing email become N/A. */
export function standardLeadEmail(value: string | null | undefined): string | null {
  const text = (value ?? "").trim().replace(/\s+/g, " ");
  if (!text || /^(null|undefined|-)$/i.test(text)) return null;
  if (EMAIL_UNAVAILABLE.test(text)) return EMAIL_NOT_AVAILABLE;
  return text;
}

export function emailIsUnavailable(value: string | null | undefined): boolean {
  return standardLeadEmail(value) === EMAIL_NOT_AVAILABLE;
}

export function displayContact(value: string | null | undefined): string | null {
  return standardLeadEmail(value);
}
