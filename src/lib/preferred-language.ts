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

export function languageFromLandingUrl(url: string | null | undefined): PreferredLanguage | null {
  const href = String(url || "").trim();
  if (!href) return null;
  if (/[?&#](?:lang|hl|locale)=es(?:-|$|&|#)/i.test(href) || /\/es(?:\/|$|\?|#)/i.test(href)) return "es";
  if (/[?&#](?:lang|hl|locale)=en(?:-|$|&|#)/i.test(href) || /\/en(?:\/|$|\?|#)/i.test(href)) return "en";
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
 * 4) CallRail Website Pool landing page URL
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

  // Website Pool with no landing URL yet — do not guess from short CallRail alerts.
  return null;
}
