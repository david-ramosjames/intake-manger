import { chicagoDay, chicagoLocalToIso, chicagoParts } from "./time";

export const CALLBACK_WINDOWS = ["morning", "lunch", "afternoon", "contact"] as const;

export type CallbackWindow = (typeof CALLBACK_WINDOWS)[number];

const DAY_START = 8 * 60 + 30;
const DAY_END = 17 * 60 + 30;

const WINDOW = {
  morning: [DAY_START, 11 * 60 + 30],
  lunch: [11 * 60 + 30, 14 * 60 + 30],
  afternoon: [14 * 60 + 30, DAY_END],
} as const;

export function isCallbackWindow(value: string | null | undefined): value is CallbackWindow {
  return value === "morning" || value === "lunch" || value === "afternoon" || value === "contact";
}

/** The window that contains a clock time. Times outside 8:30–5:30 use the nearest window. */
export function windowForMinute(minute: number): "morning" | "lunch" | "afternoon" {
  if (minute < WINDOW.lunch[0]) return "morning";
  if (minute < WINDOW.afternoon[0]) return "lunch";
  return "afternoon";
}

export function windowForContact(contactAt: Date | null): "morning" | "lunch" | "afternoon" {
  if (!contactAt || Number.isNaN(contactAt.getTime())) return "morning";
  const parts = chicagoParts(contactAt);
  return windowForMinute(parts.hour * 60 + parts.minute);
}

export function windowForIndex(index: number): CallbackWindow {
  return CALLBACK_WINDOWS[Math.max(0, index) % CALLBACK_WINDOWS.length];
}

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

/** A minute inside the window. The same lead keeps its minute; different leads land on different minutes. */
function minuteInWindow(start: number, end: number, key: string, avoid: number[]): number {
  const span = Math.max(1, end - start);
  const first = start + vary(key, span);
  if (!avoid.length) return first;
  let best = first;
  let bestGap = Math.min(...avoid.map((taken) => Math.abs(taken - first)));
  for (let offset = 0; offset < span; offset += 5) {
    const minute = start + ((first - start + offset) % span);
    const gap = Math.min(...avoid.map((taken) => Math.abs(taken - minute)));
    if (gap > bestGap) {
      best = minute;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * Place a callback inside Morning, Lunch, Afternoon, or the same window as the last contact.
 * The minute varies inside that window. Priority calls can land on a weekend.
 */
export function scheduleCallback(input: {
  from: Date;
  window?: string | null;
  index?: number;
  contactAt: Date | null;
  priority: boolean;
  varyKey: string;
  avoid?: number[];
}): string {
  const chosen = isCallbackWindow(input.window) ? input.window : windowForIndex(input.index ?? 0);
  const bucket = chosen === "contact" ? windowForContact(input.contactAt) : chosen;
  const [start, end] = WINDOW[bucket];
  const minute = minuteInWindow(start, end, `${input.varyKey}:${bucket}`, input.avoid ?? []);
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

export function chicagoMinute(iso: string): number | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = chicagoParts(date);
  return parts.hour * 60 + parts.minute;
}
