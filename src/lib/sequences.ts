import type { SupabaseClient } from "@supabase/supabase-js";

export const CALL_SEQUENCES = ["want_to_sign", "first_talk", "more_info"] as const;

export type CallSequenceId = (typeof CALL_SEQUENCES)[number];

export const CALL_SEQUENCE_LABEL: Record<CallSequenceId, string> = {
  want_to_sign: "Contract follow-up",
  first_talk: "Uncontacted lead",
  more_info: "Post-consultation",
};

export const CALL_SEQUENCE_DETAIL: Record<CallSequenceId, string> = {
  want_to_sign: "Day 1 is the day the contract was sent. It runs until the contract is signed or the last day of the cadence.",
  first_talk: "Day 1 is the day the client contacted the firm.",
  more_info: "Day 1 is the consultation, or the day the client was reached when there is no consultation yet.",
};

export function isCallSequence(value: string | null | undefined): value is CallSequenceId {
  return value === "want_to_sign" || value === "first_talk" || value === "more_info";
}

export function leadSequenceId(input: {
  closed: boolean;
  talked: boolean;
  kind: string | null;
  agreementStatus: string | null;
  agreementSentAt: string | null;
  signedCase?: boolean | null;
}): CallSequenceId | null {
  if (input.closed || input.signedCase) return null;
  const agreement = (input.agreementStatus || "").toLowerCase();
  const contractOut =
    agreement === "sent" ||
    agreement === "viewed" ||
    (Boolean(input.agreementSentAt) && !["failed", "signed", "completed", "cancelled", "expired"].includes(agreement));
  if (contractOut) return "want_to_sign";
  if (!input.talked) return "first_talk";
  return "more_info";
}

export function splitDelay(minutes: number): { days: number; hours: number } {
  const safe = Math.max(0, Math.round(minutes));
  return { days: Math.floor(safe / 1440), hours: Math.floor((safe % 1440) / 60) };
}

export function delayMinutes(days: number, hours: number): number {
  return days * 1440 + hours * 60;
}

export type CallbackWindow = "morning" | "lunch" | "afternoon" | "contact";

export function isCallbackWindow(value: string | null | undefined): value is CallbackWindow {
  return value === "morning" || value === "lunch" || value === "afternoon" || value === "contact";
}

export type CadenceDay = {
  calls: CallbackWindow[];
  texts: CallbackWindow[];
};

/** The pictured 14-day plan. Reset loads this. New enrollments use whatever is saved. */
export const NEW_LEAD_CADENCE: CadenceDay[] = [
  { calls: ["morning", "afternoon"], texts: ["lunch", "afternoon"] },
  { calls: ["morning", "afternoon"], texts: ["afternoon"] },
  { calls: ["morning", "afternoon"], texts: ["afternoon"] },
  { calls: ["morning"], texts: ["afternoon"] },
  { calls: ["morning"], texts: ["afternoon"] },
  { calls: ["morning"], texts: ["afternoon"] },
  { calls: ["morning"], texts: ["afternoon"] },
  { calls: ["morning"], texts: [] },
  { calls: [], texts: ["afternoon"] },
  { calls: ["morning"], texts: [] },
  { calls: [], texts: ["afternoon"] },
  { calls: ["morning"], texts: [] },
  { calls: ["morning"], texts: [] },
  { calls: [], texts: ["afternoon"] },
];

export function cadenceFromSteps(
  steps: { queue: string; position: number; delay_minutes: number; callback_window: string | null }[],
): CadenceDay[] {
  const grouped = new Map<number, CadenceDay>();
  for (const step of [...steps].sort((a, b) => a.position - b.position)) {
    const day = Math.floor(Math.max(0, step.delay_minutes) / 1440);
    const plan = grouped.get(day) ?? { calls: [], texts: [] };
    const slot = isCallbackWindow(step.callback_window) ? step.callback_window : "morning";
    if (step.queue === "text") plan.texts.push(slot);
    else plan.calls.push(slot);
    grouped.set(day, plan);
  }
  const last = Math.max(13, ...grouped.keys(), 0);
  return Array.from({ length: last + 1 }, (_, day) => grouped.get(day) ?? { calls: [], texts: [] });
}

/** Minutes from midnight, Chicago. A null weekend window means that day is closed. */
export type WorkHours = {
  weekdayStart: number;
  weekdayEnd: number;
  saturdayStart: number | null;
  saturdayEnd: number | null;
  sundayStart: number | null;
  sundayEnd: number | null;
};

export const DEFAULT_WORK_HOURS: WorkHours = {
  weekdayStart: 8 * 60,
  weekdayEnd: 18 * 60,
  saturdayStart: 8 * 60,
  saturdayEnd: 18 * 60,
  sundayStart: null,
  sundayEnd: null,
};

type HourRow = {
  sequence: string;
  weekday_start: number;
  weekday_end: number;
  saturday_start: number | null;
  saturday_end: number | null;
  sunday_start: number | null;
  sunday_end: number | null;
};

export function minutesToClock(minutes: number): string {
  const safe = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export function clockToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function rowToHours(row: HourRow): WorkHours {
  return {
    weekdayStart: row.weekday_start,
    weekdayEnd: row.weekday_end,
    saturdayStart: row.saturday_start,
    saturdayEnd: row.saturday_end,
    sundayStart: row.sunday_start,
    sundayEnd: row.sunday_end,
  };
}

export async function loadWorkHours(supabase: SupabaseClient): Promise<Record<CallSequenceId, WorkHours>> {
  const hours: Record<CallSequenceId, WorkHours> = {
    want_to_sign: DEFAULT_WORK_HOURS,
    first_talk: DEFAULT_WORK_HOURS,
    more_info: DEFAULT_WORK_HOURS,
  };
  const { data, error } = await supabase
    .from("sequence_hours")
    .select("sequence, weekday_start, weekday_end, saturday_start, saturday_end, sunday_start, sunday_end");
  if (error || !data) return hours;
  for (const row of data as HourRow[]) {
    if (isCallSequence(row.sequence)) hours[row.sequence] = rowToHours(row);
  }
  return hours;
}
