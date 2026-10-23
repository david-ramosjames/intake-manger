"use client";

import { useState } from "react";
import { ButtonLabel } from "@/components/ButtonLabel";
import { buttonPrimary } from "@/lib/ui";

function isNextRedirect(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    String((err as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
  );
}

export function AddLeadForm({
  action,
  defaultDate,
}: {
  action: (formData: FormData) => Promise<{ error: string } | void>;
  defaultDate: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        setPending(true);
        setError(null);
        Promise.resolve(action(new FormData(form)))
          .then((result) => {
            if (result?.error) setError(result.error);
          })
          .catch((err: unknown) => {
            if (isNextRedirect(err)) throw err;
            setError(err instanceof Error ? err.message : "Could not add the lead");
          })
          .finally(() => setPending(false));
      }}
    >
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Name</span>
        <input name="lead_name" required className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Phone</span>
        <input name="phone" required inputMode="tel" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Date</span>
        <input name="lead_date" type="date" required defaultValue={defaultDate} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
      </label>
      <div className="sm:col-span-2">
        {error ? <p className="mb-3 text-sm text-rose-700">{error}</p> : null}
        <button type="submit" disabled={pending} className={buttonPrimary}>
          <ButtonLabel value={pending ? "Adding…" : "Add lead"} reserve={["Adding…", "Add lead"]} />
        </button>
      </div>
    </form>
  );
}
