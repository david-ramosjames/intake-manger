import type { SupabaseClient } from "@supabase/supabase-js";
import { loadStaff, matchStaff, type StaffPerson } from "@/lib/identity";

const PLACEHOLDER = /^(sona|human|attorney(?:\s*\d+)?|legal assistant|referred|unassigned|intake|unknown|n\/a|na)$/i;
const FROM_RAMOS = /([A-Z][a-z'’-]{2,20}(?:\s+[A-Z][a-z'’-]{2,20})?)\s*,?\s+(?:from|with|de)\s+[Rr]amos/g;
const NICKNAMES: Record<string, string> = {
  valery: "valeria",
  valley: "valeria",
  steph: "stephany",
  gisele: "giselle",
  gisela: "giselle",
};
const THIS_IS = /\b(?:this is|i am|i'm|soy|le saluda|habla)\s+([A-Za-z][A-Za-z'’-]{1,20})(?:\s+([A-Za-z][A-Za-z'’-]{2,20}))?/gi;

type TalkLead = {
  id: string;
  owner_name: string | null;
  lead_name?: string | null;
  consultation_date?: string | null;
  summary?: string | null;
  case_detail?: string | null;
};

export function isPlaceholderOwner(name: string | null | undefined): boolean {
  const trimmed = name?.trim() ?? "";
  return !trimmed || PLACEHOLDER.test(trimmed);
}

function looseStaff(name: string, staff: StaffPerson[]): StaffPerson | null {
  const exact = matchStaff(name, staff);
  if (exact) return exact;
  const key = NICKNAMES[name.trim().toLowerCase()] ?? name.trim().toLowerCase().replace(/\s+/g, " ");
  if (key.length < 3) return null;
  const hits = staff.filter((person) => (person.name.split(/\s+/)[0] ?? "").toLowerCase() === key);
  return hits.length === 1 ? hits[0] : null;
}

/** Slack mention for a staff person, including a unique first name. */
export function slackMentionFor(name: string | null | undefined, staff: StaffPerson[]): string {
  const person = looseStaff(name ?? "", staff);
  return person?.slackUserId ? `<@${person.slackUserId}>` : "";
}

function samePerson(left: string, right: string): boolean {
  const a = left.trim().toLowerCase();
  const b = right.trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  const aFirst = a.split(/\s+/)[0] ?? "";
  const bFirst = b.split(/\s+/)[0] ?? "";
  return aFirst.length > 2 && (aFirst === b || bFirst === a);
}

function consider(
  raw: string,
  staff: StaffPerson[],
  found: { name: string; person: StaffPerson | null }[],
  skipName: string | null,
) {
  const cleaned = raw
    .replace(/[^A-Za-z'’\-\s]/g, " ")
    .replace(/\b(ramos|james|law|farm|firm)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || PLACEHOLDER.test(cleaned)) return;
  if (skipName && samePerson(cleaned, skipName)) return;
  const person = looseStaff(cleaned, staff);
  found.push({ name: person?.name ?? titleName(cleaned), person });
}

function titleName(value: string): string {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

/** The person who spoke with the client, from a Slack post or a Quo transcript. */
export function talkedWithFromText(
  text: string | null | undefined,
  staff: StaffPerson[],
  skipName?: string | null,
): { name: string; slackUserId: string | null } | null {
  const body = text ?? "";
  if (!body.trim()) return null;
  const found: { name: string; person: StaffPerson | null }[] = [];
  const client = skipName?.trim() || null;
  const handled = body.match(/Handled By:\s*([^\n]+)/i)?.[1]?.replace(/\*/g, "").trim();
  if (handled) consider(handled, staff, found, client);
  for (const match of body.matchAll(FROM_RAMOS)) consider(match[1] ?? "", staff, found, client);

  const lines = body.split(/\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const window = lines.slice(index, index + 4).join(" ");
    if (!/ramos/i.test(window)) continue;
    for (const intro of lines[index].matchAll(THIS_IS)) {
      const full = [intro[1], intro[2]].filter(Boolean).join(" ");
      consider(looseStaff(full, staff) ? full : (intro[1] ?? ""), staff, found, client);
    }
  }
  for (const line of lines) {
    if (/call due/i.test(line)) continue;
    for (const mention of line.matchAll(/<@(U[A-Z0-9]+)>/g)) {
      const person = staff.find((item) => item.slackUserId === mention[1]);
      if (person && !(client && samePerson(person.name, client))) found.push({ name: person.name, person });
    }
  }

  const staffHit = found.find((item) => item.person);
  if (staffHit?.person) return { name: staffHit.person.name, slackUserId: staffHit.person.slackUserId };
  const named = found.find((item) => item.name.split(/\s+/).length <= 3);
  return named ? { name: named.name, slackUserId: null } : null;
}

async function saveTalkedWith(supabase: SupabaseClient, lead: TalkLead, name: string): Promise<boolean> {
  if (lead.owner_name === name) return false;
  const { error } = await supabase.from("leads").update({ owner_name: name }).eq("id", lead.id);
  if (error) return false;
  lead.owner_name = name;
  const { data: jobs } = await supabase
    .from("lead_jobs")
    .select("id, assigned_name")
    .eq("lead_id", lead.id)
    .eq("queue", "call")
    .eq("status", "pending");
  const ids = ((jobs ?? []) as { id: string; assigned_name: string | null }[])
    .filter((job) => isPlaceholderOwner(job.assigned_name) || !job.assigned_name)
    .map((job) => job.id);
  if (ids.length) {
    await supabase.from("lead_jobs").update({ assigned_name: name, mention: null, detail: `Tag ${name}.` }).in("id", ids);
  }
  return true;
}

/** Fill who the client talked with on consultation leads that do not already name a staff person. */
export async function fillTalkedWith(supabase: SupabaseClient, leads: TalkLead[], staff?: StaffPerson[]): Promise<number> {
  const people = staff ?? (await loadStaff(supabase));
  const pending = leads.filter((lead) => lead.consultation_date && !matchStaff(lead.owner_name, people));
  let filled = 0;
  const needText: TalkLead[] = [];
  for (const lead of pending) {
    const local = talkedWithFromText([lead.summary, lead.case_detail].filter(Boolean).join("\n"), people, lead.lead_name);
    if (local?.slackUserId || (local && matchStaff(local.name, people))) {
      if (await saveTalkedWith(supabase, lead, local.name)) filled += 1;
      continue;
    }
    needText.push(lead);
  }
  const lookup = needText.slice(0, 80);
  if (!lookup.length) return filled;

  const first = await supabase
    .from("intake_interactions")
    .select("lead_id, content, transcript")
    .in("lead_id", lookup.map((lead) => lead.id))
    .order("occurred_at", { ascending: false })
    .limit(400);
  const touches = first.error
    ? (
        await supabase
          .from("intake_interactions")
          .select("lead_id, content")
          .in("lead_id", lookup.map((lead) => lead.id))
          .order("occurred_at", { ascending: false })
          .limit(400)
      ).data
    : first.data;
  const textByLead = new Map<string, string[]>();
  for (const touch of (touches ?? []) as { lead_id: string | null; content?: string | null; transcript?: string | null }[]) {
    if (!touch.lead_id) continue;
    const list = textByLead.get(touch.lead_id) ?? [];
    if (touch.content) list.push(touch.content);
    if (touch.transcript) list.push(touch.transcript);
    textByLead.set(touch.lead_id, list);
  }
  for (const lead of lookup) {
    const found = talkedWithFromText((textByLead.get(lead.id) ?? []).join("\n"), people, lead.lead_name);
    const name = found && (found.slackUserId || matchStaff(found.name, people)) ? found.name : found?.name;
    if (!name || isPlaceholderOwner(name)) continue;
    if (await saveTalkedWith(supabase, lead, name)) filled += 1;
  }
  return filled;
}

/** Recent consultations that still do not name a staff person. */
export async function fillOutstandingTalkedWith(supabase: SupabaseClient): Promise<number> {
  const staff = await loadStaff(supabase);
  const { data, error } = await supabase
    .from("leads")
    .select("id, owner_name, lead_name, consultation_date, summary, case_detail")
    .eq("test", false)
    .not("consultation_date", "is", null)
    .order("consultation_date", { ascending: false })
    .limit(120);
  if (error) throw new Error(error.message);
  const leads = ((data ?? []) as TalkLead[]).filter((lead) => !matchStaff(lead.owner_name, staff)).slice(0, 80);
  return fillTalkedWith(supabase, leads, staff);
}
