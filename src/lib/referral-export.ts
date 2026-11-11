import type { SupabaseClient } from "@supabase/supabase-js";
import { ExportInputError } from "@/lib/lead-export";
import { practiceAreaLabel } from "@/lib/referrals";
import { chicagoDay, chicagoParts } from "@/lib/time";

const PAGE = 1000;
const MAX_ROWS = 20000;

const COLUMNS = [
  "Client",
  "Phone",
  "Email",
  "Case type",
  "Referral type",
  "Referred to",
  "Firm phone",
  "Language",
  "Sent at (Chicago)",
  "Recorded by",
  "How",
  "Note",
] as const;

type Destination = { name: string | null; phone: string | null };
type LeadBits = {
  lead_name: string | null;
  phone: string | null;
  phone_e164: string | null;
  email: string | null;
  case_type: string | null;
  practice_area: string | null;
};
type SendRow = {
  id: string;
  created_at: string;
  actor: string | null;
  note: string | null;
  language: string | null;
  message: string | null;
  attorney_name: string | null;
  referral_destinations: Destination | Destination[] | null;
  leads: LeadBits | LeadBits[] | null;
};

export function referralExportFilename(now = new Date()): string {
  return `referred-clients-${chicagoDay(now)}.csv`;
}

export function referralsToCsv(rows: string[][]): string {
  const lines = [COLUMNS, ...rows].map((row) => row.map(csvCell).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/** One row per referral text or already-sent record. The firm is the directory name, or the typed attorney when no firm was selected. */
export async function loadReferralExport(supabase: SupabaseClient): Promise<string[][]> {
  const rows: string[][] = [];
  let fetched = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("referral_sends")
      .select(
        "id, created_at, actor, note, language, message, attorney_name, referral_destinations(name, phone), leads(lead_name, phone, phone_e164, email, case_type, practice_area)",
      )
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(fetched, fetched + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as SendRow[];
    fetched += batch.length;
    for (const send of batch) rows.push(referralCells(send));
    if (batch.length < PAGE) return rows;
    if (fetched >= MAX_ROWS) {
      throw new ExportInputError("That export is larger than 20,000 referrals.");
    }
  }
}

function referralCells(send: SendRow): string[] {
  const firm = one(send.referral_destinations);
  const lead = one(send.leads);
  const area = text(lead?.practice_area);
  return [
    text(lead?.lead_name),
    text(lead?.phone_e164 || lead?.phone),
    text(lead?.email),
    text(lead?.case_type),
    area ? practiceAreaLabel(area) : "",
    text(firm?.name || send.attorney_name),
    text(firm?.phone),
    languageLabel(send.language),
    chicagoStamp(send.created_at),
    text(send.actor),
    text(send.message) ? "Text" : "Already sent",
    text(send.note),
  ];
}

function one<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function languageLabel(value: string | null): string {
  const language = text(value).toLowerCase();
  if (language === "en") return "English";
  if (language === "es") return "Spanish";
  return text(value);
}

function chicagoStamp(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return text(value).slice(0, 10);
  const parts = chicagoParts(date);
  const pad = (part: number) => String(part).padStart(2, "0");
  const hour = parts.hour % 12 || 12;
  const suffix = parts.hour >= 12 ? "PM" : "AM";
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${hour}:${pad(parts.minute)} ${suffix}`;
}

function text(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function csvCell(value: string): string {
  let cell = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (/^[=+\-@]/.test(cell)) cell = `'${cell}`;
  if (/[",\n]/.test(cell)) return `"${cell.replaceAll('"', '""')}"`;
  return cell;
}
