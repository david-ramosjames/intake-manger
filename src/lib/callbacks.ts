import { DEFAULT_WORK_HOURS, type WorkHours } from "./sequences";
import { callDayOpen, chicagoDay, chicagoLocalToIso, chicagoParts } from "./time";

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

function contactMinute(contactAt: Date | null): number | null {
  if (!contactAt || Number.isNaN(contactAt.getTime())) return null;
  const parts = chicagoParts(contactAt);
  return parts.hour * 60 + parts.minute;
}

/**
 * Match last contact keeps the contact's clock time when it falls in business hours.
 * A time before 8:30 AM or after 5:30 PM moves to the next window, morning, and a minute is chosen there.
 */
function minuteForLastContact(contactAt: Date | null, varyKey: string, avoid: number[]): number {
  const contact = contactMinute(contactAt);
  if (contact != null && contact >= DAY_START && contact < DAY_END) {
    if (!avoid.some((taken) => Math.abs(taken - contact) < 5)) return contact;
    return minuteInWindow(Math.max(DAY_START, contact - 20), Math.min(DAY_END, contact + 21), `${varyKey}:contact`, avoid);
  }
  const [start, end] = WINDOW.morning;
  return minuteInWindow(start, end, `${varyKey}:morning`, avoid);
}

/**
 * Place a callback inside Morning, Lunch, or Afternoon.
 * Closed days come from the sequence hours. Priority does not open Saturday or Sunday.
 */
export function scheduleCallback(input: {
  from: Date;
  window?: string | null;
  index?: number;
  contactAt: Date | null;
  priority: boolean;
  varyKey: string;
  avoid?: number[];
  hours?: WorkHours;
}): string {
  const hours = input.hours ?? DEFAULT_WORK_HOURS;
  const chosen = isCallbackWindow(input.window) ? input.window : windowForIndex(input.index ?? 0);
  const avoid = input.avoid ?? [];
  const minute =
    chosen === "contact"
      ? minuteForLastContact(input.contactAt, input.varyKey, avoid)
      : minuteInWindow(...WINDOW[chosen], `${input.varyKey}:${chosen}`, avoid);
  let day = chicagoDay(input.from);
  for (let hop = 0; hop < 14; hop += 1) {
    if (!callDayOpen(day, hours)) {
      day = shiftDay(day, 1);
      continue;
    }
    const iso = chicagoLocalToIso(`${day}T${clock(minute)}`);
    if (new Date(iso).getTime() + 60_000 >= input.from.getTime()) return iso;
    day = shiftDay(day, 1);
  }
  return input.from.toISOString();
}

export function weekendCallAllowed(date: Date, hours: WorkHours = DEFAULT_WORK_HOURS): boolean {
  const parts = chicagoParts(date);
  const day = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  return callDayOpen(day, hours);
}

export function chicagoMinute(iso: string): number | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = chicagoParts(date);
  return parts.hour * 60 + parts.minute;
}

/** Morning / lunch / afternoon bucket for a Chicago clock minute. */
export function dayPartForMinute(minute: number | null): "morning" | "lunch" | "afternoon" | null {
  if (minute == null || !Number.isFinite(minute)) return null;
  if (minute >= WINDOW.morning[0] && minute < WINDOW.morning[1]) return "morning";
  if (minute >= WINDOW.lunch[0] && minute < WINDOW.lunch[1]) return "lunch";
  if (minute >= WINDOW.afternoon[0] && minute < WINDOW.afternoon[1]) return "afternoon";
  return null;
}

/** True when both times sit in the same morning/lunch/afternoon slot on the same Chicago day. */
export function sameCallWindow(aMs: number, bMs: number): boolean {
  if (!Number.isFinite(aMs) || !Number.isFinite(bMs)) return false;
  const a = new Date(aMs);
  const b = new Date(bMs);
  if (chicagoDay(a) !== chicagoDay(b)) return false;
  const part = dayPartForMinute(chicagoMinute(a.toISOString()));
  if (!part) return false;
  return part === dayPartForMinute(chicagoMinute(b.toISOString()));
}
