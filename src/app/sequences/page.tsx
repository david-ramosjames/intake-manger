import { addSequenceStep, removeSequenceStep, saveSequenceHours, saveSequenceStep, syncCallrailCatalog } from "@/lib/ops-actions";
import {
  CALL_SEQUENCES,
  CALL_SEQUENCE_DETAIL,
  CALL_SEQUENCE_LABEL,
  loadWorkHours,
  minutesToClock,
  splitDelay,
  type CallSequenceId,
  type WorkHours,
} from "@/lib/sequences";
import { requireStaff } from "@/lib/session";

type Step = {
  id: string;
  sequence: string;
  queue: string;
  position: number;
  delay_minutes: number;
};

export default async function SequencesPage() {
  const { supabase } = await requireStaff();
  const [{ data: steps, error }, { data: tags }, hours] = await Promise.all([
    supabase.from("sequence_steps").select("id, sequence, queue, position, delay_minutes").order("position"),
    supabase.from("callrail_tags").select("name").order("name"),
    loadWorkHours(supabase),
  ]);
  const rows = (steps ?? []) as Step[];

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight">Sequences</h1>
      <p className="mt-1 text-sm text-slate-600">
        Call timing for each kind of lead. Texts are listed here, and SMS Follow-Up still sends them. A Slack
        reminder waits until that sequence’s hours.
      </p>
      {error ? <p className="mt-3 text-sm text-red-700">{error.message}</p> : null}

      <div className="mt-4 space-y-3">
        {CALL_SEQUENCES.map((sequence) => (
          <section key={sequence} className="rounded-lg border border-slate-200 bg-white px-3 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className="font-semibold">{CALL_SEQUENCE_LABEL[sequence]}</h2>
              <p className="text-xs text-slate-500">{CALL_SEQUENCE_DETAIL[sequence]}</p>
            </div>
            <HoursForm sequence={sequence} hours={hours[sequence]} />
            <div className="mt-2 grid gap-3 md:grid-cols-2">
              <StepList sequence={sequence} queue="call" title="Calls" rows={rows} />
              <StepList sequence={sequence} queue="text" title="Texts" rows={rows} />
            </div>
          </section>
        ))}
      </div>

      <section className="mt-4">
        <div className="flex flex-wrap items-center gap-3">
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
      </section>
    </main>
  );
}

function HoursForm({ sequence, hours }: { sequence: CallSequenceId; hours: WorkHours }) {
  return (
    <form action={saveSequenceHours} className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <input type="hidden" name="sequence" value={sequence} />
      <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Hours</span>
      <span className="text-slate-600">Mon–Fri</span>
      <TimeRange name="weekday" start={hours.weekdayStart} end={hours.weekdayEnd} />
      <DayToggle name="saturday" label="Sat" start={hours.saturdayStart} end={hours.saturdayEnd} />
      <DayToggle name="sunday" label="Sun" start={hours.sundayStart} end={hours.sundayEnd} />
      <button type="submit" className="rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white">
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

function StepList({
  sequence,
  queue,
  title,
  rows,
}: {
  sequence: CallSequenceId;
  queue: "call" | "text";
  title: string;
  rows: Step[];
}) {
  const steps = rows
    .filter((row) => row.sequence === sequence && row.queue === queue)
    .sort((a, b) => a.position - b.position);
  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-slate-400">{title}</h3>
        <form action={addSequenceStep}>
          <input type="hidden" name="sequence" value={sequence} />
          <input type="hidden" name="queue" value={queue} />
          <button type="submit" className="text-xs font-medium text-slate-700 underline">
            Add
          </button>
        </form>
      </div>
      {queue === "text" ? <p className="text-xs text-slate-400">Listed only. SMS Follow-Up sends these.</p> : null}
      {steps.length === 0 ? <p className="mt-1 text-xs text-slate-400">None</p> : null}
      <ul className="mt-1 divide-y divide-slate-100">
        {steps.map((step, index) => {
          const delay = splitDelay(step.delay_minutes);
          return (
            <li key={step.id} className="flex items-center gap-2 py-1">
              <span className="w-4 text-xs text-slate-400">{index + 1}</span>
              <form action={saveSequenceStep} className="flex items-center gap-1">
                <input type="hidden" name="id" value={step.id} />
                <input
                  name="days"
                  type="number"
                  min={0}
                  defaultValue={delay.days}
                  aria-label="Days"
                  className="w-14 rounded border border-slate-300 px-1.5 py-0.5 text-sm"
                />
                <span className="text-xs text-slate-400">d</span>
                <input
                  name="hours"
                  type="number"
                  min={0}
                  max={23}
                  defaultValue={delay.hours}
                  aria-label="Hours"
                  className="w-14 rounded border border-slate-300 px-1.5 py-0.5 text-sm"
                />
                <span className="text-xs text-slate-400">h</span>
                <button type="submit" className="rounded bg-slate-900 px-2 py-0.5 text-xs font-medium text-white">
                  Save
                </button>
              </form>
              <form action={removeSequenceStep}>
                <input type="hidden" name="id" value={step.id} />
                <button type="submit" className="text-xs text-slate-500 underline">
                  Remove
                </button>
              </form>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
