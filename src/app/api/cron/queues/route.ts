import { syncContractsFromTexts } from "@/lib/contract-sync";
import { fillOutstandingLeadSources } from "@/lib/lead-source-fill";
import { fillOutstandingTalkedWith } from "@/lib/talked-with";
import { dispatchDue } from "@/lib/dispatch";
import { closeFinishedLeads } from "@/lib/funnel";
import { enrollMissingFollowUps, stopParkedFollowUps } from "@/lib/followup";
import { syncCallLedger, syncInboxCalls, backfillCallAiFlags } from "@/lib/inbox-calls";
import { collapseDuplicateOpenCalls } from "@/lib/open-calls";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 60;

async function step<T>(name: string, run: () => Promise<T>): Promise<{ name: string; ok: true; result: T } | { name: string; ok: false; error: string }> {
  try {
    return { name, ok: true, result: await run() };
  } catch (error) {
    return { name, ok: false, error: error instanceof Error ? error.message : `${name} failed` };
  }
}

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
    // Call stats first so a later lead-merge failure cannot leave the dashboard behind the email.
    const inboxSync = await step("inboxSync", () => syncInboxCalls(supabase));
    const callLedger = await step("callLedger", async () => {
      let stored = 0;
      let connected = false;
      let finished = false;
      for (let pass = 0; pass < 8; pass += 1) {
        const result = await syncCallLedger(supabase);
        connected = result.connected;
        stored += result.stored;
        finished = result.finished;
        if (!result.connected || result.finished || result.stored === 0) break;
      }
      return { stored, connected, finished };
    });
    const callAi = await step("callAi", () => backfillCallAiFlags(supabase, { limit: 40 }));
    const contracts = await step("contracts", () => syncContractsFromTexts(supabase));
    const sources = await step("sources", () => fillOutstandingLeadSources(supabase));
    const talkedWith = await step("talkedWith", () => fillOutstandingTalkedWith(supabase));
    const parked = await step("parked", () => stopParkedFollowUps(supabase));
    const enrolled = await step("enrolled", () => enrollMissingFollowUps(supabase));
    const autoClosedCalls = await step("autoClosedCalls", () => collapseDuplicateOpenCalls(supabase));
    const closed = await step("closed", () => closeFinishedLeads(supabase));
    const dispatch = await step("dispatch", () => dispatchDue(supabase));
    const failed = [inboxSync, callLedger, callAi, contracts, sources, talkedWith, parked, enrolled, autoClosedCalls, closed, dispatch].filter(
      (item) => !item.ok,
    );
    return Response.json({
      inboxSync,
      callLedger,
      callAi,
      contracts,
      sources,
      talkedWith,
      parked,
      enrolled,
      autoClosedCalls,
      closed,
      dispatch,
      failed: failed.map((item) => ({ name: item.name, error: item.ok ? null : item.error })),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Queue run failed" },
      { status: 500 },
    );
  }
}
