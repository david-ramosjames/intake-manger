import type { SupabaseClient } from "@supabase/supabase-js";

export type LeadEntry = "New" | "In Progress";

/** A person saved, graded, or otherwise changed the lead. Loaded Slack and system events do not count. */
export async function loadStaffTouchedIds(supabase: SupabaseClient, ids: string[]): Promise<Set<string>> {
  const touched = new Set<string>();
  if (!ids.length) return touched;
  const slices: string[][] = [];
  for (let index = 0; index < ids.length; index += 80) slices.push(ids.slice(index, index + 80));
  await Promise.all(
    slices.map(async (slice) => {
      for (let from = 0; from < 5000; from += 1000) {
        const { data, error } = await supabase
          .from("lead_events")
          .select("lead_id")
          .in("lead_id", slice)
          .ilike("actor", "%@%")
          .range(from, from + 999);
        if (error) throw new Error(error.message);
        const batch = (data ?? []) as { lead_id: string }[];
        for (const row of batch) touched.add(row.lead_id);
        if (batch.length < 1000) break;
      }
    }),
  );
  return touched;
}

export function leadEntry(input: {
  staffTouched: boolean;
  grade?: string | null;
  screenBy?: string | null;
  intakeBy?: string | null;
}): LeadEntry {
  if (input.staffTouched || input.grade?.trim() || input.screenBy?.trim() || input.intakeBy?.trim()) return "In Progress";
  return "New";
}
