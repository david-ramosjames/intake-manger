"use client";

import { useEffect, useState } from "react";
import { ButtonLabel } from "@/components/ButtonLabel";
import { buttonPrimary } from "@/lib/ui";
import { LeadTagFields } from "@/components/LeadTagFields";
import { milestoneDesired } from "@/lib/desired";
import { caseTypeChoices, emailIsUnavailable, EMAIL_NOT_AVAILABLE, isSourceType, LEAD_ARRIVAL_LABEL, LEAD_KIND_LABEL, LEAD_SENTIMENT_LABEL, LEAD_SOURCES, LEAD_STATUSES, SOURCE_CHANNELS, SOURCE_TYPE_OPTIONS, standardLeadEmail, type Lead, type LeadArrival, type LeadSentiment } from "@/lib/leads";

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
  staff = [],
}: {
  lead?: Lead;
  action: (formData: FormData) => Promise<void>;
  staff?: { name: string }[];
}) {
  const [email, setEmail] = useState(() => standardLeadEmail(lead?.email) ?? "");
  useEffect(() => {
    setEmail(standardLeadEmail(lead?.email) ?? "");
  }, [lead?.id, lead?.email]);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const statuses = new Set<string>(LEAD_STATUSES);
  if (lead?.lead_status) statuses.add(lead.lead_status);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setSaved(false);
    setError(null);
    try {
      await action(formData);
      setSaved(true);
      setPending(false);
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
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Email</span>
        <input
          name="email"
          value={email}
          autoComplete="off"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Optional"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
        />
        {emailIsUnavailable(email) ? null : (
          <button type="button" onClick={() => setEmail(EMAIL_NOT_AVAILABLE)} className="mt-1 text-xs font-medium text-navy underline">
            N/A
          </button>
        )}
      </label>
      <ChannelField value={lead?.source_channel ?? ""} />
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Lead source</span>
        <input
          name="lead_source"
          list="lead-source-examples"
          defaultValue={lead?.lead_source ?? ""}
          placeholder="Google, Friend, Attorney"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
        />
        <datalist id="lead-source-examples">
          {LEAD_SOURCES.map((item) => (
            <option key={item.source} value={item.source} />
          ))}
        </datalist>
      </label>
      <Field
        label="Source note"
        name="source_note"
        defaultValue={lead?.source_note ?? ""}
        placeholder="My friend gave me this number"
      />
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Source type</span>
        <select
          name="source_type"
          defaultValue={isSourceType(lead?.source_type) && lead.source_type !== "Unknown" ? lead.source_type : ""}
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"
        >
          <option value="">Not set</option>
          {SOURCE_TYPE_OPTIONS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>
      <CaseTypeField value={lead?.case_type ?? ""} />
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
        <span className="mt-1 block text-xs leading-5 text-slate-500">
          Open or closed. Consultation, qualified, desired, and signed are separate milestones below.
        </span>
      </label>
      <Field
        label="Consultation date"
        name="consultation_date"
        type="date"
        defaultValue={dateValue(lead?.consultation_date)}
      />
      <p className="text-xs leading-5 text-slate-500 sm:col-span-2">
        A consultation is a meaningful discussion of the potential case: the incident, responsibility, injuries, and treatment. Not every topic has to come up. A short injury question, a call that only scheduled one, or a brief workers' compensation inquiry that is referred out does not count.
        It can be a later day than the lead. Quo Router fills the first date from the call transcript. Leave it blank until that conversation happens.
      </p>
      <Tri
        label="Conversion desired"
        name="desired_case"
        defaultValue={triValue(lead ? milestoneDesired(lead) : null)}
        hint="Yes when the firm wants to sign. Sending a contract sets this to yes. You can mark yes before a contract goes out."
      />
      <Tri
        label="Signed"
        name="signed_case"
        defaultValue={lead?.signed_case ? "yes" : "no"}
        hint="Yes only after a person confirms the contract is complete. Some matters need more than one signature, so a contract marked complete is not enough on its own."
      />
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
          {(Object.keys(LEAD_SENTIMENT_LABEL) as LeadSentiment[])
            .sort((a, b) => LEAD_SENTIMENT_LABEL[a].localeCompare(LEAD_SENTIMENT_LABEL[b]))
            .map((value) => (
            <option key={value} value={value}>
              {LEAD_SENTIMENT_LABEL[value]}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm sm:col-span-1">
        <span className="font-medium text-slate-700">Slack tag</span>
        <select
          name="owner_name"
          defaultValue={lead?.owner_name && !/^(legal assistant|referred|sona|outbound)$/i.test(lead.owner_name) ? lead.owner_name : "Outbound"}
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"
        >
          <option value="Outbound">Slack Outbound</option>
          {staff
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((person) => (
            <option key={person.name} value={person.name}>
              {person.name}
            </option>
          ))}
          {lead?.owner_name && lead.owner_name !== "Outbound" && !/^(legal assistant|referred|sona)$/i.test(lead.owner_name) && !staff.some((person) => person.name === lead.owner_name) ? (
            <option value={lead.owner_name}>{lead.owner_name}</option>
          ) : null}
        </select>
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">What this lead is</span>
        <select
          name="kind"
          defaultValue={lead?.kind ?? "pursue"}
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"
        >
          {Object.entries(LEAD_KIND_LABEL)
            .sort((a, b) => a[1].localeCompare(b[1]))
            .map(([value, label]) => (
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
          {(Object.keys(LEAD_ARRIVAL_LABEL) as LeadArrival[])
            .sort((a, b) => LEAD_ARRIVAL_LABEL[a].localeCompare(LEAD_ARRIVAL_LABEL[b]))
            .map((value) => (
            <option key={value} value={value}>
              {LEAD_ARRIVAL_LABEL[value]}
            </option>
          ))}
        </select>
      </label>
      <div className="sm:col-span-2">
        <LeadTagFields
          tags={lead?.callrail_tags ?? []}
          declineReason={lead?.decline_reason ?? null}
          signed={Boolean(lead?.signed_case)}
          desired={Boolean(lead?.desired_case) || Boolean(lead?.signed_case)}
          nonPi={lead?.caller_class === "non_pi"}
          callrail={Boolean(lead?.callrail_call_id)}
        />
      </div>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="follow_up" value="yes" defaultChecked={lead ? lead.follow_up : true} />
        <span>Keep this lead in follow-up. Missed calls and form fills get the uncontacted call sequence. Texts stay with SMS Follow-Up.</span>
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
          className={buttonPrimary}
        >
          <ButtonLabel
            value={pending ? "Saving…" : saved ? "✓ Saved" : lead ? "Save changes" : "Add lead"}
            reserve={["Saving…", "✓ Saved", "Save changes", "Add lead"]}
          />
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
  placeholder,
}: {
  label: string;
  name: string;
  defaultValue: string;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
      />
    </label>
  );
}

function CaseTypeField({ value }: { value: string }) {
  const options = caseTypeChoices(value);
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-700">Case type</span>
      <select name="case_type" defaultValue={value === "Unknown / No Response" ? "" : value} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2">
        <option value="">Not set</option>
        {options.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
    </label>
  );
}

function ChannelField({ value }: { value: string }) {
  const options = [...new Set([value, ...SOURCE_CHANNELS].filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-700">Source</span>
      <select
        name="source_channel"
        defaultValue={value}
        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"
      >
        <option value="">Not set</option>
        {[...options].map((channel) => (
          <option key={channel} value={channel}>
            {channel}
          </option>
        ))}
      </select>
    </label>
  );
}

function Tri({
  label,
  name,
  defaultValue,
  hint,
}: {
  label: string;
  name: string;
  defaultValue: string;
  hint?: string;
}) {
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
      {hint ? <span className="mt-1 block text-xs leading-5 text-slate-500">{hint}</span> : null}
    </label>
  );
}
