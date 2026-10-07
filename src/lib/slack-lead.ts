import { toE164 } from "./phone";
import type { LeadArrival, LeadKind } from "./leads";

export type ParsedSlackLead = {
  kind: LeadKind;
  arrival: LeadArrival;
  name: string | null;
  phone: string | null;
  phoneE164: string | null;
  email: string | null;
  handledBy: string | null;
  summary: string | null;
  quoLink: string | null;
  tags: string[];
  caseType: string | null;
};

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;

function field(text: string, label: string): string | null {
  const match = text.match(new RegExp(`^${label}:\\s*(.+)$`, "im"));
  return match?.[1]?.replace(/\*/g, "").trim() || null;
}

function phonesIn(text: string): string | null {
  const matches = text.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/g) ?? [];
  for (const match of matches) {
    if (toE164(match)) return match.trim();
  }
  return null;
}

export function parseSlackLead(text: string): ParsedSlackLead {
  const body = text.replace(/<([^|>]+)\|([^>]+)>/g, "$2 ($1)");
  const lower = body.toLowerCase();
  const handledBy = field(body, "Handled By");
  const from = field(body, "From");
  const summaryBlock = body.match(/summary:\s*([\s\S]*?)(?:\nlead:|\n<|$)/i)?.[1]?.trim() || null;
  const quo =
    body.match(/View in Quo \((https?:[^)\s]+)\)/i)?.[1] ??
    body.match(/https?:\/\/[^\s>|]*(?:quo|openphone)[^\s>|]*/i)?.[0] ??
    null;
  const tagLine = body.match(/^tags?:\s*(.+)$/im)?.[1] ?? "";
  const tags = tagLine
    .split(/[,|]/)
    .map((tag) => tag.trim())
    .filter(Boolean);

  let kind: LeadKind = "pursue";
  let arrival: LeadArrival = "form";
  if (/missed call|hung up at phone menu|voicemail/i.test(body)) {
    arrival = "missed";
  } else if (/sona/i.test(handledBy ?? "") || /sona call/i.test(lower)) {
    arrival = "sona";
  } else if (/qualified lead/i.test(body)) {
    arrival = "qualified_call";
  } else if (/\blead call\b/i.test(body)) {
    kind = "needs_info";
    arrival = "human_call";
  } else if (/human call completed/i.test(lower)) {
    arrival = "human_call";
    if (!/qualified/i.test(body)) kind = "needs_info";
  }

  const nameFrom = from?.replace(/\(.*\)/, "").replace(/<[^>]+>/g, "").trim() || null;
  const phone = phonesIn(from ?? "") ?? phonesIn(body);

  return {
    kind,
    arrival,
    name: nameFrom && !/^\+?\d/.test(nameFrom) ? nameFrom : null,
    phone,
    phoneE164: toE164(phone),
    email: body.match(EMAIL)?.[0] ?? null,
    handledBy,
    summary: summaryBlock ? summaryBlock.slice(0, 2000) : body.slice(0, 2000),
    quoLink: quo,
    tags,
    caseType: null,
  };
}

export function leadIsClosed(lead: {
  signed_case?: boolean | null;
  case_id?: string | null;
  lead_status?: string | null;
}): boolean {
  if (lead.signed_case || lead.case_id) return true;
  return lead.lead_status === "Lost" || lead.lead_status === "Referred" || lead.lead_status === "Promoted";
}
