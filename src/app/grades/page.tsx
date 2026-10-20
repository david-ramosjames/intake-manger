import Link from "next/link";
import { isWorkLead } from "@/lib/caller-class";
import { averageCallGrade, callGradeClass } from "@/lib/call-grade";
import { requireStaff } from "@/lib/session";
import { chicagoDay, formatChicago } from "@/lib/time";

export const metadata = { title: "Call grades · Intake Manager" };

type GradeRow = {
  id: string;
  call_id: string;
  lead_id: string | null;
  handler_name: string | null;
  grade: string;
  score: number | null;
  reason: string | null;
  track: string | null;
  direction: string | null;
  quo_link: string | null;
  occurred_at: string;
  leads: { caller_class: string | null } | { caller_class: string | null }[] | null;
};

function shiftDay(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

function dayLabel(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, date)),
  );
}

export default async function CallGradesPage({
  searchParams,
}: {
  searchParams: Promise<{ user?: string }>;
}) {
  const params = await searchParams;
  const { supabase } = await requireStaff();
  const since = new Date(Date.now() - 28 * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("call_grades")
    .select("id, call_id, lead_id, handler_name, grade, score, reason, track, direction, quo_link, occurred_at, leads(caller_class)")
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(500);
  const rows = ((data ?? []) as GradeRow[]).filter((row) => {
    const lead = Array.isArray(row.leads) ? row.leads[0] : row.leads;
    return Boolean(row.lead_id) && isWorkLead({ caller_class: lead?.caller_class });
  });
  const names = [...new Set(rows.map((row) => row.handler_name || "Unknown"))].sort((a, b) => a.localeCompare(b));
  const selected = params.user && names.includes(params.user) ? params.user : "";
  const shown = selected ? rows.filter((row) => (row.handler_name || "Unknown") === selected) : rows;
  const today = chicagoDay(new Date());
  const days = Array.from({ length: 14 }, (_, index) => shiftDay(today, index - 13));
  const byDay = new Map<string, GradeRow[]>();
  for (const row of shown) byDay.set(chicagoDay(row.occurred_at), [...(byDay.get(chicagoDay(row.occurred_at)) ?? []), row]);
  const overall = averageCallGrade(shown.map((row) => row.score ?? NaN));

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight text-navy">Call grades</h1>
      <p className="mt-1 max-w-3xl text-sm text-slate-600">
        Each intake call is graded from the transcript after it ends. The day average is the mean score for that person, the same way the daily intake report averages a day.
      </p>
      {error ? <p className="mt-4 text-sm text-red-700">{error.message}</p> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/grades" className={`rounded-full px-3 py-1 text-sm ${selected ? "bg-white text-slate-700 ring-1 ring-slate-200" : "bg-navy text-white"}`}>
          Everyone
        </Link>
        {names.map((name) => (
          <Link
            key={name}
            href={`/grades?user=${encodeURIComponent(name)}`}
            className={`rounded-full px-3 py-1 text-sm ${selected === name ? "bg-navy text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}
          >
            {name}
          </Link>
        ))}
      </div>

      <section className="mt-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Daily average · last 14 days</h2>
          <p className="text-sm text-slate-600">
            {overall ? (
              <>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${callGradeClass(overall.letter)}`}>{overall.letter}</span>
                <span className="ml-2 tabular-nums">{overall.score}</span>
                <span className="text-slate-400"> · {shown.length} calls</span>
              </>
            ) : (
              "No graded calls in the last 28 days"
            )}
          </p>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-7">
          {days.map((day) => {
            const average = averageCallGrade((byDay.get(day) ?? []).map((row) => row.score ?? NaN));
            const count = byDay.get(day)?.length ?? 0;
            return (
              <div key={day} className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-center">
                <p className="text-[10px] uppercase tracking-wide text-slate-400">{dayLabel(day)}</p>
                <p className={`mt-1 text-lg font-semibold ${average ? "" : "text-slate-300"}`}>
                  {average ? <span className={`inline-flex rounded-full px-2 py-0.5 text-sm ${callGradeClass(average.letter)}`}>{average.letter}</span> : "—"}
                </p>
                <p className="mt-1 text-[11px] tabular-nums text-slate-500">{average ? average.score : ""}{count ? ` · ${count}` : ""}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Calls</h2>
        {shown.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Graded calls will show here after the next intake call ends.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {shown.map((row) => (
              <li key={row.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${callGradeClass(row.grade)}`}>{row.grade}</span>
                  <span className="font-medium text-slate-900">{row.handler_name || "Unknown"}</span>
                  <span className="text-slate-400">{formatChicago(row.occurred_at)}</span>
                  {row.score != null ? <span className="tabular-nums text-slate-500">{row.score}</span> : null}
                  {row.track === "other" ? <span className="text-xs text-slate-400">Other</span> : null}
                  {row.lead_id ? (
                    <Link href={`/leads/${row.lead_id}`} className="text-navy underline">
                      Lead
                    </Link>
                  ) : null}
                  {row.quo_link ? (
                    <a href={row.quo_link} className="text-navy underline" target="_blank" rel="noreferrer">
                      Quo
                    </a>
                  ) : null}
                </div>
                {row.reason ? <p className="mt-1 text-slate-700">{row.reason}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
