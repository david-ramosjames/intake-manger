import { requireStaff } from "@/lib/session";
import { loadWorkQueueRows } from "@/lib/work-queue-rows";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!id) return Response.json({ error: "Missing lead." }, { status: 400 });
  const { supabase } = await requireStaff();
  const { rows } = await loadWorkQueueRows(supabase, [id]);
  const row = rows[0];
  if (!row) return Response.json({ error: "Lead not found." }, { status: 404 });
  return Response.json({ row });
}
