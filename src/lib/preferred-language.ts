/** Staff-selected preferred_language is authoritative. Auto-fill only when blank. */

export type PreferredLanguage = "en" | "es";

const SPANISH_WORDS = [
  "hola", "gracias", "por favor", "buenos", "buenas", "días", "tardes", "noches",
  "cómo", "está", "estoy", "llamar", "llamando", "accidente", "abogado", "número",
  "necesito", "ayuda", "puede", "quiero", "tiene", "cuando", "donde", "porque",
  "también", "pero", "para", "como", "desde", "sobre", "entre", "después",
  "antes", "aquí", "ahora", "muy", "más", "menos", "mejor", "usted",
  "nosotros", "ellos", "mensaje", "teléfono", "oficina", "caso",
];

/** Quo answered calls under this length are often VMs / hangups — skip spoken-language inference. */
export const LANGUAGE_CALL_MIN_SECONDS = 60;

export function isSpanishText(text: string | null | undefined): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  if (/[áéíóúñ¿¡ü]/.test(lower)) return true;
  return SPANISH_WORDS.filter((word) => lower.includes(word)).length >= 2;
}

export function languageFromLabeledField(text: string | null | undefined): PreferredLanguage | null {
  const raw = text?.match(/(?:^|\n)\s*>?\s*\*?\s*Language\s*:?\s*\*?\s*([^\n*]+)/i)?.[1]?.trim() ?? "";
  if (!raw) return null;
  if (/^(spanish|español|espanol)\b/i.test(raw)) return "es";
  if (/^(english|inglés|ingles)\b/i.test(raw)) return "en";
  return null;
}

/** Meta / TikTok / webchat / Intake Engine form copy (Spanish vs English question wording). */
export function languageFromFormCopy(text: string | null | undefined): PreferredLanguage | null {
  const body = text ?? "";
  if (!body.trim()) return null;
  const labeled = languageFromLabeledField(body);
  if (labeled) return labeled;

  const spanishForm =
    /¿(?:qu[eé]|su|usted|tiene|quiere|cu[aá]ndo)|tipo de accidente|c[oó]mo se enter[oó]|referido por|accidente en el trabajo|workers'?\s*comp\?/i.test(
      body,
    );
  const englishForm =
    /what type of accident|were you responsible|when did the accident occur|were you injured|want a referral|does your employer have/i.test(
      body,
    );
  if (spanishForm && !englishForm) return "es";
  if (englishForm && !spanishForm) return "en";
  if (spanishForm) return "es";
  return null;
}

/** CallRail tracker line, e.g. "Google Call Ads - ATX ES" or "Website Pool". */
export function languageFromCallrailTracker(tracker: string | null | undefined): PreferredLanguage | null {
  const name = String(tracker || "").replace(/\s+/g, " ").trim();
  if (!name) return null;
  if (!/call\s*ads?/i.test(name)) return null;
  if (/(?:^|[\s\-_/(])ES(?:$|[\s\-_)/])/i.test(name) || /\bESPA[NÑ]OL\b/i.test(name)) return "es";
  if (/(?:^|[\s\-_/(])EN(?:$|[\s\-_)/])/i.test(name) || /\bENGLISH\b/i.test(name)) return "en";
  return null;
}

export function callrailTrackerName(text: string | null | undefined): string | null {
  const match = text?.match(/To:\s*\*(?:<[^|>]*\|)?\s*([^*<>\n]+?)\s*>?\s*\*/i);
  const name = match?.[1]?.replace(/\s+/g, " ").trim();
  if (!name || name.length > 80) return null;
  return name;
}

/** Campaign labels such as "RGV - PI ES", "ATX - PI EN", "ATX-PI-ES", "Form Leads - ES 4". */
export function languageFromCampaignLabel(value: string | null | undefined): PreferredLanguage | null {
  const label = String(value || "").replace(/\s+/g, " ").trim();
  if (!label) return null;
  if (/\bESPA[NÑ]OL\b/i.test(label) && !/\bENGLISH\b/i.test(label)) return "es";
  if (/\bSPANISH\b/i.test(label) && !/\bENGLISH\b/i.test(label)) return "es";
  if (/\bENGLISH\b/i.test(label) && !/\b(?:ESPA[NÑ]OL|SPANISH)\b/i.test(label)) return "en";
  const spanish = /(?:^|[\s\-_/(])es(?:$|[\s\-_/)])/i.test(label);
  const english = /(?:^|[\s\-_/(])en(?:$|[\s\-_/)])/i.test(label);
  if (spanish && !english) return "es";
  if (english && !spanish) return "en";
  return null;
}

function languageFromQuery(query: string): PreferredLanguage | null {
  const params = new URLSearchParams(query.replace(/&amp;/gi, "&"));
  for (const key of ["lang", "hl", "locale", "language"]) {
    const value = (params.get(key) || "").trim().toLowerCase();
    if (value.startsWith("es")) return "es";
    if (value.startsWith("en")) return "en";
  }
  return languageFromCampaignLabel(params.get("utm_campaign") || params.get("campaign"));
}

function decodeTrackedUrl(href: string): string {
  const cleaned = href.replace(/&amp;/gi, "&").trim();
  if (!/%[0-9a-f]{2}/i.test(cleaned)) return cleaned;
  try {
    return decodeURIComponent(cleaned);
  } catch {
    return cleaned;
  }
}

function languageFromDecodedUrl(href: string): PreferredLanguage | null {
  const trimmed = href.trim();
  if (!trimmed) return null;
  const query = trimmed.split("?")[1]?.split("#")[0] ?? "";
  if (query) {
    const fromQuery = languageFromQuery(query);
    if (fromQuery) return fromQuery;
  }
  if (/\/es(?:\/|$|\?|#)/i.test(trimmed)) return "es";
  if (/\/en(?:\/|$|\?|#)/i.test(trimmed)) return "en";
  return null;
}

function languageFromOneUrl(href: string): PreferredLanguage | null {
  const cleaned = decodeTrackedUrl(href).replace(/\|.*$/, "").replace(/[)>,.]+$/g, "");
  return languageFromDecodedUrl(cleaned);
}

function cleanTrackedUrl(candidate: string): string {
  return candidate.replace(/&amp;/gi, "&").replace(/\|.*$/, "").replace(/[)>,.]+$/g, "");
}

export function languageFromLandingUrl(url: string | null | undefined): PreferredLanguage | null {
  const href = String(url || "").trim();
  if (!href) return null;
  const found = href.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  for (const candidate of found) {
    const language = languageFromOneUrl(cleanTrackedUrl(candidate));
    if (language) return language;
  }
  return languageFromOneUrl(href.replace(/&amp;/gi, "&"));
}

function languageFromParamBag(params: unknown): PreferredLanguage | null {
  if (!params || typeof params !== "object" || Array.isArray(params)) return null;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (typeof value === "string" || typeof value === "number") query.append(key, String(value));
  }
  const text = query.toString();
  if (!text) return null;
  return languageFromQuery(text);
}

type CallrailTouch = {
  landing?: string | null;
  campaign?: string | null;
  landing_page_url_params?: Record<string, unknown> | null;
  url_utm_params?: Record<string, unknown> | null;
};

function languageFromTouch(touch: CallrailTouch | null | undefined): PreferredLanguage | null {
  if (!touch) return null;
  return (
    languageFromLandingUrl(touch.landing) ||
    languageFromParamBag(touch.landing_page_url_params) ||
    languageFromParamBag(touch.url_utm_params) ||
    languageFromCampaignLabel(touch.campaign)
  );
}

/**
 * Website Pool calls (Bing, ChatGPT, and other session trackers) do not put EN/ES
 * on the tracker name. Language is on the landing page, its query params, or the campaign.
 */
export function languageFromCallrailCall(input: {
  trackingName?: string | null;
  landingPageUrl?: string | null;
  lastRequestedUrl?: string | null;
  campaign?: string | null;
  utmCampaign?: string | null;
  milestones?: unknown;
}): PreferredLanguage | null {
  const milestones =
    input.milestones && typeof input.milestones === "object"
      ? (input.milestones as Record<string, unknown>)
      : {};
  for (const key of ["first_touch", "lead_created"]) {
    const touch = milestones[key];
    const language = touch && typeof touch === "object" ? languageFromTouch(touch as CallrailTouch) : null;
    if (language) return language;
  }
  const fromLanding = languageFromLandingUrl(input.landingPageUrl) || languageFromLandingUrl(input.lastRequestedUrl);
  if (fromLanding) return fromLanding;
  const fromCampaign = languageFromCampaignLabel(input.utmCampaign) || languageFromCampaignLabel(input.campaign);
  if (fromCampaign) return fromCampaign;
  for (const key of ["last_touch", "qualified"]) {
    const touch = milestones[key];
    const language = touch && typeof touch === "object" ? languageFromTouch(touch as CallrailTouch) : null;
    if (language) return language;
  }
  return languageFromCallrailTracker(input.trackingName);
}

/** Page views are newest-first. The oldest page is the landing page shown in CallRail. */
export function languageFromPageViews(views: unknown): PreferredLanguage | null {
  if (!Array.isArray(views)) return null;
  for (const view of [...views].reverse()) {
    if (!view || typeof view !== "object") continue;
    const row = view as { page_url?: unknown; referrer_url?: unknown };
    const language =
      languageFromLandingUrl(typeof row.page_url === "string" ? row.page_url : null) ||
      languageFromLandingUrl(typeof row.referrer_url === "string" ? row.referrer_url : null);
    if (language) return language;
  }
  return null;
}

export function languageFromCampaignLine(text: string | null | undefined): PreferredLanguage | null {
  if (!text) return null;
  for (const match of text.matchAll(/\bcampaign\s*:?\s*([^\n*]{1,80})/gi)) {
    const language = languageFromCampaignLabel(match[1]);
    if (language) return language;
  }
  return null;
}

/** Spoken Quo call: only when long enough to avoid random VMs. */
export function languageFromQuoCall(input: {
  summary?: string | null;
  transcript?: string | null;
  durationSeconds?: number | null;
}): PreferredLanguage | null {
  const duration = input.durationSeconds;
  if (duration != null && duration < LANGUAGE_CALL_MIN_SECONDS) return null;
  const spoken = [input.transcript, input.summary].filter(Boolean).join("\n").trim();
  if (spoken.length < 40) return null;
  return isSpanishText(spoken) ? "es" : "en";
}

/**
 * Priority:
 * 1) Quo call ≥60s
 * 2) Form / webchat / website form language
 * 3) CallRail Call Ad tracker EN/ES
 * 4) Landing page lang= / campaign ES|EN (Bing, ChatGPT, other Website Pool ads)
 */
export function inferPreferredLanguage(input: {
  text?: string | null;
  summary?: string | null;
  transcript?: string | null;
  durationSeconds?: number | null;
  landingPageUrl?: string | null;
  hasQuoCall?: boolean;
}): PreferredLanguage | null {
  const blob = [input.text, input.summary, input.transcript].filter(Boolean).join("\n");
  const fromQuo = languageFromQuoCall({
    summary: input.summary,
    transcript: input.transcript,
    durationSeconds: input.durationSeconds,
  });
  if (fromQuo && (input.hasQuoCall || input.durationSeconds != null)) return fromQuo;

  const fromForm = languageFromFormCopy(blob);
  if (fromForm) return fromForm;

  const tracker = callrailTrackerName(blob);
  const fromAd = languageFromCallrailTracker(tracker);
  if (fromAd) return fromAd;

  const fromLanding = languageFromLandingUrl(input.landingPageUrl) || languageFromLandingUrl(blob);
  if (fromLanding) return fromLanding;

  const fromCampaign = languageFromCampaignLine(blob);
  if (fromCampaign) return fromCampaign;

  // Website Pool with no landing URL yet — do not guess from short CallRail alerts.
  return null;
}
