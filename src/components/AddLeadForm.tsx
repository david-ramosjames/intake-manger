"use client";

import { useState, type ReactNode } from "react";
import { ButtonLabel } from "@/components/ButtonLabel";
import { caseTypeChoices, emailIsUnavailable, EMAIL_NOT_AVAILABLE, nameIsUnavailable, SOURCE_TYPE_OPTIONS, standardLeadEmail } from "@/lib/leads";
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
  allowTbd = false,
  onChange,
  onTbd,
}: {
  label: string;
  value: "" | "yes" | "no" | "tbd";
  disabled?: boolean;
  allowTbd?: boolean;
  onChange: (value: "yes" | "no") => void;
  onTbd?: () => void;
}) {
  const side = "flex h-8 cursor-pointer items-center justify-center px-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:text-slate-400";
  return (
    <div className={`inline-flex h-8 w-fit overflow-hidden rounded-md border border-slate-300 bg-white ${disabled ? "bg-slate-100" : ""}`} role="group" aria-label={label}>
      {allowTbd ? (
        <button type="button" disabled={disabled} onClick={() => onTbd?.()} className={`${side} border-r border-slate-300 ${value === "tbd" ? "bg-amber-50 text-amber-950" : "text-slate-600"}`}>
          {value === "tbd" ? "✓ TBD" : "TBD"}
        </button>
      ) : null}
      <button type="button" disabled={disabled} onClick={() => onChange("yes")} className={`${side} border-r border-slate-300 ${value === "yes" ? "bg-emerald-50 text-emerald-900" : "text-slate-600"}`}>
        {value === "yes" ? "✓ Yes" : "Yes"}
      </button>
      <button type="button" disabled={disabled} onClick={() => onChange("no")} className={`${side} ${value === "no" ? "bg-slate-200 text-slate-900" : "text-slate-600"}`}>
        {value === "no" ? "✓ No" : "No"}
      </button>
    </div>
  );
}

const fieldClass = "h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      <div className="mt-2 flex flex-col gap-2">{children}</div>
    </section>
  );
}

function Fields({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 items-end gap-x-3 gap-y-2">{children}</div>;
}

function Pair({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-end gap-3">{children}</div>;
}

function Label({ label, children, wide = false, className = "" }: { label: string; children: ReactNode; wide?: boolean; className?: string }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 text-xs font-medium uppercase tracking-wide text-slate-500 ${wide ? "col-span-2" : ""} ${className}`}>
      <span>{label}</span>
      {children}
    </label>
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
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [sourceType, setSourceType] = useState<SourceType | "">("");
  const [sourceCategory, setSourceCategory] = useState<SourceCategory | "">("");
  const [leadSource, setLeadSource] = useState("");
  const [caseType, setCaseType] = useState("");
  const [consulted, setConsulted] = useState<"" | "yes" | "no">("");
  const [qualified, setQualified] = useState<"" | "yes" | "no">("");
  const [desired, setDesired] = useState<"" | "yes" | "no" | "tbd">("tbd");
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
      className="space-y-3"
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
      <Section title="Contact">
        <Fields>
        <Label label="Name">
          <input name="lead_name" required value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} />
          {nameIsUnavailable(name) ? null : (
            <button type="button" onClick={() => setName(EMAIL_NOT_AVAILABLE)} className="w-fit text-[11px] font-medium normal-case tracking-normal text-navy underline">
              N/A
            </button>
          )}
        </Label>
        <Label label="Phone">
          <input name="phone" required inputMode="tel" className={fieldClass} />
        </Label>
        <Label label="Email">
          <input value={email} autoComplete="off" onChange={(event) => setEmail(event.target.value)} placeholder="Optional" className={fieldClass} />
          {emailIsUnavailable(email) ? null : (
            <button type="button" onClick={() => setEmail(EMAIL_NOT_AVAILABLE)} className="w-fit text-[11px] font-medium normal-case tracking-normal text-navy underline">
              N/A
            </button>
          )}
        </Label>
        <Label label="Date">
          <input name="lead_date" type="date" defaultValue={defaultDate} className={fieldClass} />
        </Label>
        </Fields>
      </Section>

      <Section title="Marketing">
        <Fields>
        <Label label="Source type">
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
        </Label>
        <Label label="Source category">
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
        </Label>
        <Label label="Lead source" wide>
          <select value={leadSource} disabled={!sourceCategory} onChange={(event) => setLeadSource(event.target.value)} className={fieldClass}>
            <option value="">{sourceCategory ? "Not set" : "Pick category first"}</option>
            {sourceType && sourceCategory ? getSourcesForCategory(sourceType, sourceCategory).map((item) => (
              <option key={item} value={item}>{item}</option>
            )) : null}
          </select>
        </Label>
        <Label label="Case type" wide>
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
        </Label>
        </Fields>
      </Section>

      <Section title="Consultation">
        <Pair>
          <YesNo label="Consultation" value={consulted} onChange={(value) => setConsulted(value)} />
          <Label label="Consultation date" className="w-36">
            <input name="consultation_date" type="date" disabled={consulted !== "yes"} className={fieldClass} />
          </Label>
        </Pair>
      </Section>

      <Section title="Qualified">
        <YesNo label="Qualified" value={qualifiedValue} disabled={nonPi} onChange={(value) => {
          setQualified(value);
          if (value === "no") {
            setDesired("no");
            setSize("");
          }
        }} />
      </Section>

      <Section title="Desired">
        <Pair>
          <YesNo
            label="Desired"
            value={desiredValue}
            disabled={nonPi || qualifiedValue === "no"}
            allowTbd
            onChange={(value) => {
              setDesired(value);
              if (value === "yes") setDecline("");
              if (value === "no") setSize("");
            }}
            onTbd={() => {
              setDesired("tbd");
              setDecline("");
              setSize("");
            }}
          />
          <Label label="Size" className="w-36">
            <select value={sizeValue} disabled={desiredValue !== "yes"} onChange={(event) => setSize(event.target.value)} className={fieldClass}>
              <option value="">{desiredValue === "yes" ? "Choose a size" : "Locked"}</option>
              {SIZE_TAGS.map((tag) => (
                <option key={tag} value={tag}>{tag.slice("S: ".length)}</option>
              ))}
            </select>
          </Label>
        </Pair>
        <Label label="Decline reason" className="max-w-xs">
          <select value={declineValue} disabled={desiredValue !== "no" || nonPi} onChange={(event) => setDecline(event.target.value)} className={fieldClass}>
            <option value="">{desiredValue === "no" ? "Choose a reason" : "Locked"}</option>
            {DECLINE_TAGS.map((tag) => (
              <option key={tag} value={tag}>{tag.slice("DEC: ".length)}</option>
            ))}
          </select>
        </Label>
      </Section>

      <Section title="Signed">
        <Pair>
          <YesNo label="Signed" value={signed} onChange={setSigned} />
          <Label label="Signed date" className="w-36">
            <input name="date_signed" type="date" disabled={signed !== "yes"} className={fieldClass} />
          </Label>
        </Pair>
      </Section>

      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      <button type="submit" disabled={pending} className={buttonPrimary}>
        <ButtonLabel value={pending ? "Adding…" : "Add lead"} reserve={["Adding…", "Add lead"]} />
      </button>
    </form>
  );
}
