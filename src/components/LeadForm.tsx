"use client";

import { useState } from "react";
import { LEAD_ARRIVAL_LABEL, LEAD_KIND_LABEL, LEAD_SENTIMENT_LABEL, LEAD_STATUSES, type Lead, type LeadArrival, type LeadSentiment } from "@/lib/leads";

function isNextRedirect(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    String((err as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
  );
}

function dateValue(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "";
}

function triValue(value: boolean | null | undefined): string {
  if (value === true) return "yes";
  if (value === false) return "no";
  return "";
}

export function LeadForm({
  lead,
  action,
}: {
  lead?: Lead;
  action: (formData: FormData) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const statuses = new Set<string>(LEAD_STATUSES);
  if (lead?.lead_status) statuses.add(lead.lead_status);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    try {
      await action(formData);
    } catch (err) {
      if (isNextRedirect(err)) throw err;
      setError(err instanceof Error ? err.message : "Could not save");
      setPending(false);
    }
  }

  return (
    <form action={onSubmit} className="grid gap-4 sm:grid-cols-2">
      <Field label="Date" name="lead_date" type="date" defaultValue={dateValue(lead?.lead_date)} />
      <Field label="Lead name" name="lead_name" defaultValue={lead?.lead_name ?? ""} />
      <Field label="Phone" name="phone" defaultValue={lead?.phone ?? ""} />
      <Field label="Email" name="email" type="email" defaultValue={lead?.email ?? ""} />
      <Field label="Lead source" name="lead_source" defaultValue={lead?.lead_source ?? ""} />
      <Field label="Source type" name="source_type" defaultValue={lead?.source_type ?? ""} />
      <Field label="Case type" name="case_type" defaultValue={lead?.case_type ?? ""} />
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Lead status</span>
        <select
          name="lead_status"
          defaultValue={lead?.lead_status ?? "New"}
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"
        >
          {[...statuses].map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </label>
      <Field label="Consultation" name="consultation" defaultValue={lead?.consultation ?? ""} />
      <Field
        label="Consultation date"
        name="consultation_date"
        type="date"
        defaultValue={dateValue(lead?.consultation_date)}
      />
      <Tri label="Desired case" name="desired_case" defaultValue={triValue(lead?.desired_case)} />
      <Tri label="Signed case" name="signed_case" defaultValue={lead?.signed_case ? "yes" : "no"} />
      <Field label="Case number" name="case_number" defaultValue={lead?.case_number ?? ""} />
      <Field
        label="Date signed"
        name="date_signed"
        type="date"
        defaultValue={dateValue(lead?.date_signed)}
      />
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Grade</span>
        <select
          name="grade"
          defaultValue={lead?.grade ?? ""}
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"
        >
          <option value="">Not graded</option>
          <option value="A">A</option>
          <option value="B">B</option>
          <option value="C">C</option>
        </select>
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Sentiment</span>
        <select
          name="sentiment"
          defaultValue={lead?.sentiment ?? ""}
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"
        >
          <option value="">Not scored</option>
          {(Object.keys(LEAD_SENTIMENT_LABEL) as LeadSentiment[]).map((value) => (
            <option key={value} value={value}>
              {LEAD_SENTIMENT_LABEL[value]}
            </option>
          ))}
        </select>
      </label>
      <Field label="Handled by" name="owner_name" defaultValue={lead?.owner_name ?? ""} />
      <label className="block text-sm">
        <span className="font-medium text-slate-700">What this lead is</span>
        <select
          name="kind"
          defaultValue={lead?.kind ?? "pursue"}
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"
        >
          {Object.entries(LEAD_KIND_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">How they arrived</span>
        <select
          name="arrival"
          defaultValue={lead?.arrival ?? "manual"}
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"
        >
          {(Object.keys(LEAD_ARRIVAL_LABEL) as LeadArrival[]).map((value) => (
            <option key={value} value={value}>
              {LEAD_ARRIVAL_LABEL[value]}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm sm:col-span-2">
        <span className="font-medium text-slate-700">CallRail tags</span>
        <input
          name="callrail_tags"
          defaultValue={(lead?.callrail_tags ?? []).join(", ")}
          placeholder="Same names as in CallRail, separated by commas"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
        />
      </label>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="follow_up" value="yes" defaultChecked={lead ? lead.follow_up : true} />
        <span>Run the follow-up sequence. Want-to-sign leads get texts and calls. Need-more-info leads get calls only.</span>
      </label>
      <label className="block text-sm sm:col-span-2">
        <span className="font-medium text-slate-700">Why this grade</span>
        <textarea
          name="grade_reason"
          defaultValue={lead?.grade_reason ?? ""}
          rows={2}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
        />
      </label>
      <label className="block text-sm sm:col-span-2">
        <span className="font-medium text-slate-700">Why this sentiment</span>
        <textarea
          name="sentiment_reason"
          defaultValue={lead?.sentiment_reason ?? ""}
          rows={2}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
        />
      </label>
      <label className="block text-sm sm:col-span-2">
        <span className="font-medium text-slate-700">Summary</span>
        <textarea
          name="summary"
          defaultValue={lead?.summary ?? ""}
          rows={4}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
        />
      </label>
      {error ? <p className="text-sm text-red-700 sm:col-span-2">{error}</p> : null}
      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? "Saving…" : lead ? "Save changes" : "Add lead"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  defaultValue,
  type = "text",
}: {
  label: string;
  name: string;
  defaultValue: string;
  type?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
      />
    </label>
  );
}

function Tri({ label, name, defaultValue }: { label: string; name: string; defaultValue: string }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"
      >
        {name === "signed_case" ? null : <option value="">Unknown</option>}
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </label>
  );
}
