import { requireStaff } from "@/lib/session";

const CALL_ARRIVAL = new Set(["human_call", "qualified_call", "sona"]);

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase } = await requireStaff();
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("phone_e164, summary, quo_link, created_at, arrival")
    .eq("id", id)
    .maybeSingle();
  if (leadError) return Response.json({ error: leadError.message }, { status: 500 });

  let query = supabase
    .from("intake_interactions")
    .select("id, type, direction, content, occurred_at, quo_link")
    .order("occurred_at", { ascending: false })
    .limit(8);
  query = lead?.phone_e164
    ? query.or(`lead_id.eq.${id},phone_e164.eq.${lead.phone_e164}`)
    : query.eq("lead_id", id);
  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const touches = (data ?? []).map((touch) => ({
    ...touch,
    content: touch.content ? String(touch.content).slice(0, 280) : null,
  }));
  if (
    touches.length === 0 &&
    lead &&
    CALL_ARRIVAL.has(String(lead.arrival || "")) &&
    (lead.summary || lead.quo_link)
  ) {
    touches.push({
      id: `origin-${id}`,
      type: "call",
      direction: "inbound",
      content: lead.summary ? String(lead.summary).slice(0, 280) : "Call recorded on the lead.",
      occurred_at: lead.created_at,
      quo_link: lead.quo_link,
    });
  }
  return Response.json(touches);
}
