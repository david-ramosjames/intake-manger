import { matchStaff, type StaffPerson } from "./identity";

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
