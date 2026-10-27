import { requireStaff } from "@/lib/session";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!id) return Response.json({ error: "Missing lead." }, { status: 400 });
  const { supabase } = await requireStaff();
  const { data, error } = await supabase
    .from("leads")
    .select("id, lead_status, close_reason")
    .eq("id", id)
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: "Lead not found." }, { status: 404 });
  return Response.json(data);
}
