import { addSequenceStep, removeSequenceStep, saveSequenceStep, syncCallrailCatalog } from "@/lib/ops-actions";
import {
  CALL_SEQUENCES,
  CALL_SEQUENCE_DETAIL,
  CALL_SEQUENCE_LABEL,
  splitDelay,
  type CallSequenceId,
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
  const [{ data: steps, error }, { data: tags }] = await Promise.all([
    supabase
      .from("sequence_steps")
      .select("id, sequence, queue, position, delay_minutes")
      .order("position"),
    supabase.from("callrail_tags").select("name").order("name"),
  ]);
  const rows = (steps ?? []) as Step[];

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Sequences</h1>
      <p className="mt-1 text-sm leading-6 text-slate-600">
        Set the call timing for each kind of lead. That timing is the next call. Text timing is listed
        here so the plan is in one place. SMS Follow-Up still sends the texts.         When posting is on, a due call is posted in that lead’s Slack thread with the Quo Router bot
        and tags the Lead named in the channel topic. It stays open until the call log shows a call.
        Turn posting on from How it fits.
      </p>
      {error ? <p className="mt-4 text-sm text-red-700">{error.message}</p> : null}

      <div className="mt-8 space-y-10">
        {CALL_SEQUENCES.map((sequence) => (
          <section key={sequence}>
            <h2 className="text-lg font-semibold">{CALL_SEQUENCE_LABEL[sequence]}</h2>
            <p className="mt-1 text-sm text-slate-600">{CALL_SEQUENCE_DETAIL[sequence]}</p>
            <StepList sequence={sequence} queue="call" title="Calls" rows={rows} />
            <StepList sequence={sequence} queue="text" title="Texts" rows={rows} />
          </section>
        ))}
      </div>

      <section className="mt-10">
        <h2 className="text-sm font-semibold">CallRail tags</h2>
        <p className="mt-1 text-sm text-slate-600">
          Tags saved on a lead use these names. When a lead has a CallRail call id, saving the tags
          writes them back to that call.
        </p>
        <form action={syncCallrailCatalog} className="mt-3">
          <button type="submit" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">
            Pull tags from CallRail
          </button>
        </form>
        <p className="mt-3 text-sm text-slate-700">
          {(tags ?? []).map((tag) => (tag as { name: string }).name).join(", ") || "No tags pulled yet."}
        </p>
      </section>
    </main>
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
    <div className="mt-4">
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      {queue === "text" ? (
        <p className="mt-1 text-xs text-slate-500">Listed for the plan. SMS Follow-Up sends these.</p>
      ) : null}
      <div className="mt-2 space-y-2">
        {steps.length === 0 ? <p className="text-sm text-slate-500">No steps yet.</p> : null}
        {steps.map((step, index) => {
          const delay = splitDelay(step.delay_minutes);
          return (
            <div key={step.id} className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3">
              <p className="w-16 pb-2 text-sm font-medium">Step {index + 1}</p>
              <form action={saveSequenceStep} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="id" value={step.id} />
                <label className="text-sm">
                  <span className="font-medium text-slate-700">Days</span>
                  <input
                    name="days"
                    type="number"
                    min={0}
                    defaultValue={delay.days}
                    className="mt-1 block w-24 rounded-md border border-slate-300 px-3 py-2"
                  />
                </label>
                <label className="text-sm">
                  <span className="font-medium text-slate-700">Hours</span>
                  <input
                    name="hours"
                    type="number"
                    min={0}
                    max={23}
                    defaultValue={delay.hours}
                    className="mt-1 block w-24 rounded-md border border-slate-300 px-3 py-2"
                  />
                </label>
                <button type="submit" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">
                  Save
                </button>
              </form>
              <form action={removeSequenceStep}>
                <input type="hidden" name="id" value={step.id} />
                <button type="submit" className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700">
                  Remove
                </button>
              </form>
            </div>
          );
        })}
      </div>
      <form action={addSequenceStep} className="mt-2">
        <input type="hidden" name="sequence" value={sequence} />
        <input type="hidden" name="queue" value={queue} />
        <button type="submit" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">
          Add {queue === "call" ? "call" : "text"}
        </button>
      </form>
    </div>
  );
}
