import Link from "next/link";
import { CadenceEditor } from "@/components/CadenceEditor";
import { saveSequenceHours, syncCallrailCatalog } from "@/lib/ops-actions";
import {
  cadenceFromSteps,
  CALL_SEQUENCES,
  CALL_SEQUENCE_DETAIL,
  CALL_SEQUENCE_LABEL,
  isCallSequence,
  loadWorkHours,
  minutesToClock,
  type CallSequenceId,
  type WorkHours,
} from "@/lib/sequences";
import { requireStaff } from "@/lib/session";

type Step = {
  sequence: string;
  queue: string;
  position: number;
  delay_minutes: number;
  callback_window: string | null;
};

export default async function SequencesPage({
  searchParams,
}: {
  searchParams: Promise<{ sequence?: string; saved?: string }>;
}) {
  const params = await searchParams;
  const sequence: CallSequenceId = isCallSequence(params.sequence) ? params.sequence : "first_talk";
  const { supabase } = await requireStaff();
  const [{ data: steps, error }, { data: tags }, hours] = await Promise.all([
    supabase.from("sequence_steps").select("sequence, queue, position, delay_minutes, callback_window").order("position"),
    supabase.from("callrail_tags").select("name").order("name"),
    loadWorkHours(supabase),
  ]);
  const rows = ((steps ?? []) as Step[]).filter((step) => step.sequence === sequence);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight text-navy">Sequences</h1>
      <p className="mt-1 max-w-3xl text-sm text-slate-600">
        {CALL_SEQUENCE_LABEL[sequence]}. {CALL_SEQUENCE_DETAIL[sequence]} A lead can move to another sequence,
        and that sequence starts over at its own day 1. A callback stays inside the chosen window. Match last
        contact keeps that time when it was during business hours.
      </p>
      {error ? <p className="mt-3 text-sm text-red-700">{error.message}</p> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {CALL_SEQUENCES.map((id) => (
          <Link
            key={id}
            href={`/sequences?sequence=${id}`}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              id === sequence ? "bg-navy text-white" : "border border-slate-300 bg-white text-slate-700"
            }`}
          >
            {CALL_SEQUENCE_LABEL[id]}
          </Link>
        ))}
      </div>

      <div className="mt-4">
        <CadenceEditor key={`${sequence}-${params.saved ?? "edit"}`} sequence={sequence} initial={cadenceFromSteps(rows)} saved={Boolean(params.saved)} />
      </div>

      <details className="mt-4 rounded-xl border border-slate-200 bg-white px-5 py-4">
        <summary className="cursor-pointer text-sm font-medium text-slate-700">More options</summary>
        <p className="mt-2 text-xs text-slate-500">
          Slack call reminders post during these hours. The callback itself is still placed in the morning, lunch, or afternoon window.
        </p>
        <HoursForm sequence={sequence} hours={hours[sequence]} />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold">CallRail tags</h2>
          <form action={syncCallrailCatalog}>
            <button type="submit" className="rounded border border-slate-300 px-2 py-1 text-xs">
              Pull from CallRail
            </button>
          </form>
        </div>
        <p className="mt-1 text-xs leading-5 text-slate-600">
          {(tags ?? []).map((tag) => (tag as { name: string }).name).join(", ") || "No tags pulled yet."}
        </p>
      </details>
    </main>
  );
}

function HoursForm({ sequence, hours }: { sequence: CallSequenceId; hours: WorkHours }) {
  return (
    <form action={saveSequenceHours} className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      <input type="hidden" name="sequence" value={sequence} />
      <span className="text-slate-600">Mon–Fri</span>
      <TimeRange name="weekday" start={hours.weekdayStart} end={hours.weekdayEnd} />
      <DayToggle name="saturday" label="Sat" start={hours.saturdayStart} end={hours.saturdayEnd} />
      <DayToggle name="sunday" label="Sun" start={hours.sundayStart} end={hours.sundayEnd} />
      <button type="submit" className="rounded bg-brand px-2 py-1 text-xs font-medium text-navy">
        Save hours
      </button>
    </form>
  );
}

function TimeRange({ name, start, end }: { name: string; start: number; end: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      <input name={`${name}_start`} type="time" required defaultValue={minutesToClock(start)} className="rounded border border-slate-300 px-1 py-0.5" />
      <span className="text-slate-400">–</span>
      <input name={`${name}_end`} type="time" required defaultValue={minutesToClock(end)} className="rounded border border-slate-300 px-1 py-0.5" />
    </span>
  );
}

function DayToggle({
  name,
  label,
  start,
  end,
}: {
  name: string;
  label: string;
  start: number | null;
  end: number | null;
}) {
  const open = start != null && end != null;
  return (
    <span className="inline-flex items-center gap-1">
      <label className="inline-flex items-center gap-1 text-slate-600">
        <input type="checkbox" name={`${name}_open`} value="yes" defaultChecked={open} />
        {label}
      </label>
      <TimeRange name={name} start={start ?? 8 * 60} end={end ?? 18 * 60} />
    </span>
  );
}
