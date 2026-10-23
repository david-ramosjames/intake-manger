"use client";

import { useState } from "react";
import { ButtonLabel } from "@/components/ButtonLabel";
import { caseTypeChoices, emailIsUnavailable, EMAIL_NOT_AVAILABLE, SOURCE_TYPE_OPTIONS, standardLeadEmail } from "@/lib/leads";
import { getCategoriesForType, getSourcesForCategory, isSourceCategory, type SourceCategory, type SourceType } from "@/lib/source-options";
import { DECLINE_TAGS, SIZE_TAGS } from "@/lib/tags";
import { buttonPrimary } from "@/lib/ui";

function isNextRedirect(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    String((err as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
  );
}

function YesNo({
  label,
  value,
  disabled = false,
  onChange,
}: {
  label: string;
  value: "" | "yes" | "no";
  disabled?: boolean;
  onChange: (value: "yes" | "no") => void;
}) {
  const side = "flex h-9 min-w-0 flex-1 items-center justify-center text-sm font-medium disabled:cursor-not-allowed disabled:text-slate-400";
  return (
    <div className="flex overflow-hidden rounded-lg border border-slate-300 bg-white" role="group" aria-label={label}>
      <button type="button" disabled={disabled} onClick={() => onChange("yes")} className={`${side} border-r border-slate-300 ${value === "yes" ? "bg-emerald-50 text-emerald-900" : "text-slate-600"}`}>
        {value === "yes" ? "✓ Yes" : "Yes"}
      </button>
      <button type="button" disabled={disabled} onClick={() => onChange("no")} className={`${side} ${value === "no" ? "bg-slate-200 text-slate-900" : "text-slate-600"}`}>
        {value === "no" ? "✓ No" : "No"}
      </button>
    </div>
  );
}

const fieldClass = "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-400";

export function AddLeadForm({
  action,
  defaultDate,
}: {
  action: (formData: FormData) => Promise<{ error: string } | void>;
  defaultDate: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [sourceType, setSourceType] = useState<SourceType | "">("");
  const [sourceCategory, setSourceCategory] = useState<SourceCategory | "">("");
  const [leadSource, setLeadSource] = useState("");
  const [caseType, setCaseType] = useState("");
  const [consulted, setConsulted] = useState<"" | "yes" | "no">("");
  const [qualified, setQualified] = useState<"" | "yes" | "no">("");
  const [desired, setDesired] = useState<"" | "yes" | "no">("");
  const [size, setSize] = useState("");
  const [decline, setDecline] = useState("");
  const [signed, setSigned] = useState<"" | "yes" | "no">("");
  const nonPi = caseType === "Non-PI Legal Matter";
  const qualifiedValue = nonPi ? "no" : qualified;
  const desiredValue = nonPi || qualifiedValue === "no" ? "no" : desired;
  const declineValue = nonPi ? "DEC: Non-PI Legal Matter" : desiredValue === "no" ? decline : "";
  const sizeValue = desiredValue === "yes" ? size : "";

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        data.set("email", standardLeadEmail(email) ?? "");
        data.set("source_type", sourceType);
        data.set("source_category", sourceCategory);
        data.set("lead_source", leadSource);
        data.set("case_type", caseType);
        data.set("consulted", consulted);
        data.set("qualified_decision", qualifiedValue);
        data.set("desired_decision", desiredValue);
        data.set("decline_tag", declineValue);
        data.set("size_tag", sizeValue);
        data.set("signed_decision", signed);
        setPending(true);
        setError(null);
        Promise.resolve(action(data))
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
      <section className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Name</span>
          <input name="lead_name" required className={fieldClass} />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Phone</span>
          <input name="phone" required inputMode="tel" className={fieldClass} />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Email</span>
          <input value={email} autoComplete="off" onChange={(event) => setEmail(event.target.value)} placeholder="Optional" className={fieldClass} />
          {emailIsUnavailable(email) ? null : (
            <button type="button" onClick={() => setEmail(EMAIL_NOT_AVAILABLE)} className="mt-1 text-xs font-medium text-navy underline">
              N/A
            </button>
          )}
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Date</span>
          <input name="lead_date" type="date" defaultValue={defaultDate} className={fieldClass} />
        </label>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <h2 className="sm:col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Marketing</h2>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Source type</span>
          <select
            value={sourceType}
            onChange={(event) => {
              const next = event.target.value as SourceType | "";
              setSourceType(next);
              setSourceCategory("");
              setLeadSource("");
            }}
            className={fieldClass}
          >
            <option value="">Not set</option>
            {SOURCE_TYPE_OPTIONS.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Source category</span>
          <select
            value={sourceCategory}
            disabled={!sourceType}
            onChange={(event) => {
              const next = isSourceCategory(event.target.value) ? event.target.value : "";
              setSourceCategory(next);
              setLeadSource("");
            }}
            className={fieldClass}
          >
            <option value="">{sourceType ? "Not set" : "Pick source type first"}</option>
            {sourceType ? getCategoriesForType(sourceType).map((item) => (
              <option key={item} value={item}>{item}</option>
            )) : null}
          </select>
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="font-medium text-slate-700">Lead source</span>
          <select value={leadSource} disabled={!sourceCategory} onChange={(event) => setLeadSource(event.target.value)} className={fieldClass}>
            <option value="">{sourceCategory ? "Not set" : "Pick category first"}</option>
            {sourceType && sourceCategory ? getSourcesForCategory(sourceType, sourceCategory).map((item) => (
              <option key={item} value={item}>{item}</option>
            )) : null}
          </select>
        </label>
      </section>

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Case type</h2>
        <select
          value={caseType}
          onChange={(event) => {
            const next = event.target.value;
            setCaseType(next);
            if (next !== "Non-PI Legal Matter") return;
            setConsulted("no");
            setQualified("no");
            setDesired("no");
            setSize("");
            setDecline("DEC: Non-PI Legal Matter");
          }}
          className={fieldClass}
        >
          <option value="">Not set</option>
          {caseTypeChoices().map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <h2 className="sm:col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Consultation</h2>
        <YesNo label="Consultation" value={consulted} onChange={(value) => setConsulted(value)} />
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Consultation date</span>
          <input name="consultation_date" type="date" disabled={consulted !== "yes"} className={fieldClass} />
        </label>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <h2 className="sm:col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Qualified</h2>
        <YesNo label="Qualified" value={qualifiedValue} disabled={nonPi} onChange={(value) => {
          setQualified(value);
          if (value === "no") {
            setDesired("no");
            setSize("");
          }
        }} />
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <h2 className="sm:col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Desired</h2>
        <YesNo
          label="Desired"
          value={desiredValue}
          disabled={nonPi || qualifiedValue === "no"}
          onChange={(value) => {
            setDesired(value);
            if (value === "yes") setDecline("");
            if (value === "no") setSize("");
          }}
        />
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Size</span>
          <select value={sizeValue} disabled={desiredValue !== "yes"} onChange={(event) => setSize(event.target.value)} className={fieldClass}>
            <option value="">{desiredValue === "yes" ? "Choose a size" : "Locked"}</option>
            {SIZE_TAGS.map((tag) => (
              <option key={tag} value={tag}>{tag.slice("S: ".length)}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Decline reason</span>
          <select value={declineValue} disabled={desiredValue !== "no" || nonPi} onChange={(event) => setDecline(event.target.value)} className={fieldClass}>
            <option value="">{desiredValue === "no" ? "Choose a reason" : "Locked"}</option>
            {DECLINE_TAGS.map((tag) => (
              <option key={tag} value={tag}>{tag.slice("DEC: ".length)}</option>
            ))}
          </select>
        </label>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <h2 className="sm:col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Signed</h2>
        <YesNo label="Signed" value={signed} onChange={setSigned} />
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Signed date</span>
          <input name="date_signed" type="date" disabled={signed !== "yes"} className={fieldClass} />
        </label>
      </section>

      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      <button type="submit" disabled={pending} className={buttonPrimary}>
        <ButtonLabel value={pending ? "Adding…" : "Add lead"} reserve={["Adding…", "Add lead"]} />
      </button>
    </form>
  );
}
