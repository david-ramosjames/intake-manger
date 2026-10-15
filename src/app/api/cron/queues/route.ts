import { dispatchDue } from "@/lib/dispatch";
import { closeFinishedLeads } from "@/lib/funnel";
import { enrollMissingFollowUps } from "@/lib/followup";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || header !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }
  try {
    const supabase = createSupabaseServiceClient();
    const enrolled = await enrollMissingFollowUps(supabase);
    const closed = await closeFinishedLeads(supabase);
    const result = await dispatchDue(supabase);
    return Response.json({ ...result, enrolled, closed });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Queue run failed" },
      { status: 500 },
    );
  }
}
