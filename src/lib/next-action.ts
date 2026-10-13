import { formatCallWhen, snapToWorkHours } from "@/lib/time";

export type CallStep = { position: number; delay_minutes: number };

const REMINDER_CLOSED = new Set(["signed", "completed", "failed", "cancelled", "expired"]);

export type NextActionLine = { label: string; when: string };

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
}): NextActionLine[] {
  const lines: NextActionLine[] = [];
  if (!input.closed && (input.textStatus || "").toLowerCase() === "active" && input.textNextAt) {
    lines.push({ label: "Text", when: formatCallWhen(input.textNextAt) });
  }
  const agreement = (input.agreementStatus || "").toLowerCase();
  if (!input.closed && input.reminderAt && !REMINDER_CLOSED.has(agreement)) {
    lines.push({ label: "Reminder", when: formatCallWhen(input.reminderAt) });
  }
  if (!lines.length) lines.push({ label: "Text", when: "None" });
  const callAt = nextCallAt(input);
  lines.push({ label: "Call", when: callAt ? formatCallWhen(callAt) : "None" });
  return lines;
}

function nextCallAt(input: {
  closed: boolean;
  sequence: string | null;
  callStart: string | null;
  callsMade: number;
  pendingCallAt: string | null;
  callSteps: CallStep[];
}): string | null {
  if (input.closed || input.sequence === "stop") return null;
  const steps = [...input.callSteps].sort((a, b) => a.position - b.position);
  if (!steps.length) return input.pendingCallAt;
  const step = steps[Math.max(0, input.callsMade)] ?? null;
  if (!step || !input.callStart) return null;
  const start = new Date(input.callStart).getTime();
  if (Number.isNaN(start)) return null;
  const due = snapToWorkHours(new Date(start + step.delay_minutes * 60_000).toISOString());
  if (new Date(due).getTime() <= Date.now()) return snapToWorkHours(new Date().toISOString());
  return due;
}
