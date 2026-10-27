"use client";

import { useState } from "react";
import { savePropertyDamageGuides } from "@/lib/ops-actions";

export function PropertyDamageGuidesForm({ en, es }: { en: string; es: string }) {
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="mt-6 grid gap-3 rounded-lg border border-slate-200 bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setPending(true);
        setSaved(false);
        setError(null);
        void savePropertyDamageGuides(data)
          .then(() => {
            setSaved(true);
          })
          .catch((err) => {
            setError(err instanceof Error ? err.message : "Could not save the guide links.");
          })
          .finally(() => {
            setPending(false);
          });
      }}
    >
      <h2 className="text-sm font-semibold text-navy">Property Damage guides</h2>
      <p className="text-sm text-slate-600">
        When staff chooses Property Damage on a referral, the text includes one of these PDF links instead of an attorney.
      </p>
      <label className="grid gap-1 text-sm font-medium text-slate-700" htmlFor="guide-en">
        English PDF link
        <input
          id="guide-en"
          name="property_damage_guide_url_en"
          type="text"
          inputMode="url"
          required
          defaultValue={en}
          placeholder="https://…"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
        />
      </label>
      <label className="grid gap-1 text-sm font-medium text-slate-700" htmlFor="guide-es">
        Spanish PDF link
        <input
          id="guide-es"
          name="property_damage_guide_url_es"
          type="text"
          inputMode="url"
          required
          defaultValue={es}
          placeholder="https://…"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal"
        />
      </label>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {saved && !error ? <p className="text-sm font-medium text-emerald-700">Guide links saved.</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm disabled:opacity-60"
      >
        {pending ? "Saving…" : saved ? "Saved" : "Save guide links"}
      </button>
    </form>
  );
}
