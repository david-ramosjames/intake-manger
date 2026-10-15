import type { SupabaseClient } from "@supabase/supabase-js";

export const CALL_SEQUENCES = ["want_to_sign", "first_talk", "more_info"] as const;

export type CallSequenceId = (typeof CALL_SEQUENCES)[number];

export const CALL_SEQUENCE_LABEL: Record<CallSequenceId, string> = {
  want_to_sign: "Contract follow-up",
  first_talk: "Uncontacted lead",
  more_info: "Post-consultation",
};

export const CALL_SEQUENCE_DETAIL: Record<CallSequenceId, string> = {
  want_to_sign: "Starts when a contract is sent and not signed. The aim is to get it signed.",
  first_talk: "Starts on its own for a missed call or a form fill, to make first contact.",
  more_info: "Starts only when someone clicks Start follow-up sequence, after a conversation that still needs a callback.",
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
    ["sent", "viewed", "signed", "completed"].includes(agreement) ||
    (Boolean(input.agreementSentAt) && agreement !== "failed");
  if (contractOut) return "want_to_sign";
  if (!input.talked) return "first_talk";
  return null;
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
