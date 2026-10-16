import { DataReview } from "@/components/DataReview";
import { fillLeadSources } from "@/lib/lead-source-fill";
import { toE164 } from "@/lib/phone";
import { reviewEditorName, toReviewLead, type ReviewSource } from "@/lib/review";
import { requireStaff } from "@/lib/session";
import { chicagoDay } from "@/lib/time";

const COLUMNS =
  "id, lead_name, phone, email, lead_source, source_type, source_channel, case_type, qualified, consultation, consultation_date, desired_case, desired_source, signed_case, lead_status, callrail_tags, caller_class, agreement_status, agreement_sent_at, lead_date, created_at, arrival, summary, case_detail, source_note, slack_permalink, slack_channel_id, slack_message_ts, slack_thread_ts";

const CONTACT_TYPES = ["call", "sona_call", "text", "voicemail"];
const CALL_ARRIVAL = new Set(["human_call", "qualified_call", "sona"]);

async function loadReviewLeads(supabase: Awaited<ReturnType<typeof requireStaff>>["supabase"]): Promise<ReviewSource[]> {
  const rows: ReviewSource[] = [];
  const size = 1000;
  for (let from = 0; from < 20000; from += size) {
    const { data, error } = await supabase
      .from("leads")
      .select(COLUMNS)
      .order("lead_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .range(from, from + size - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as ReviewSource[];
    rows.push(...batch);
    if (batch.length < size) break;
  }
  return rows;
}

function rememberEarliest(map: Map<string, string>, key: string, at: string) {
  const current = map.get(key);
  if (!current || at < current) map.set(key, at);
}

async function loadFirstContacts(
  supabase: Awaited<ReturnType<typeof requireStaff>>["supabase"],
): Promise<{ byLead: Map<string, string>; byPhone: Map<string, string> }> {
  const byLead = new Map<string, string>();
  const byPhone = new Map<string, string>();
  const size = 1000;
  for (let from = 0; from < 20000; from += size) {
    const { data, error } = await supabase
      .from("intake_interactions")
      .select("lead_id, phone, phone_e164, occurred_at")
      .in("type", CONTACT_TYPES)
      .not("occurred_at", "is", null)
      .order("occurred_at", { ascending: true })
      .range(from, from + size - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    for (const touch of batch) {
      const at = typeof touch.occurred_at === "string" ? touch.occurred_at : "";
      if (!at) continue;
      if (touch.lead_id) rememberEarliest(byLead, touch.lead_id, at);
      const phone = toE164(touch.phone_e164) || toE164(touch.phone);
      if (phone) rememberEarliest(byPhone, phone, at);
    }
    if (batch.length < size) break;
  }
  return { byLead, byPhone };
}

function firstContactDay(
  lead: ReviewSource,
  byLead: Map<string, string>,
  byPhone: Map<string, string>,
): string {
  const times = [byLead.get(lead.id), byPhone.get(toE164(lead.phone) || "")].filter((value): value is string => Boolean(value));
  if (lead.created_at && CALL_ARRIVAL.has(lead.arrival || "")) times.push(lead.created_at);
  if (!times.length) return "";
  times.sort();
  return chicagoDay(times[0]);
}

async function loadEditors(supabase: Awaited<ReturnType<typeof requireStaff>>["supabase"]): Promise<Map<string, string>> {
  const editors = new Map<string, string>();
  const size = 1000;
  for (let from = 0; from < 20000; from += size) {
    const { data, error } = await supabase
      .from("lead_events")
      .select("lead_id, actor, created_at")
      .ilike("actor", "%@%")
      .order("created_at", { ascending: false })
      .range(from, from + size - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    for (const event of batch) {
      if (!event.lead_id || editors.has(event.lead_id)) continue;
      const name = reviewEditorName(event.actor);
      if (name) editors.set(event.lead_id, name);
    }
    if (batch.length < size) break;
  }
  return editors;
}

export default async function ReviewPage() {
  const { supabase } = await requireStaff();
  let rows: ReturnType<typeof toReviewLead>[] = [];
  let loadError: string | null = null;
  try {
    const loaded = await loadReviewLeads(supabase);
    await fillLeadSources(supabase, loaded);
    const [editors, contacts] = await Promise.all([loadEditors(supabase), loadFirstContacts(supabase)]);
    rows = loaded.map((lead) => ({
      ...toReviewLead(lead),
      updatedBy: editors.get(lead.id) ?? "",
      firstContact: firstContactDay(lead, contacts.byLead, contacts.byPhone),
    }));
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Could not load leads.";
  }

  return (
    <main className="w-full px-4 py-4 xl:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-navy">Data review</h1>
      <p className="mt-1 max-w-3xl text-sm text-slate-600">
        Every lead, open and closed. Amber marks a blank contact, marketing, or case field. Name, phone, email, and source save when you leave the field. The other choices save as soon as you change them. First contact is the day of the first call or text. A consultation with a date is yes. Choose no when there was no consultation. Email can be saved as Not Available.
      </p>
      {loadError ? <p className="mt-4 text-sm text-red-700">{loadError}</p> : <DataReview rows={rows} />}
    </main>
  );
}
