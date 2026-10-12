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

type ChicagoParts = { year: number; month: number; day: number; hour: number; dow: number };

function chicagoParts(date: Date): ChicagoParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = pick("weekday");
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  return {
    year: Number(pick("year")),
    month: Number(pick("month")),
    day: Number(pick("day")),
    hour: Number(pick("hour")),
    dow,
  };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Calls are placed on weekdays between 8:00am and 6:00pm Central. */
export function snapToWorkHours(iso: string): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return iso;
  const parts = chicagoParts(instant);
  const afterClose = parts.hour >= 18;
  const beforeOpen = parts.hour < 8;
  const sunday = parts.dow === 0;
  if (!sunday && !afterClose && !beforeOpen) return instant.toISOString();
  let addDays = 0;
  if (sunday) addDays = 1;
  else if (afterClose) addDays = parts.dow === 5 ? 3 : parts.dow === 6 ? 2 : 1;
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + addDays));
  const day = `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
  return chicagoLocalToIso(`${day}T09:00`);
}
