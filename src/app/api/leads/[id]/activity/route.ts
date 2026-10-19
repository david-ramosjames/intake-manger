import { requireStaff } from "@/lib/session";
import { slackThreadNotes } from "@/lib/slack";
import { loadSlackSettings } from "@/lib/slack-settings";

const CALL_ARRIVAL = new Set(["human_call", "qualified_call", "sona"]);

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase } = await requireStaff();
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("phone_e164, summary, quo_link, created_at, arrival, slack_permalink, slack_channel_id, slack_message_ts, slack_thread_ts")
    .eq("id", id)
    .maybeSingle();
  if (leadError) return Response.json({ error: leadError.message }, { status: 500 });

  let query = supabase
    .from("intake_interactions")
    .select("id, type, direction, content, occurred_at, quo_link")
    .order("occurred_at", { ascending: false })
    .limit(40);
  query = lead?.phone_e164
    ? query.or(`lead_id.eq.${id},phone_e164.eq.${lead.phone_e164}`)
    : query.eq("lead_id", id);
  const [{ data, error }, slack] = await Promise.all([query, loadSlackSettings()]);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const touches: {
    id: string;
    type: string | null;
    direction: string | null;
    content: string | null;
    occurred_at: string | null;
    quo_link?: string | null;
    actor?: string | null;
  }[] = (data ?? []).map((touch) => ({
    ...touch,
    content: touch.content ? String(touch.content).slice(0, 500) : null,
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
      content: lead.summary ? String(lead.summary).slice(0, 500) : "Call recorded on the lead.",
      occurred_at: lead.created_at,
      quo_link: lead.quo_link,
    });
  }
  if (lead) {
    const notes = await slackThreadNotes({
      token: slack.token,
      channelId: lead.slack_channel_id,
      threadTs: lead.slack_thread_ts || lead.slack_message_ts,
      permalink: lead.slack_permalink,
    });
    for (const note of notes) {
      touches.push({
        id: note.id,
        type: "slack",
        direction: null,
        content: note.text,
        occurred_at: note.occurred_at,
        actor: note.userName,
      });
    }
  }
  touches.sort((a, b) => String(b.occurred_at || "").localeCompare(String(a.occurred_at || "")));
  return Response.json(touches);
}
