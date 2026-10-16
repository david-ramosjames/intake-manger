import { syncContractsFromTexts } from "@/lib/contract-sync";
import { fillOutstandingLeadSources } from "@/lib/lead-source-fill";
import { fillOutstandingTalkedWith } from "@/lib/talked-with";
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
    const contracts = await syncContractsFromTexts(supabase);
    const sources = await fillOutstandingLeadSources(supabase);
    const talkedWith = await fillOutstandingTalkedWith(supabase);
    const enrolled = await enrollMissingFollowUps(supabase);
    const closed = await closeFinishedLeads(supabase);
    const result = await dispatchDue(supabase);
    return Response.json({ ...result, enrolled, closed, contracts, sources, talkedWith });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Queue run failed" },
      { status: 500 },
    );
  }
}
