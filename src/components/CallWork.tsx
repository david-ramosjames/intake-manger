import { claimCall, recordCallOutcome } from "@/lib/ops-actions";
import { CALL_OUTCOMES } from "@/lib/calls";

export function CallWork({
  jobId,
  assignedEmail,
  viewerEmail,
}: {
  jobId: string;
  assignedEmail: string | null;
  viewerEmail: string;
}) {
  const mine = assignedEmail === viewerEmail;
  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span>{assignedEmail ? `Owner ${assignedEmail}` : "Unassigned"}</span>
        {mine ? (
          <span className="rounded-full bg-slate-900 px-2 py-0.5 text-white">Yours</span>
        ) : (
          <form action={claimCall}>
            <input type="hidden" name="job_id" value={jobId} />
            <button type="submit" className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs">
              {assignedEmail ? "Take over" : "Claim"}
            </button>
          </form>
        )}
      </div>
      <form action={recordCallOutcome} className="grid gap-2 sm:grid-cols-2">
        <input type="hidden" name="job_id" value={jobId} />
        <label className="text-xs text-slate-700">
          Outcome
          <select name="outcome" required className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm">
            <option value="">What happened</option>
            {CALL_OUTCOMES.map((outcome) => (
              <option key={outcome.id} value={outcome.id}>
                {outcome.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-700">
          Callback time, Central
          <input name="callback_at" type="datetime-local" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs text-slate-700 sm:col-span-2">
          Note
          <input name="note" placeholder="What they said, or why it is a callback" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-700 sm:col-span-2">
          <input type="checkbox" name="stop_rest" value="yes" />
          Stop the remaining calls on this lead
        </label>
        <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white sm:col-span-2 sm:w-fit">
          Record outcome
        </button>
      </form>
    </div>
  );
}
