"use client";

import { useState } from "react";
import { ButtonLabel } from "@/components/ButtonLabel";
import { completeOpenCall, saveCallbackPlan } from "@/lib/ops-actions";
import type { StaffPerson } from "@/lib/identity";
import { chicagoLocalInput } from "@/lib/time";
import { buttonSecondary } from "@/lib/ui";

function isNextRedirect(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    String((err as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
  );
}

export function OpenCallPlan({
  jobId,
  dueAt,
  assignedName,
  consultName,
  consulted,
  staff,
}: {
  jobId: string;
  dueAt: string;
  assignedName: string;
  consultName: string;
  consulted: boolean;
  staff: StaffPerson[];
}) {
  const selected = assignedName || (consulted ? consultName : "Outbound") || "";
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSave(formData: FormData) {
    setPending(true);
    setSaved(false);
    setError(null);
    try {
      await saveCallbackPlan(formData);
      setSaved(true);
      setPending(false);
    } catch (err) {
      if (isNextRedirect(err)) throw err;
      setError(err instanceof Error ? err.message : "Could not save");
      setPending(false);
    }
  }

  return (
    <div>
      <form action={onSave} className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input type="hidden" name="job_id" value={jobId} />
        <label className="text-xs text-slate-600">
          When
          <input
            name="due_at"
            type="datetime-local"
            required
            defaultValue={chicagoLocalInput(dueAt)}
            onChange={() => setSaved(false)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900"
          />
        </label>
        <label className="text-xs text-slate-600">
          Tag
          <select
            name="assigned_name"
            defaultValue={selected}
            onChange={() => setSaved(false)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900"
          >
            <option value="Outbound">Slack Outbound</option>
            {consulted ? <option value="">Choose who handled this</option> : null}
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
        <button
          type="submit"
          disabled={pending}
          className={`${buttonSecondary} mt-5 self-start ${saved && !pending ? "!border-emerald-600 !bg-emerald-600 !text-white" : ""}`}
        >
          <ButtonLabel value={pending ? "Saving…" : saved ? "✓ Saved" : "Save"} reserve={["Saving…", "✓ Saved", "Save"]} />
        </button>
        {error ? <p className="text-sm text-red-700 sm:col-span-3">{error}</p> : null}
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
