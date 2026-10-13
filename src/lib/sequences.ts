import type { SupabaseClient } from "@supabase/supabase-js";

export const CALL_SEQUENCES = ["want_to_sign", "first_talk", "more_info"] as const;

export type CallSequenceId = (typeof CALL_SEQUENCES)[number];

export const CALL_SEQUENCE_LABEL: Record<CallSequenceId, string> = {
  want_to_sign: "Want to sign",
  first_talk: "First conversation",
  more_info: "Need more information",
};

export const CALL_SEQUENCE_DETAIL: Record<CallSequenceId, string> = {
  want_to_sign: "A lead we want to sign. The call times here are the next call.",
  first_talk: "A lead we still need to talk to for the first time.",
  more_info: "A lead we already talked to, and we still need more information.",
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
}): CallSequenceId | null {
  if (input.closed) return null;
  const agreement = (input.agreementStatus || "").toLowerCase();
  const contractOut =
    agreement === "sent" ||
    agreement === "viewed" ||
    (Boolean(input.agreementSentAt) && !["failed", "signed", "completed"].includes(agreement));
  if (contractOut) return "want_to_sign";
  if (!input.talked) return "first_talk";
  if (input.kind === "needs_info") return "more_info";
  return "want_to_sign";
}

export function splitDelay(minutes: number): { days: number; hours: number } {
  const safe = Math.max(0, Math.round(minutes));
  return { days: Math.floor(safe / 1440), hours: Math.floor((safe % 1440) / 60) };
}

export function delayMinutes(days: number, hours: number): number {
  return days * 1440 + hours * 60;
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
