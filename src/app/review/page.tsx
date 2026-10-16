import { DataReview } from "@/components/DataReview";
import { fillLeadSources } from "@/lib/lead-source-fill";
import { toReviewLead, type ReviewSource } from "@/lib/review";
import { requireStaff } from "@/lib/session";

const COLUMNS =
  "id, lead_name, phone, email, lead_source, source_type, source_channel, case_type, qualified, consultation, consultation_date, desired_case, desired_source, signed_case, lead_status, callrail_tags, caller_class, agreement_status, agreement_sent_at, lead_date, created_at, summary, case_detail, source_note, slack_permalink, slack_channel_id, slack_message_ts, slack_thread_ts";

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

export default async function ReviewPage() {
  const { supabase } = await requireStaff();
  let rows: ReturnType<typeof toReviewLead>[] = [];
  let loadError: string | null = null;
  try {
    const loaded = await loadReviewLeads(supabase);
    await fillLeadSources(supabase, loaded);
    rows = loaded.map(toReviewLead);
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Could not load leads.";
  }

  return (
    <main className="w-full px-4 py-4 xl:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-navy">Data review</h1>
      <p className="mt-1 max-w-3xl text-sm text-slate-600">
        Every lead, open and closed. Amber marks a blank contact, marketing, or case field. A consultation with a date is yes. Choose no when there was no consultation. Email can be saved as Not Available.
      </p>
      {loadError ? <p className="mt-4 text-sm text-red-700">{loadError}</p> : <DataReview rows={rows} />}
    </main>
  );
}
