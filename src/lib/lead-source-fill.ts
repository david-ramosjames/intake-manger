import type { SupabaseClient } from "@supabase/supabase-js";
import { attachCallrailSources } from "@/lib/callrail";
import { canonicalLeadSource, isSourceType, leadSourceFromText } from "@/lib/leads";

type SourceLead = {
  id: string;
  lead_source: string | null;
  source_type: string | null;
  summary?: string | null;
  case_detail?: string | null;
  source_note?: string | null;
  lead_date?: string | null;
  created_at?: string;
  callrail_call_id?: string | null;
};

/** Keep a staff-chosen type. Otherwise use the type that belongs to the source. */
function chosenType(lead: SourceLead, inferred: string): string | null {
  if (isSourceType(lead.source_type) && lead.source_type !== "Unknown") return lead.source_type;
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
    if (current.source) {
      // Normalize a known source and fill a blank source type. Do not overwrite a staff type.
      if (await saveSource(supabase, lead, current.source, chosenType(lead, current.type))) filled += 1;
      continue;
    }
    const local = leadSourceFromText([lead.summary, lead.case_detail, lead.source_note].filter(Boolean).join("\n"));
    if (local?.source) {
      if (await saveSource(supabase, lead, local.source, chosenType(lead, local.type))) filled += 1;
      continue;
    }
    needText.push(lead);
  }
  const lookup = needText.slice(0, 80);
  if (lookup.length) {
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
      if (!found?.source) continue;
      if (await saveSource(supabase, lead, found.source, chosenType(lead, found.type))) filled += 1;
    }
  }

  const stillBlank = leads.filter((lead) => !lead.lead_source?.trim());
  if (stillBlank.length) {
    filled += await attachCallrailSources(
      stillBlank.map((lead) => ({
        id: lead.id,
        lead_source: lead.lead_source,
        lead_date: lead.lead_date ?? null,
        created_at: lead.created_at ?? new Date().toISOString(),
        case_detail: lead.case_detail ?? null,
        callrail_call_id: lead.callrail_call_id ?? null,
      })),
      async (id, source, type) => {
        const lead = stillBlank.find((row) => row.id === id);
        if (!lead) return;
        await saveSource(supabase, lead, source, chosenType(lead, type || ""));
      },
    );
  }
  return filled;
}

/** Look through recent leads that still have no source, or a source with no type. */
export async function fillOutstandingLeadSources(supabase: SupabaseClient): Promise<number> {
  const columns = "id, lead_source, source_type, summary, case_detail, source_note, lead_date, created_at, callrail_call_id";
  const [{ data: blank }, { data: messy }, { data: typeless }, { data: callrail }] = await Promise.all([
    supabase.from("leads").select(columns).is("lead_source", null).order("lead_date", { ascending: false, nullsFirst: false }).limit(80),
    supabase.from("leads").select(columns).ilike("lead_source", "%/%").limit(40),
    supabase
      .from("leads")
      .select(columns)
      .not("lead_source", "is", null)
      .is("source_type", null)
      .order("lead_date", { ascending: false, nullsFirst: false })
      .limit(80),
    supabase
      .from("leads")
      .select(columns)
      .is("lead_source", null)
      .or("callrail_call_id.not.is.null,case_detail.ilike.%callrail.com%")
      .order("lead_date", { ascending: false, nullsFirst: false })
      .limit(40),
  ]);
  const seen = new Set<string>();
  const leads = [
    ...((blank ?? []) as SourceLead[]),
    ...((messy ?? []) as SourceLead[]),
    ...((typeless ?? []) as SourceLead[]),
    ...((callrail ?? []) as SourceLead[]),
  ].filter((lead) => {
    if (seen.has(lead.id)) return false;
    seen.add(lead.id);
    return true;
  });
  return fillLeadSources(supabase, leads);
}
