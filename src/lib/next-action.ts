import { scheduleCallback } from "@/lib/callbacks";
import { formatCallWhen } from "@/lib/time";

export type CallStep = { position: number; delay_minutes: number; callback_window?: string | null };

const REMINDER_CLOSED = new Set(["signed", "completed", "failed", "cancelled", "expired"]);

export type NextActionLine = { label: string; when: string; at: string | null };

export function nextActionLines(input: {
  closed: boolean;
  sequence: string | null;
  textStatus: string | null;
  textNextAt: string | null;
  reminderAt: string | null;
  agreementStatus: string | null;
  callStart: string | null;
  callsMade: number;
  pendingCallAt: string | null;
  callSteps: CallStep[];
  priority?: boolean;
  contactAt?: string | null;
  leadId?: string | null;
}): NextActionLine[] {
  const lines: NextActionLine[] = [];
  if (!input.closed && (input.textStatus || "").toLowerCase() === "active" && input.textNextAt) {
    lines.push({ label: "Text", when: formatCallWhen(input.textNextAt), at: input.textNextAt });
  }
  const agreement = (input.agreementStatus || "").toLowerCase();
  if (!input.closed && input.reminderAt && !REMINDER_CLOSED.has(agreement)) {
    lines.push({ label: "Reminder", when: formatCallWhen(input.reminderAt), at: input.reminderAt });
  }
  if (!lines.length) lines.push({ label: "Text", when: "None", at: null });
  const callAt = nextCallAt(input);
  lines.push({ label: "Call", when: callAt ? formatCallWhen(callAt) : "None", at: callAt });
  return lines;
}

/** The soonest text, reminder, or call. */
export function nextActionMoment(lines: NextActionLine[]): string | null {
  const times = lines.map((line) => line.at).filter((at): at is string => Boolean(at));
  times.sort();
  return times[0] ?? null;
}

function nextCallAt(input: {
  closed: boolean;
  sequence: string | null;
  callStart: string | null;
  callsMade: number;
  pendingCallAt: string | null;
  callSteps: CallStep[];
  priority?: boolean;
  contactAt?: string | null;
  leadId?: string | null;
}): string | null {
  if (input.closed || input.sequence === "stop") return null;
  const now = Date.now();
  if (input.pendingCallAt) return input.pendingCallAt;
  const steps = [...input.callSteps].sort((a, b) => a.position - b.position);
  if (!steps.length || !input.callStart) return null;
  const start = new Date(input.callStart).getTime();
  if (Number.isNaN(start)) return null;
  const contactAt = input.contactAt ? new Date(input.contactAt) : null;
  for (let index = Math.max(0, input.callsMade); index < steps.length; index += 1) {
    const step = steps[index];
    const at = scheduleCallback({
      from: new Date(start + step.delay_minutes * 60_000),
      window: step.callback_window,
      index,
      contactAt,
      priority: Boolean(input.priority),
      varyKey: `${input.leadId || input.callStart}:${step.position}`,
    });
    if (new Date(at).getTime() > now) return at;
  }
  return null;
}
