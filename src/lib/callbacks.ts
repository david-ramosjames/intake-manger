import { chicagoDay, chicagoLocalToIso, chicagoParts } from "./time";

const BUCKETS = ["morning", "contact", "lunch", "afternoon"] as const;

const DAY_START = 8 * 60 + 30;
const DAY_END = 17 * 60 + 30;

const WINDOW = {
  morning: [DAY_START, 11 * 60 + 30],
  lunch: [11 * 60 + 30, 14 * 60 + 30],
  afternoon: [14 * 60 + 30, DAY_END],
} as const;

function vary(key: string, span: number): number {
  if (span <= 1) return 0;
  let hash = 0;
  for (const char of key) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return hash % span;
}

function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function shiftDay(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, date + days));
  return next.toISOString().slice(0, 10);
}

function contactWindow(contactAt: Date | null): { start: number; end: number } {
  if (!contactAt || Number.isNaN(contactAt.getTime())) return { start: WINDOW.morning[0], end: WINDOW.morning[1] };
  const parts = chicagoParts(contactAt);
  const minute = parts.hour * 60 + parts.minute;
  const start = Math.min(DAY_END - 50, Math.max(DAY_START, minute - 20));
  return { start, end: Math.min(DAY_END, start + 50) };
}

/** Earliest callbacks favor morning and the original contact time, then the buckets rotate. The minute varies inside the bucket. Priority calls can land on a weekend. */
export function scheduleCallback(input: {
  from: Date;
  index: number;
  contactAt: Date | null;
  priority: boolean;
  varyKey: string;
}): string {
  const bucket = BUCKETS[Math.max(0, input.index) % BUCKETS.length];
  const window = bucket === "contact" ? contactWindow(input.contactAt) : { start: WINDOW[bucket][0], end: WINDOW[bucket][1] };
  const minute = window.start + vary(`${input.varyKey}:${bucket}`, Math.max(1, window.end - window.start));
  let day = chicagoDay(input.from);
  for (let hop = 0; hop < 14; hop += 1) {
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
    const weekend = dow === 0 || dow === 6;
    if (weekend && !input.priority) {
      day = shiftDay(day, 1);
      continue;
    }
    const iso = chicagoLocalToIso(`${day}T${clock(minute)}`);
    if (new Date(iso).getTime() + 60_000 >= input.from.getTime()) return iso;
    day = shiftDay(day, 1);
  }
  return input.from.toISOString();
}

export function weekendCallAllowed(date: Date, priority: boolean): boolean {
  const dow = chicagoParts(date).dow;
  if (dow !== 0 && dow !== 6) return true;
  return priority;
}
