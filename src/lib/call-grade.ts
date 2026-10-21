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
