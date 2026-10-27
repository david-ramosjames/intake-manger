import { isWorkLead } from "@/lib/caller-class";
import { isCallJob } from "@/lib/call-grade";
import { requireStaff } from "@/lib/session";
import { slackThreadNotes } from "@/lib/slack";
import { loadSlackSettings } from "@/lib/slack-settings";

const CALL_ARRIVAL = new Set(["human_call", "qualified_call", "sona"]);

type GradeRow = {
  call_id: string | null;
  grade: string;
  reason: string | null;
  handler_name: string | null;
  jobs: string | null;
  screen_handler_name: string | null;
  intake_handler_name: string | null;
  screen_grade: string | null;
  intake_grade: string | null;
};

type InteractionRow = {
  id: string;
  type: string | null;
  direction: string | null;
  content: string | null;
  occurred_at: string | null;
  quo_link: string | null;
  source_id: string | null;
  phone: string | null;
  phone_e164: string | null;
  data: Record<string, unknown> | null;
};

function partyLabel(value: unknown, fallback: string | null): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (text) return text;
  const phone = (fallback || "").trim();
  return phone || null;
}

/** Texts used to store only the body. Missed calls and Slack already include From/To. */
function activityContent(touch: InteractionRow, leadPhone: string | null): string | null {
  const raw = touch.content ? String(touch.content) : "";
  if (!raw) return null;
  if (/^From:\s/im.test(raw) || /^📞/m.test(raw)) return raw.slice(0, 700);
  if (String(touch.type || "").toLowerCase() !== "text") return raw.slice(0, 500);

  const data = touch.data && typeof touch.data === "object" ? touch.data : {};
  const client = partyLabel(null, touch.phone_e164 || touch.phone || leadPhone);
  const inbound = String(touch.direction || "").toLowerCase() === "inbound";
  const from =
    partyLabel(data.from_display ?? data.fromDisplay ?? data.from, inbound ? client : "Ramos James Law") ||
    (inbound ? client : "Ramos James Law");
  const to =
    partyLabel(data.to_display ?? data.toDisplay ?? data.to, inbound ? "Ramos James Law" : client) ||
    (inbound ? "Ramos James Law" : client);
  if (!from && !to) return raw.slice(0, 500);
  return `From: ${from}\nTo: ${to}\nMessage: ${raw}`.slice(0, 700);
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase } = await requireStaff();
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("phone_e164, summary, quo_link, created_at, arrival, caller_class, slack_permalink, slack_channel_id, slack_message_ts, slack_thread_ts")
    .eq("id", id)
    .maybeSingle();
  if (leadError) return Response.json({ error: leadError.message }, { status: 500 });

  let query = supabase
    .from("intake_interactions")
    .select("id, type, direction, content, occurred_at, quo_link, source_id, phone, phone_e164, data")
    .order("occurred_at", { ascending: false })
    .limit(40);
  query = lead?.phone_e164
    ? query.or(`lead_id.eq.${id},phone_e164.eq.${lead.phone_e164}`)
    : query.eq("lead_id", id);
  const [{ data, error }, slack] = await Promise.all([query, loadSlackSettings()]);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const rows = data ?? [];
  const callIds = [...new Set(rows.map((touch) => touch.source_id).filter((value): value is string => Boolean(value)))];
  const grades = new Map<string, GradeRow>();
  if (callIds.length && isWorkLead(lead ?? {})) {
    const { data: gradeRows } = await supabase
      .from("call_grades")
      .select("call_id, grade, reason, handler_name, jobs, screen_handler_name, intake_handler_name, screen_grade, intake_grade")
      .in("call_id", callIds.slice(0, 80));
    for (const grade of (gradeRows ?? []) as GradeRow[]) {
      if (grade.call_id) grades.set(grade.call_id, grade);
    }
  }
  const touches: {
    id: string;
    type: string | null;
    direction: string | null;
    content: string | null;
    occurred_at: string | null;
    quo_link?: string | null;
    actor?: string | null;
    grade?: string | null;
    gradeReason?: string | null;
    gradeHandler?: string | null;
    jobs?: string | null;
    screenHandler?: string | null;
    intakeHandler?: string | null;
    screenGrade?: string | null;
    intakeGrade?: string | null;
  }[] = rows.map((touch) => {
    const grade = touch.source_id ? grades.get(touch.source_id) : undefined;
    return {
      id: touch.id,
      type: touch.type,
      direction: touch.direction,
      content: activityContent(touch, lead?.phone_e164 ?? null),
      occurred_at: touch.occurred_at,
      quo_link: touch.quo_link,
      grade: grade?.grade || null,
      gradeReason: grade?.reason || null,
      gradeHandler: grade?.handler_name || null,
      jobs: isCallJob(grade?.jobs) ? grade.jobs : null,
      screenHandler: grade?.screen_handler_name || null,
      intakeHandler: grade?.intake_handler_name || null,
      screenGrade: grade?.screen_grade || null,
      intakeGrade: grade?.intake_grade || null,
    };
  });
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
