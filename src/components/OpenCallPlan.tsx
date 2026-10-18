"use client";

import { completeOpenCall, saveCallbackPlan } from "@/lib/ops-actions";
import type { StaffPerson } from "@/lib/identity";
import { chicagoLocalInput } from "@/lib/time";
import { buttonSecondary } from "@/lib/ui";

export function OpenCallPlan({
  jobId,
  dueAt,
  assignedName,
  consultName,
  staff,
}: {
  jobId: string;
  dueAt: string;
  assignedName: string;
  consultName: string;
  staff: StaffPerson[];
}) {
  const selected = assignedName || consultName || "";
  return (
    <div>
      <form action={saveCallbackPlan} className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input type="hidden" name="job_id" value={jobId} />
        <label className="text-xs text-slate-600">
          When
          <input
            name="due_at"
            type="datetime-local"
            required
            defaultValue={chicagoLocalInput(dueAt)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900"
          />
        </label>
        <label className="text-xs text-slate-600">
          Tag
          <select
            name="assigned_name"
            defaultValue={selected}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900"
          >
            <option value="">Outbound (today’s #lead-calls)</option>
            {consultName && !staff.some((person) => person.name === consultName) ? (
              <option value={consultName}>{consultName} (consult)</option>
            ) : null}
            {staff.map((person) => (
              <option key={person.name} value={person.name}>
                {person.name}
                {person.name === consultName ? " (consult)" : ""}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={`${buttonSecondary} mt-5 self-start`}>
          Save
        </button>
      </form>
      <form action={completeOpenCall} className="mt-2">
        <input type="hidden" name="job_id" value={jobId} />
        <button type="submit" className="text-sm font-medium text-navy underline hover:text-accent">
          Mark complete
        </button>
      </form>
    </div>
  );
}
