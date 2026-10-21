import { countCurrentPriority } from "@/lib/next-step";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Streamed separately so header navigation is not blocked on the priority count query. */
export async function PriorityCountBadge() {
  const supabase = await createSupabaseServerClient();
  const count = await countCurrentPriority(supabase);
  return (
    <span className="min-w-[1.25rem] rounded-full bg-accent px-1.5 py-0.5 text-center text-[11px] font-semibold leading-none text-white">
      {count}
    </span>
  );
}
