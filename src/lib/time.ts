import { DEFAULT_WORK_HOURS, type WorkHours } from "@/lib/sequences";

const ZONE = "America/Chicago";

export function formatChicago(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function formatCallWhen(value: string | null | undefined): string {
  if (!value) return "No call";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No call";
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  const day = chicagoDay(date);
  const today = chicagoDay(new Date());
  if (day === today) return `Today ${time}`;
  if (day === shiftDay(today, 1)) return `Tomorrow ${time}`;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("weekday")} ${pick("month")} ${pick("day")} ${time}`;
}

function shiftDay(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, date + days));
  return next.toISOString().slice(0, 10);
}

export function chicagoDay(value: string | Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value instanceof Date ? value : new Date(value));
}

/** datetime-local values are Central wall time. The server clock is not. */
export function chicagoLocalToIso(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error("Choose a callback date and time.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(utcGuess));
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const shown = Date.UTC(pick("year"), pick("month") - 1, pick("day"), pick("hour"), pick("minute"));
  return new Date(utcGuess - (shown - utcGuess)).toISOString();
}

type ChicagoParts = { year: number; month: number; day: number; hour: number; minute: number; dow: number };

function chicagoParts(date: Date): ChicagoParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = pick("weekday");
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  const hour = Number(pick("hour"));
  return {
    year: Number(pick("year")),
    month: Number(pick("month")),
    day: Number(pick("day")),
    hour: hour === 24 ? 0 : hour,
    minute: Number(pick("minute")),
    dow,
  };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function windowFor(dow: number, hours: WorkHours): { start: number; end: number } | null {
  if (dow === 0) {
    if (hours.sundayStart == null || hours.sundayEnd == null) return null;
    return { start: hours.sundayStart, end: hours.sundayEnd };
  }
  if (dow === 6) {
    if (hours.saturdayStart == null || hours.saturdayEnd == null) return null;
    return { start: hours.saturdayStart, end: hours.saturdayEnd };
  }
  return { start: hours.weekdayStart, end: hours.weekdayEnd };
}

function clock(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** True when this instant is inside the sequence's open window. */
export function withinWorkHours(date: Date, hours: WorkHours = DEFAULT_WORK_HOURS): boolean {
  const parts = chicagoParts(date);
  const window = windowFor(parts.dow, hours);
  if (!window) return false;
  const minute = parts.hour * 60 + parts.minute;
  return minute >= window.start && minute < window.end;
}

/** Move a call to the next open minute for this sequence. Times already inside the window stay put. */
export function snapToWorkHours(iso: string, hours: WorkHours = DEFAULT_WORK_HOURS): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return iso;
  const parts = chicagoParts(instant);
  const minute = parts.hour * 60 + parts.minute;
  for (let add = 0; add < 8; add += 1) {
    const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + add));
    const window = windowFor(shifted.getUTCDay(), hours);
    if (!window) continue;
    if (add === 0) {
      if (minute >= window.start && minute < window.end) return instant.toISOString();
      if (minute >= window.end) continue;
    }
    const day = `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
    return chicagoLocalToIso(`${day}T${clock(window.start)}`);
  }
  return instant.toISOString();
}
