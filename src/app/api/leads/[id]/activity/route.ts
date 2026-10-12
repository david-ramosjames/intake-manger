import { requireStaff } from "@/lib/session";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase } = await requireStaff();
  const { data, error } = await supabase
    .from("intake_interactions")
    .select("id, type, direction, content, occurred_at, quo_link")
    .eq("lead_id", id)
    .order("occurred_at", { ascending: false })
    .limit(8);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const touches = (data ?? []).map((touch) => ({
    ...touch,
    content: touch.content ? String(touch.content).slice(0, 280) : null,
  }));
  return Response.json(touches);
}
