import type { SupabaseClient } from "@supabase/supabase-js";
import { loadStaff, matchStaff, type StaffPerson } from "./identity";
import { listQuoUsers } from "./quo-settings";

export type CallJob = "screen" | "intake" | "both";

export function letterForScore(score: number): "A" | "B" | "C" | "D" | "F" {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

export function callGradeClass(letter: string): string {
  if (letter === "A") return "bg-emerald-50 text-emerald-800";
  if (letter === "B") return "bg-sky-50 text-sky-800";
  if (letter === "C") return "bg-amber-50 text-amber-900";
  if (letter === "D") return "bg-orange-50 text-orange-900";
  return "bg-red-50 text-red-800";
}

/** Activity header color: screen green, intake blue, both pink. */
export function callJobHeaderClass(jobs: string | null | undefined): string {
  if (jobs === "screen") return "text-emerald-700";
  if (jobs === "intake") return "text-sky-700";
  if (jobs === "both") return "text-pink-700";
  return "text-slate-800";
}

export function isCallJob(value: string | null | undefined): value is CallJob {
  return value === "screen" || value === "intake" || value === "both";
}

export function callJobLabel(jobs: string | null | undefined): string | null {
  if (jobs === "screen") return "Screen";
  if (jobs === "intake") return "Intake";
  if (jobs === "both") return "Screen + intake";
  return null;
}

export function averageCallGrade(scores: number[]): { score: number; letter: "A" | "B" | "C" | "D" | "F" } | null {
  const usable = scores.filter((score) => Number.isFinite(score));
  if (!usable.length) return null;
  const score = Math.round(usable.reduce((sum, value) => sum + value, 0) / usable.length);
  return { score, letter: letterForScore(score) };
}

export type LeadCallJobs = {
  screenBy: string | null;
  intakeBy: string | null;
};

/** A saved name wins. A graded call is next. A person who answered a live call fills screening, and intake when that call was a consultation. */
export function leadHandlerNames(input: {
  screenStored?: string | null;
  intakeStored?: string | null;
  gradedScreen?: string | null;
  gradedIntake?: string | null;
  ownerName?: string | null;
  arrival?: string | null;
  consultation?: string | null;
  staff: StaffPerson[];
}): { screenBy: string | null; intakeBy: string | null } {
  const person = (value: string | null | undefined) => matchStaff(value, input.staff)?.name ?? null;
  const answered = input.arrival === "human_call" || input.arrival === "qualified_call" ? person(input.ownerName) : null;
  const screenBy = person(input.screenStored) || person(input.gradedScreen) || answered;
  const consulted = Boolean(input.consultation && input.consultation !== "no");
  const intakeBy = person(input.intakeStored) || person(input.gradedIntake) || (consulted ? screenBy : null);
  return { screenBy, intakeBy };
}

/** Quo user id → display name (staff directory by email when the Quo seat name is generic). */
async function quoHandlerNames(supabase: SupabaseClient): Promise<Map<string, string>> {
  const [users, contacts] = await Promise.all([
    listQuoUsers(),
    supabase.from("contacts").select("name, email, listed").eq("listed", true),
  ]);
  if (contacts.error) throw new Error(contacts.error.message);
  const byEmail = new Map<string, string>();
  for (const row of contacts.data ?? []) {
    const email = String(row.email || "")
      .trim()
      .toLowerCase();
    const name = String(row.name || "").trim();
    if (!email || !name || /^(referred|legal assistant)$/i.test(name)) continue;
    byEmail.set(email, name);
  }
  const byId = new Map<string, string>();
  for (const user of users) {
    const email = user.email?.trim().toLowerCase() || "";
    const preferred = (email && byEmail.get(email)) || user.name.trim();
    if (preferred) byId.set(user.id, preferred);
  }
  return byId;
}

/** Earliest screen and intake handlers per lead — Quo answeredBy only, never transcript guesses. */
export async function loadLeadCallJobs(
  supabase: SupabaseClient,
  leadIds: string[],
): Promise<Map<string, LeadCallJobs>> {
  const byLead = new Map<string, LeadCallJobs>();
  if (!leadIds.length) return byLead;
  type GradeRow = {
    call_id: string | null;
    lead_id: string | null;
    jobs: string | null;
    screen_handler_name: string | null;
    intake_handler_name: string | null;
    handler_name: string | null;
    occurred_at: string | null;
  };
  const chunks: string[][] = [];
  for (let index = 0; index < leadIds.length; index += 100) chunks.push(leadIds.slice(index, index + 100));
  const [nameById, staff, ...pages] = await Promise.all([
    quoHandlerNames(supabase),
    loadStaff(supabase),
    ...chunks.map(async (chunk) => {
      const { data, error } = await supabase
        .from("call_grades")
        .select("call_id, lead_id, jobs, screen_handler_name, intake_handler_name, handler_name, occurred_at")
        .in("lead_id", chunk)
        .order("occurred_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as GradeRow[];
    }),
  ]);
  const rows = pages.flat();
  rows.sort((a, b) => String(a.occurred_at || "").localeCompare(String(b.occurred_at || "")));
  const callIds = [...new Set(rows.map((row) => row.call_id).filter(Boolean))] as string[];
  const answeredBy = new Map<string, string>();
  for (let index = 0; index < callIds.length; index += 100) {
    const chunk = callIds.slice(index, index + 100);
    const { data, error } = await supabase.from("quo_inbox_calls").select("call_id, answered_by").in("call_id", chunk);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const id = String(row.call_id || "");
      const who = String(row.answered_by || "").trim();
      if (id && who && !who.startsWith("SY")) answeredBy.set(id, who);
    }
  }
  const named = (value: string | null | undefined) => matchStaff(value, staff)?.name ?? null;

  for (const row of rows) {
    if (!row.lead_id) continue;
    const current = byLead.get(row.lead_id) ?? { screenBy: null, intakeBy: null };
    const quoId = row.call_id ? answeredBy.get(row.call_id) : null;
    const fromQuo = quoId ? named(nameById.get(quoId)) : null;
    const jobs = isCallJob(row.jobs) ? row.jobs : "both";
    const screen = jobs === "screen" || jobs === "both" ? fromQuo || named(row.screen_handler_name) || named(row.handler_name) : null;
    const intake = jobs === "intake" || jobs === "both" ? fromQuo || named(row.intake_handler_name) || named(row.handler_name) : null;
    if (!current.screenBy && screen) current.screenBy = screen;
    if (!current.intakeBy && intake) current.intakeBy = intake;
    byLead.set(row.lead_id, current);
  }

  const unresolved = leadIds.filter((id) => !byLead.get(id)?.screenBy);
  const callByLead = new Map<string, string>();
  for (let index = 0; index < unresolved.length; index += 100) {
    const chunk = unresolved.slice(index, index + 100);
    const { data, error } = await supabase.from("leads").select("id, intake_call_id").in("id", chunk);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const callId = String(row.intake_call_id || "").trim();
      if (callId) callByLead.set(String(row.id), callId);
    }
  }
  const extraCallIds = [...new Set(callByLead.values())].filter((id) => !answeredBy.has(id));
  for (let index = 0; index < extraCallIds.length; index += 100) {
    const chunk = extraCallIds.slice(index, index + 100);
    const { data, error } = await supabase.from("quo_inbox_calls").select("call_id, answered_by").in("call_id", chunk);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const id = String(row.call_id || "");
      const who = String(row.answered_by || "").trim();
      if (id && who && !who.startsWith("SY")) answeredBy.set(id, who);
    }
  }
  for (const [leadId, callId] of callByLead) {
    const name = named(nameById.get(answeredBy.get(callId) || ""));
    if (!name) continue;
    const current = byLead.get(leadId) ?? { screenBy: null, intakeBy: null };
    if (!current.screenBy) current.screenBy = name;
    byLead.set(leadId, current);
  }
  return byLead;
}
