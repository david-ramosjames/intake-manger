import type { SupabaseClient } from "@supabase/supabase-js";

export const AUTO_CLOSED_CALL = "auto_closed";
const AUTO_CLOSED_DETAIL = "Not complete. A newer open call replaced this one.";

type OpenJob = {
  id: string;
  lead_id: string;
  due_at: string;
  created_at: string | null;
};

/** One due call per lead. Older pending calls close as not complete. */
export async function collapseDuplicateOpenCalls(supabase: SupabaseClient): Promise<number> {
  const now = new Date().toISOString();
  const rows: OpenJob[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from("lead_jobs")
      .select("id, lead_id, due_at, created_at, leads!inner(test)")
      .eq("queue", "call")
      .eq("status", "pending")
      .eq("leads.test", false)
      .lte("due_at", now)
      .order("due_at", { ascending: false })
      .range(from, from + page - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as OpenJob[];
    rows.push(...batch);
    if (batch.length < page) break;
  }

  const keep = new Map<string, OpenJob>();
  const drop: string[] = [];
  for (const row of rows) {
    const current = keep.get(row.lead_id);
    if (!current) {
      keep.set(row.lead_id, row);
      continue;
    }
    const newer =
      row.due_at > current.due_at || (row.due_at === current.due_at && (row.created_at ?? "") > (current.created_at ?? ""));
    if (newer) {
      drop.push(current.id);
      keep.set(row.lead_id, row);
    } else {
      drop.push(row.id);
    }
  }
  if (!drop.length) return 0;

  const patch = {
    status: "skipped",
    outcome: null,
    outcome_note: AUTO_CLOSED_CALL,
    completed_at: now,
    completed_by: "intake-manager",
    detail: AUTO_CLOSED_DETAIL,
  };
  for (let index = 0; index < drop.length; index += 100) {
    const { error: updateError } = await supabase
      .from("lead_jobs")
      .update(patch)
      .in("id", drop.slice(index, index + 100))
      .eq("status", "pending");
    if (updateError) throw new Error(updateError.message);
  }
  return drop.length;
}

export async function callFinishCounts(supabase: SupabaseClient): Promise<{ completed: number; autoClosed: number }> {
  const [{ count: completed, error: completedError }, { count: autoClosed, error: autoError }] = await Promise.all([
    supabase.from("lead_jobs").select("id", { count: "exact", head: true }).eq("queue", "call").eq("status", "completed"),
    supabase.from("lead_jobs").select("id", { count: "exact", head: true }).eq("queue", "call").eq("status", "skipped").eq("outcome_note", AUTO_CLOSED_CALL),
  ]);
  if (completedError) throw new Error(completedError.message);
  if (autoError) throw new Error(autoError.message);
  return { completed: completed ?? 0, autoClosed: autoClosed ?? 0 };
}
