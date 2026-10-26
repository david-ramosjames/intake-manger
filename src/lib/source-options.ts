/**
 * Cascading source options: Type -> Category -> Source
 */

export type SourceType = "Marketing" | "Referral" | "Repeat";

export type SourceCategory = 
  // Marketing categories
  | "AI"
  | "Direct"
  | "Directory"
  | "Lead Provider"
  | "Partner"
  | "Radio"
  | "Search"
  | "Social"
  | "TV"
  // Referral categories
  | "Community Org"
  | "Employee"
  | "Law Office"
  | "Medical Provider"
  | "Networking Group"
  | "Personal Referral"
  | "Referral Service"
  // Repeat category
  | "Repeat";

type SourceOption = {
  type: SourceType;
  category: SourceCategory;
  source: string;
};

export const SOURCE_OPTIONS: SourceOption[] = [
  // Marketing -> AI
  { type: "Marketing", category: "AI", source: "ChatGPT" },
  { type: "Marketing", category: "AI", source: "Other AI Search" },
  
  // Marketing -> Direct
  { type: "Marketing", category: "Direct", source: "Call" },
  { type: "Marketing", category: "Direct", source: "Email" },
  { type: "Marketing", category: "Direct", source: "Walk in" },
  
  // Marketing -> Directory
  { type: "Marketing", category: "Directory", source: "Avvo" },
  { type: "Marketing", category: "Directory", source: "Justia" },
  { type: "Marketing", category: "Directory", source: "Super Lawyers" },
  { type: "Marketing", category: "Directory", source: "TX Bar website" },
  { type: "Marketing", category: "Directory", source: "Yelp" },
  
  // Marketing -> Lead Provider
  { type: "Marketing", category: "Lead Provider", source: "Walker Advertising" },
  
  // Marketing -> Partner
  { type: "Marketing", category: "Partner", source: "Hispanos" },
  { type: "Marketing", category: "Partner", source: "Women of Austin" },
  
  // Marketing -> Radio
  { type: "Marketing", category: "Radio", source: "Radio" },
  
  // Marketing -> Search
  { type: "Marketing", category: "Search", source: "Apple Maps" },
  { type: "Marketing", category: "Search", source: "Bing / Microsoft Ads" },
  { type: "Marketing", category: "Search", source: "Google" },
  { type: "Marketing", category: "Search", source: "Google Form" },
  { type: "Marketing", category: "Search", source: "Google Maps" },
  { type: "Marketing", category: "Search", source: "Google My Business" },
  { type: "Marketing", category: "Search", source: "Local Services" },
  { type: "Marketing", category: "Search", source: "Unknown Search" },
  { type: "Marketing", category: "Search", source: "Website" },
  
  // Marketing -> Social
  { type: "Marketing", category: "Social", source: "Facebook" },
  { type: "Marketing", category: "Social", source: "Instagram" },
  { type: "Marketing", category: "Social", source: "Linkedin" },
  { type: "Marketing", category: "Social", source: "Meta Form" },
  { type: "Marketing", category: "Social", source: "Nextdoor" },
  { type: "Marketing", category: "Social", source: "Reddit" },
  { type: "Marketing", category: "Social", source: "Tiktok" },
  { type: "Marketing", category: "Social", source: "Whatsapp" },
  { type: "Marketing", category: "Social", source: "Youtube" },
  
  // Marketing -> TV
  { type: "Marketing", category: "TV", source: "TV" },
  
  // Referral -> Community Org
  { type: "Referral", category: "Community Org", source: "Ahmiga" },
  
  // Referral -> Employee
  { type: "Referral", category: "Employee", source: "To Be Entered" },
  
  // Referral -> Law Office
  { type: "Referral", category: "Law Office", source: "Amy Owen" },
  { type: "Referral", category: "Law Office", source: "Ardalan Law Firm" },
  { type: "Referral", category: "Law Office", source: "Cardenas Witt Law" },
  { type: "Referral", category: "Law Office", source: "Carlson Law Firm" },
  { type: "Referral", category: "Law Office", source: "Daniel Garcia" },
  { type: "Referral", category: "Law Office", source: "Darius Vaseghi" },
  { type: "Referral", category: "Law Office", source: "FVF" },
  { type: "Referral", category: "Law Office", source: "Haney Law" },
  { type: "Referral", category: "Law Office", source: "Iris Albizu" },
  { type: "Referral", category: "Law Office", source: "Jorge Vela" },
  { type: "Referral", category: "Law Office", source: "Kama Davis" },
  { type: "Referral", category: "Law Office", source: "Kathryn Johnson" },
  { type: "Referral", category: "Law Office", source: "Laura Martinez" },
  { type: "Referral", category: "Law Office", source: "Lincoln-Goldfinch Law" },
  { type: "Referral", category: "Law Office", source: "Newman Law" },
  { type: "Referral", category: "Law Office", source: "Ochoa Law Firm" },
  { type: "Referral", category: "Law Office", source: "Rachel McKenna" },
  { type: "Referral", category: "Law Office", source: "Redondo Law Firm" },
  { type: "Referral", category: "Law Office", source: "Rodriguez Law Firm" },
  { type: "Referral", category: "Law Office", source: "Theresa Golde" },
  { type: "Referral", category: "Law Office", source: "Unknown Law Firm" },
  
  // Referral -> Medical Provider
  { type: "Referral", category: "Medical Provider", source: "Other Medical Provider" },
  { type: "Referral", category: "Medical Provider", source: "ProCare" },
  
  // Referral -> Networking Group
  { type: "Referral", category: "Networking Group", source: "Latinas" },
  { type: "Referral", category: "Networking Group", source: "MAMAs" },
  { type: "Referral", category: "Networking Group", source: "Mexicanas en Austin" },
  { type: "Referral", category: "Networking Group", source: "Travis County Women Lawyers" },
  { type: "Referral", category: "Networking Group", source: "Women of Austin" },
  
  // Referral -> Personal Referral
  { type: "Referral", category: "Personal Referral", source: "Family Member" },
  { type: "Referral", category: "Personal Referral", source: "Friend" },
  { type: "Referral", category: "Personal Referral", source: "Prior Client" },
  { type: "Referral", category: "Personal Referral", source: "Word of Mouth (Unknown)" },
  
  // Referral -> Referral Service
  { type: "Referral", category: "Referral Service", source: "LRS" },
  
  // Repeat -> Repeat
  { type: "Repeat", category: "Repeat", source: "Repeat" },
];

export const SOURCE_TYPES: SourceType[] = ["Marketing", "Referral", "Repeat"];

export function getCategoriesForType(type: SourceType | null | undefined): SourceCategory[] {
  if (!type) return [];
  const categories = new Set<SourceCategory>();
  for (const option of SOURCE_OPTIONS) {
    if (option.type === type) {
      categories.add(option.category);
    }
  }
  return Array.from(categories).sort();
}

export function getSourcesForCategory(
  type: SourceType | null | undefined,
  category: SourceCategory | null | undefined
): string[] {
  if (!type || !category) return [];
  return SOURCE_OPTIONS
    .filter((option) => option.type === type && option.category === category)
    .map((option) => option.source)
    .sort();
}

const STORED_SOURCE_ALIASES: Record<string, string> = {
  bing: "Bing / Microsoft Ads",
  "microsoft ads": "Bing / Microsoft Ads",
  tiktok: "Tiktok",
  "tik tok": "Tiktok",
  youtube: "Youtube",
  whatsapp: "Whatsapp",
  "walk-in": "Walk in",
  "walk in": "Walk in",
  gmb: "Google My Business",
  "google my business": "Google My Business",
  linkedin: "Linkedin",
  "meta form": "Meta Form",
  "word of mouth": "Word of Mouth (Unknown)",
  "family member": "Family Member",
  family: "Family Member",
  "prior client": "Prior Client",
  "previous client": "Prior Client",
  "current client": "Prior Client",
  "returning client": "Prior Client",
};

export function findSourceOption(source: string | null | undefined): SourceOption | null {
  const key = (source ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!key) return null;
  const exact = SOURCE_OPTIONS.find((option) => option.source.toLowerCase() === key);
  if (exact) return exact;
  const alias = STORED_SOURCE_ALIASES[key];
  if (alias) return SOURCE_OPTIONS.find((option) => option.source === alias) ?? null;
  const prefixed = SOURCE_OPTIONS.filter((option) => {
    const name = option.source.toLowerCase();
    return name.startsWith(`${key} `) || name.startsWith(`${key}/`);
  });
  return prefixed.length === 1 ? prefixed[0] : null;
}

/** Keep a picked dropdown source. The older short names, like Bing, map back onto that list. */
export function leadSourceChoice(value: string | null | undefined): { source: string; type: SourceType | "" } {
  const option = findSourceOption(value);
  if (option) return { source: option.source, type: option.type };
  const trimmed = (value ?? "").trim().replace(/\s+/g, " ");
  return { source: trimmed, type: "" };
}

export function isSourceCategory(value: string | null | undefined): value is SourceCategory {
  if (!value) return false;
  return SOURCE_OPTIONS.some((option) => option.category === value);
}

export function isSourceType(value: string | null | undefined): value is SourceType {
  return value === "Marketing" || value === "Referral" || value === "Repeat";
}
