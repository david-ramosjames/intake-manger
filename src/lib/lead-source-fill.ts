import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalLeadSource, isSourceType, leadSourceFromText } from "@/lib/leads";

type SourceLead = {
  id: string;
  lead_source: string | null;
  source_type: string | null;
  summary?: string | null;
  case_detail?: string | null;
  source_note?: string | null;
};

function chosenType(lead: SourceLead, inferred: string): string | null {
  if (isSourceType(lead.source_type)) return lead.source_type;
  return inferred || null;
}

async function saveSource(
  supabase: SupabaseClient,
  lead: SourceLead,
  source: string,
  type: string | null,
): Promise<boolean> {
  if (lead.lead_source === source && lead.source_type === type) return false;
  const { error } = await supabase.from("leads").update({ lead_source: source, source_type: type }).eq("id", lead.id);
  if (error) return false;
  lead.lead_source = source;
  lead.source_type = type;
  return true;
}

/** Fill a blank lead source from the Slack post or the Quo transcript, and set the matching bucket. */
export async function fillLeadSources(supabase: SupabaseClient, leads: SourceLead[]): Promise<number> {
  const needText: SourceLead[] = [];
  let filled = 0;
  for (const lead of leads) {
    const current = canonicalLeadSource(lead.lead_source);
    if (current.type) {
      if (await saveSource(supabase, lead, current.source, chosenType(lead, current.type))) filled += 1;
      continue;
    }
    if (current.source) continue;
    const local = leadSourceFromText([lead.summary, lead.case_detail, lead.source_note].filter(Boolean).join("\n"));
    if (local) {
      if (await saveSource(supabase, lead, local.source, chosenType(lead, local.type))) filled += 1;
      continue;
    }
    needText.push(lead);
  }
  const lookup = needText.slice(0, 80);
  if (!lookup.length) return filled;

  const ids = lookup.map((lead) => lead.id);
  const first = await supabase
    .from("intake_interactions")
    .select("lead_id, content, transcript")
    .in("lead_id", ids)
    .order("occurred_at", { ascending: false })
    .limit(400);
  const touches = first.error
    ? (
        await supabase
          .from("intake_interactions")
          .select("lead_id, content")
          .in("lead_id", ids)
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
    const found = leadSourceFromText((textByLead.get(lead.id) ?? []).join("\n"));
    if (!found) continue;
    if (await saveSource(supabase, lead, found.source, chosenType(lead, found.type))) filled += 1;
  }
  return filled;
}

/** Look through recent leads that still have no source. */
export async function fillOutstandingLeadSources(supabase: SupabaseClient): Promise<number> {
  const columns = "id, lead_source, source_type, summary, case_detail, source_note";
  const [{ data: blank }, { data: messy }] = await Promise.all([
    supabase.from("leads").select(columns).is("lead_source", null).order("lead_date", { ascending: false, nullsFirst: false }).limit(80),
    supabase.from("leads").select(columns).ilike("lead_source", "%/%").limit(40),
  ]);
  const seen = new Set<string>();
  const leads = [...((blank ?? []) as SourceLead[]), ...((messy ?? []) as SourceLead[])].filter((lead) => {
    if (seen.has(lead.id)) return false;
    seen.add(lead.id);
    return true;
  });
  return fillLeadSources(supabase, leads);
}
