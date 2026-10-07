import { saveSequenceStep, syncCallrailCatalog } from "@/lib/ops-actions";
import { requireStaff } from "@/lib/session";

export default async function SequencesPage() {
  const { supabase } = await requireStaff();
  const [{ data: steps, error }, { data: tags }] = await Promise.all([
    supabase.from("sequence_steps").select("id, queue, position, delay_minutes, body").order("queue").order("position"),
    supabase.from("callrail_tags").select("name").order("name"),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Sequences</h1>
      <p className="mt-1 text-sm text-slate-600">
        One text sequence and one call sequence. Texts run only for a lead we want to sign. Calls
        run for those leads and for a lead we have already spoken with but are not ready to decide.
        Use {"{{name}}"} and {"{{case_type}}"} in a text.
      </p>
      {error ? <p className="mt-4 text-sm text-red-700">{error.message}</p> : null}
      <div className="mt-6 space-y-4">
        {(steps ?? []).map((step) => {
          const row = step as { id: string; queue: string; position: number; delay_minutes: number; body: string };
          return (
            <form key={row.id} action={saveSequenceStep} className="rounded-lg border border-slate-200 bg-white p-4">
              <input type="hidden" name="id" value={row.id} />
              <p className="text-sm font-medium">
                {row.queue === "text" ? "Text" : "Call"} {row.position}
              </p>
              <label className="mt-3 block text-sm">
                <span className="font-medium text-slate-700">Minutes after follow-up starts</span>
                <input
                  name="delay_minutes"
                  type="number"
                  min={0}
                  defaultValue={row.delay_minutes}
                  className="mt-1 w-40 rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
              <textarea
                name="body"
                defaultValue={row.body}
                rows={3}
                className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <button type="submit" className="mt-3 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">
                Save step
              </button>
            </form>
          );
        })}
      </div>
      <section className="mt-8">
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
