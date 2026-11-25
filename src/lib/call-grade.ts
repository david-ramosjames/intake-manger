import { Pool } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import { handlersFromLegs, isSharedSeat, type HandlerLeg } from "./call-handlers";
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

export function consultationOrQualified(input: {
  consultation?: string | null;
  consultation_date?: string | null;
  qualified?: boolean | null;
}): boolean {
  if (input.qualified === true) return true;
  const consultation = (input.consultation ?? "").trim().toLowerCase();
  if (consultation === "no") return false;
  if (consultation) return true;
  return /^\d{4}-\d{2}-\d{2}/.test((input.consultation_date ?? "").slice(0, 10));
}

/** A saved name wins. The person who answered or placed the call is the screener. Intake is filled only when the calls show who did it. */
export function leadHandlerNames(input: {
  screenStored?: string | null;
  intakeStored?: string | null;
  gradedScreen?: string | null;
  gradedIntake?: string | null;
  ownerName?: string | null;
  arrival?: string | null;
  consultation?: string | null;
  consultationDate?: string | null;
  qualified?: boolean | null;
  staff: StaffPerson[];
}): { screenBy: string | null; intakeBy: string | null } {
  const person = (value: string | null | undefined) => matchStaff(value, input.staff)?.name ?? null;
  const answered = input.arrival === "human_call" || input.arrival === "qualified_call" ? person(input.ownerName) : null;
  const gradedScreen = person(input.gradedScreen);
  const screenBy = person(input.screenStored) || gradedScreen || answered;
  const needsIntake = consultationOrQualified({ ...input, consultation_date: input.consultationDate });
  // A graded screen with no graded intake means the calls did not identify intake. Do not copy the screener.
  const intakeBy = person(input.intakeStored) || person(input.gradedIntake) || (needsIntake && !gradedScreen ? screenBy : null);
  return { screenBy, intakeBy };
}

/** Quo user id → staff name. Shared seats (Intake Specialist, Attorney 1) use the staff email. A real Quo name is not rewritten. */
async function quoHandlerNames(supabase: SupabaseClient): Promise<Map<string, string>> {
  const [users, staff] = await Promise.all([listQuoUsers(), loadStaff(supabase)]);
  const byEmail = new Map<string, string>();
  for (const person of staff) {
    const email = person.email?.trim().toLowerCase() || "";
    if (!email || byEmail.has(email)) continue;
    byEmail.set(email, person.name);
  }
  const byId = new Map<string, string>();
  for (const user of users) {
    const email = user.email?.trim().toLowerCase() || "";
    const named = matchStaff(user.name, staff)?.name ?? null;
    const fromSeat = !named && isSharedSeat(user.name) && email ? byEmail.get(email) ?? null : null;
    const preferred = named || fromSeat;
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
    const jobs = isCallJob(row.jobs) ? row.jobs : null;
    const screen = jobs === "intake" ? null : fromQuo || named(row.screen_handler_name) || named(row.handler_name);
    const intakeName = jobs === "intake" ? fromQuo || named(row.intake_handler_name) || named(row.handler_name) : named(row.intake_handler_name);
    if (!current.screenBy && screen) current.screenBy = screen;
    if (intakeName && intakeName !== screen && !current.intakeBy) current.intakeBy = intakeName;
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
  await applyPhoneCallHandlers(supabase, leadIds, byLead, nameById);
  return byLead;
}

const FIRM_PHONES = new Set(["5125373369", "9563137771", "5126010647", "5125005266", "5126300907", "5127643037"]);

function last10(value: string | null | undefined): string {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

function callActor(direction: string, answeredBy: string | null, userId: string | null): string | null {
  const incoming = /in/i.test(direction);
  const id = (incoming ? answeredBy : userId || answeredBy) || "";
  if (!id || id.startsWith("SY")) return null;
  return id;
}

type PhoneCall = { at: number; phone: string; actorId: string; seconds: number };

async function phoneCalls(sinceIso: string, phones: Set<string>): Promise<PhoneCall[]> {
  const connectionString = process.env.REPORTING_DATABASE_URL?.trim();
  if (!connectionString || !phones.size) return [];
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);
  const pool = new Pool({
    connectionString,
    ssl: local ? false : { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 8000,
  });
  try {
    const query = pool.query<{
      direction: string | null;
      duration_sec: number | null;
      user_id: string | null;
      answered_by: string | null;
      created_at: Date | string;
      participants: unknown;
    }>(
      `SELECT direction, duration_sec, user_id, answered_by, created_at,
              payload_json #> '{data,object,participants}' AS participants
       FROM quo_calls
       WHERE created_at >= $1
         AND status = 'completed'
         AND COALESCE(duration_sec, 0) >= 15
         AND EXISTS (
           SELECT 1
           FROM jsonb_array_elements_text(
             CASE
               WHEN jsonb_typeof(payload_json #> '{data,object,participants}') = 'array'
               THEN payload_json #> '{data,object,participants}'
               ELSE '[]'::jsonb
             END
           ) AS participant
           WHERE right(regexp_replace(participant, '\\D', '', 'g'), 10) = ANY($2::text[])
         )`,
      [sinceIso, [...phones]],
    );
    const { rows } = await Promise.race([
      query,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("call lookup timed out")), 8000)),
    ]);
    const calls: PhoneCall[] = [];
    for (const row of rows) {
      const actorId = callActor(row.direction || "", row.answered_by, row.user_id);
      const at = new Date(row.created_at).getTime();
      if (!actorId || !Number.isFinite(at)) continue;
      const list = Array.isArray(row.participants) ? row.participants : [];
      for (const item of list) {
        const phone = last10(typeof item === "string" ? item : "");
        if (!phone || FIRM_PHONES.has(phone) || !phones.has(phone)) continue;
        calls.push({ at, phone, actorId, seconds: Number(row.duration_sec) || 0 });
      }
    }
    return calls;
  } catch {
    return [];
  } finally {
    await pool.end();
  }
}

async function applyPhoneCallHandlers(
  supabase: SupabaseClient,
  leadIds: string[],
  byLead: Map<string, LeadCallJobs>,
  nameById: Map<string, string>,
) {
  if (!leadIds.length || !process.env.REPORTING_DATABASE_URL?.trim()) return;
  const leads: {
    id: string;
    phone: string;
    createdAt: number;
    needsIntake: boolean;
  }[] = [];
  for (let index = 0; index < leadIds.length; index += 100) {
    const chunk = leadIds.slice(index, index + 100);
    const { data, error } = await supabase
      .from("leads")
      .select("id, phone, phone_e164, created_at, consultation, consultation_date, qualified")
      .in("id", chunk);
    if (error) return;
    for (const row of data ?? []) {
      const phone = last10(row.phone_e164 || row.phone);
      const createdAt = new Date(row.created_at || 0).getTime();
      if (!phone || !Number.isFinite(createdAt)) continue;
      leads.push({
        id: String(row.id),
        phone,
        createdAt,
        needsIntake: consultationOrQualified(row),
      });
    }
  }
  if (!leads.length) return;
  const earliest = Math.min(...leads.map((lead) => lead.createdAt)) - 2 * 60 * 60 * 1000;
  const since = new Date(Math.max(earliest, Date.now() - 45 * 24 * 60 * 60 * 1000)).toISOString();
  const calls = await phoneCalls(since, new Set(leads.map((lead) => lead.phone)));
  const byPhone = new Map<string, typeof leads>();
  for (const lead of leads) {
    const list = byPhone.get(lead.phone) ?? [];
    list.push(lead);
    byPhone.set(lead.phone, list);
  }
  for (const list of byPhone.values()) list.sort((a, b) => a.createdAt - b.createdAt);
  const legs = new Map<string, HandlerLeg[]>();
  for (const call of calls) {
    const candidates = (byPhone.get(call.phone) ?? []).filter((lead) => call.at >= lead.createdAt - 2 * 60 * 60 * 1000);
    const lead = candidates.length ? candidates[candidates.length - 1] : null;
    if (!lead || call.at > lead.createdAt + 45 * 24 * 60 * 60 * 1000) continue;
    const name = nameById.get(call.actorId);
    if (!name) continue;
    const list = legs.get(lead.id) ?? [];
    list.push({ at: call.at, name, seconds: call.seconds });
    legs.set(lead.id, list);
  }
  for (const lead of leads) {
    const found = handlersFromLegs(legs.get(lead.id) ?? [], lead.needsIntake);
    if (!found.screen && !found.intake) continue;
    const current = byLead.get(lead.id) ?? { screenBy: null, intakeBy: null };
    if (found.screen) current.screenBy = found.screen;
    if (found.intake && !current.intakeBy) current.intakeBy = found.intake;
    byLead.set(lead.id, current);
  }
}

/** Save screener and intake when the calls identify them and the lead is still blank. */
export async function fillOutstandingCallHandlers(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase
    .from("leads")
    .select("id, screen_by, intake_by, consultation, consultation_date, qualified")
    .eq("test", false)
    .not("lead_status", "in", "(Signed,Promoted,Lost,Referred)")
    .or("screen_by.is.null,intake_by.is.null")
    .order("created_at", { ascending: false })
    .limit(80);
  if (error) throw new Error(error.message);
  const leads = (data ?? []).filter((lead) => !lead.screen_by || (consultationOrQualified(lead) && !lead.intake_by));
  if (!leads.length) return 0;
  const jobs = await loadLeadCallJobs(supabase, leads.map((lead) => String(lead.id)));
  let filled = 0;
  for (const lead of leads) {
    const suggested = jobs.get(String(lead.id));
    if (!suggested) continue;
    let wrote = false;
    if (!lead.screen_by && suggested.screenBy) {
      const { error: updateError } = await supabase
        .from("leads")
        .update({ screen_by: suggested.screenBy })
        .eq("id", lead.id)
        .is("screen_by", null);
      if (!updateError) wrote = true;
    }
    if (!lead.intake_by && suggested.intakeBy && consultationOrQualified(lead)) {
      const { error: updateError } = await supabase
        .from("leads")
        .update({ intake_by: suggested.intakeBy })
        .eq("id", lead.id)
        .is("intake_by", null);
      if (!updateError) wrote = true;
    }
    if (wrote) filled += 1;
  }
  return filled;
}

export async function stampLeadHandlers(
  supabase: SupabaseClient,
  lead: {
    id: string;
    screen_by?: string | null;
    intake_by?: string | null;
    consultation?: string | null;
    consultation_date?: string | null;
    qualified?: boolean | null;
    owner_name?: string | null;
    arrival?: string | null;
  },
): Promise<void> {
  if (lead.screen_by?.trim() && (lead.intake_by?.trim() || !consultationOrQualified(lead))) return;
  const [jobs, staff] = await Promise.all([
    loadLeadCallJobs(supabase, [lead.id]).catch(() => new Map<string, LeadCallJobs>()),
    loadStaff(supabase),
  ]);
  const suggested = jobs.get(lead.id);
  const named = leadHandlerNames({
    gradedScreen: suggested?.screenBy,
    gradedIntake: suggested?.intakeBy,
    ownerName: lead.owner_name,
    arrival: lead.arrival,
    consultation: lead.consultation,
    consultationDate: lead.consultation_date,
    qualified: lead.qualified,
    staff,
  });
  if (!lead.screen_by?.trim() && named.screenBy) {
    const { error } = await supabase.from("leads").update({ screen_by: named.screenBy }).eq("id", lead.id).is("screen_by", null);
    if (!error) lead.screen_by = named.screenBy;
  }
  if (!lead.intake_by?.trim() && named.intakeBy && consultationOrQualified(lead)) {
    const { error } = await supabase.from("leads").update({ intake_by: named.intakeBy }).eq("id", lead.id).is("intake_by", null);
    if (!error) lead.intake_by = named.intakeBy;
  }
}
