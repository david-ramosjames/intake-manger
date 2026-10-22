import { requireAdmin } from "@/lib/session";
import { CALL_SEQUENCES, CALL_SEQUENCE_LABEL, type CallSequenceId } from "@/lib/sequences";
import { DEFAULT_SIGN_CONTRACT_STEPS, signContractStepToDelayMinutes } from "@/lib/sign-contract-schedule";

type TimelineEvent = {
  channel: "call" | "sms" | "contract";
  sequence: string;
  sequenceLabel: string;
  position: number;
  delayMinutes: number;
  body: string;
  day: number;
  timeLabel: string;
};

function formatTimeOffset(minutes: number): { day: number; label: string } {
  const days = Math.floor(minutes / 1440);
  const remainingMinutes = minutes % 1440;
  const hours = Math.floor(remainingMinutes / 60);
  const mins = remainingMinutes % 60;

  if (days === 0) {
    if (hours === 0) {
      return { day: 0, label: `Day 0 (+${mins}m)` };
    }
    if (mins === 0) {
      return { day: 0, label: `Day 0 (+${hours}h)` };
    }
    return { day: 0, label: `Day 0 (+${hours}h ${mins}m)` };
  }

  if (hours === 0 && mins === 0) {
    return { day: days, label: `Day ${days}` };
  }
  if (mins === 0) {
    return { day: days, label: `Day ${days} (+${hours}h)` };
  }
  return { day: days, label: `Day ${days} (+${hours}h ${mins}m)` };
}

export default async function OutreachTimelinePage({
  searchParams,
}: {
  searchParams: Promise<{ sequence?: string }>;
}) {
  const params = await searchParams;
  const selectedSequence = (params.sequence as CallSequenceId | undefined) || "first_talk";
  const { supabase } = await requireAdmin();

  const [callStepsResult, smsSequencesResult] = await Promise.all([
    supabase
      .from("sequence_steps")
      .select("sequence, queue, position, delay_minutes, body")
      .eq("sequence", selectedSequence)
      .order("position"),
    supabase.from("followup_sequences").select("id, name, slug, is_default").eq("is_active", true),
  ]);

  const callSteps = callStepsResult.data ?? [];
  const smsSequences = smsSequencesResult.data ?? [];

  const defaultSmsSequence = smsSequences.find((s) => s.is_default) || smsSequences[0];
  
  const smsStepsResult = defaultSmsSequence
    ? await supabase
        .from("followup_steps")
        .select("sequence_id, position, delay_minutes, body_en, label")
        .eq("sequence_id", defaultSmsSequence.id)
        .order("position")
    : { data: [], error: null };

  const smsSteps = smsStepsResult.data ?? [];

  const smsSequenceMap = new Map<string, { name: string; slug: string }>();
  for (const seq of smsSequences) {
    smsSequenceMap.set(seq.id, { name: seq.name, slug: seq.slug });
  }

  const timeline: TimelineEvent[] = [];

  for (const step of callSteps) {
    if (step.queue !== "call") continue;
    const { day, label } = formatTimeOffset(step.delay_minutes);
    timeline.push({
      channel: "call",
      sequence: step.sequence,
      sequenceLabel: CALL_SEQUENCE_LABEL[step.sequence as CallSequenceId] || step.sequence,
      position: step.position,
      delayMinutes: step.delay_minutes,
      body: step.body || "",
      day,
      timeLabel: label,
    });
  }

  for (const step of smsSteps) {
    const seqInfo = smsSequenceMap.get(step.sequence_id);
    if (!seqInfo) continue;
    
    const { day, label } = formatTimeOffset(step.delay_minutes);
    timeline.push({
      channel: "sms",
      sequence: seqInfo.slug,
      sequenceLabel: seqInfo.name,
      position: step.position,
      delayMinutes: step.delay_minutes,
      body: step.body_en || "",
      day,
      timeLabel: label,
    });
  }

  if (selectedSequence === "want_to_sign") {
    for (const step of DEFAULT_SIGN_CONTRACT_STEPS) {
      const delayMinutes = signContractStepToDelayMinutes(step);
      const { day, label } = formatTimeOffset(delayMinutes);
      timeline.push({
        channel: "contract",
        sequence: "contract-reminders",
        sequenceLabel: "Contract Reminders",
        position: step.day * 100 + (step.minutesAfterSend || 0),
        delayMinutes,
        body: step.label,
        day,
        timeLabel: label,
      });
    }
  }

  timeline.sort((a, b) => a.delayMinutes - b.delayMinutes || a.channel.localeCompare(b.channel));

  const groupedByDay = new Map<number, TimelineEvent[]>();
  for (const event of timeline) {
    const events = groupedByDay.get(event.day) ?? [];
    events.push(event);
    groupedByDay.set(event.day, events);
  }

  const days = [...groupedByDay.keys()].sort((a, b) => a - b);

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight text-navy">Outreach Timeline</h1>
      <p className="mt-1 max-w-3xl text-sm text-slate-600">
        View the full outreach timeline for a lead: call sequence, SMS sequence, and contract reminders all on one
        shared timeline. Select a call sequence to see its timeline combined with the default SMS sequence
        {defaultSmsSequence ? ` (${defaultSmsSequence.name})` : ""}.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {CALL_SEQUENCES.map((id) => (
          <a
            key={id}
            href={`/outreach-timeline?sequence=${id}`}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              id === selectedSequence
                ? "bg-navy text-white"
                : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {CALL_SEQUENCE_LABEL[id]}
          </a>
        ))}
      </div>

      {callStepsResult.error && (
        <p className="mt-3 text-sm text-red-700">Call sequences error: {callStepsResult.error.message}</p>
      )}
      {smsStepsResult.error && (
        <p className="mt-3 text-sm text-red-700">SMS sequences error: {smsStepsResult.error.message}</p>
      )}

      <div className="mt-6 space-y-8">
        {days.map((day) => {
          const events = groupedByDay.get(day)!;
          const dayLabel = day === 0 ? "Day 0 (Send/First Contact)" : `Day ${day}`;

          return (
            <div key={day} className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 bg-slate-50 px-5 py-3">
                <h2 className="text-lg font-semibold text-navy">{dayLabel}</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {events.length} {events.length === 1 ? "touchpoint" : "touchpoints"}
                </p>
              </div>
              <div className="p-5">
                <div className="space-y-4">
                  {events.map((event, idx) => {
                    const channelColors = {
                      call: "bg-blue-50 border-blue-300 text-blue-900",
                      sms: "bg-green-50 border-green-300 text-green-900",
                      contract: "bg-purple-50 border-purple-300 text-purple-900",
                    };
                    const channelIcons = {
                      call: "📞",
                      sms: "💬",
                      contract: "📄",
                    };
                    const channelLabels = {
                      call: "Phone Call",
                      sms: "Text Message",
                      contract: "Contract Reminder",
                    };

                    return (
                      <div
                        key={`${event.channel}-${event.sequence}-${event.position}-${idx}`}
                        className="relative rounded-lg border border-slate-200 bg-white p-4 transition-shadow hover:shadow-md"
                      >
                        <div className="flex items-start gap-4">
                          <div className="flex-shrink-0">
                            <span
                              className={`inline-flex h-10 w-10 items-center justify-center rounded-full border-2 text-xl ${channelColors[event.channel]}`}
                            >
                              {channelIcons[event.channel]}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-semibold text-slate-900">
                                    {channelLabels[event.channel]}
                                  </span>
                                  <span
                                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${channelColors[event.channel]}`}
                                  >
                                    {event.timeLabel}
                                  </span>
                                </div>
                                <p className="mt-0.5 text-xs text-slate-500">
                                  {event.sequenceLabel} • Step {event.position}
                                </p>
                              </div>
                            </div>
                            <div className="mt-2 rounded-md bg-slate-50 p-3">
                              <p className="text-sm leading-relaxed text-slate-700">{event.body}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {timeline.length === 0 && (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm text-slate-600">No timeline events found for this sequence.</p>
        </div>
      )}

      <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <h3 className="text-sm font-semibold text-amber-900">Data Sources</h3>
        <ul className="mt-2 space-y-1 text-xs text-amber-800">
          <li>
            <strong>Call sequences:</strong> Read from <code>sequence_steps</code> table in Supabase (editable via{" "}
            <a href="/sequences" className="underline">
              Sequences page
            </a>
            )
          </li>
          <li>
            <strong>SMS sequences:</strong> Read from <code>followup_steps</code> and <code>followup_sequences</code>{" "}
            tables in Supabase (managed by follow-up-text service at{" "}
            <a
              href="https://github.com/david-ramosjames/follow-up-text"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              follow-up-text
            </a>
            )
          </li>
          <li>
            <strong>Contract reminders:</strong> Default schedule copied from sign-flow service (actual schedule is in
            Firestore app_settings, editable in{" "}
            <a
              href="https://github.com/david-ramosjames/sign-flow"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              sign-flow
            </a>
            ). See <code>src/lib/sign-contract-schedule.ts</code> for sync instructions.
          </li>
        </ul>
      </div>
    </main>
  );
}
