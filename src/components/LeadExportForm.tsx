"use client";

import { useState } from "react";
import { PI_CASE_TYPES, SOURCE_TYPE_OPTIONS } from "@/lib/leads";
import { EXPORT_FIELDS, EXPORT_FIELD_GROUPS, type ExportFieldGroup } from "@/lib/lead-export";
import { buttonPrimary, buttonSecondary } from "@/lib/ui";

const selectClass = "mt-1 block h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900";

export function LeadExportForm({ owners }: { owners: string[] }) {
  const [fields, setFields] = useState(() => new Set(EXPORT_FIELDS.filter((field) => field.defaultOn).map((field) => field.id)));
  const [range, setRange] = useState("all");

  function toggle(id: string) {
    setFields((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function useFields(ids: string[]) {
    setFields(new Set(ids));
  }

  return (
    <form method="post" action="/export/download" className="mt-6 space-y-4">
      <section className="rounded-lg border border-slate-200 bg-white px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-navy">Fields</h2>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => useFields(EXPORT_FIELDS.filter((field) => field.defaultOn).map((field) => field.id))} className={buttonSecondary}>
              Normal fields
            </button>
            <button type="button" onClick={() => useFields(EXPORT_FIELDS.map((field) => field.id))} className={buttonSecondary}>
              All fields
            </button>
            <button type="button" onClick={() => useFields([])} className={buttonSecondary}>
              Clear
            </button>
          </div>
        </div>
        <div className="mt-4 space-y-4">
          {EXPORT_FIELD_GROUPS.map((group) => (
            <FieldGroup key={group} group={group} selected={fields} onToggle={toggle} />
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white px-4 py-4">
        <h2 className="text-sm font-semibold text-navy">Which leads</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Time frame
            <select name="range" value={range} onChange={(event) => setRange(event.target.value)} className={selectClass}>
              <option value="all">All time</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="month">This month</option>
              <option value="custom">Custom dates</option>
            </select>
          </label>
          {range === "custom" ? (
            <>
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                From
                <input type="date" name="from" required className={selectClass} />
              </label>
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Through
                <input type="date" name="to" required className={selectClass} />
              </label>
            </>
          ) : null}
          <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Records
            <select name="set" defaultValue="leads" className={selectClass}>
              <option value="leads">Leads</option>
              <option value="all">Leads and non-leads</option>
              <option value="nonleads">Non-leads</option>
            </select>
          </label>
          <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Status
            <select name="status" defaultValue="all" className={selectClass}>
              <option value="all">Any status</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
              <option value="New">New</option>
              <option value="Working">Working</option>
              <option value="Signed">Signed</option>
              <option value="Lost">Lost</option>
              <option value="Referred">Referred</option>
              <option value="Promoted">Promoted</option>
            </select>
          </label>
          <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Qualified
            <select name="qualified" defaultValue="any" className={selectClass}>
              <option value="any">Any</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
              <option value="unset">Not set</option>
            </select>
          </label>
          <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Desired
            <select name="desired" defaultValue="any" className={selectClass}>
              <option value="any">Any</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
              <option value="unset">Not set</option>
            </select>
          </label>
          <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Signed
            <select name="signed" defaultValue="any" className={selectClass}>
              <option value="any">Any</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
          <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Owner
            <select name="owner" defaultValue="" className={selectClass}>
              <option value="">Anyone</option>
              <option value="__none__">Unassigned</option>
              {owners.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <CheckList
          title="Case type"
          note="Every case type is included until you pick one."
          name="case_type"
          options={PI_CASE_TYPES.map((item) => ({ id: item, label: item }))}
        />
        <CheckList
          title="Source type"
          note="Every source type is included until you pick one."
          name="source_type"
          options={SOURCE_TYPE_OPTIONS.map((item) => ({ id: item, label: item }))}
        />
        <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="include_test" value="yes" className="accent-navy" />
          Include practice test numbers
        </label>
      </section>

      <button type="submit" disabled={fields.size === 0} className={buttonPrimary}>
        {fields.size === 0 ? "Choose a field" : `Download CSV · ${fields.size} field${fields.size === 1 ? "" : "s"}`}
      </button>
    </form>
  );
}

function FieldGroup({
  group,
  selected,
  onToggle,
}: {
  group: ExportFieldGroup;
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  const fields = EXPORT_FIELDS.filter((field) => field.group === group);
  return (
    <fieldset>
      <legend className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {group}
        {group === "More" ? <span className="ml-2 normal-case tracking-normal text-slate-400">Conversation history stays out</span> : null}
      </legend>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {fields.map((field) => (
          <label key={field.id} className="flex items-center gap-2 text-sm text-slate-800">
            <input type="checkbox" name="field" value={field.id} checked={selected.has(field.id)} onChange={() => onToggle(field.id)} className="accent-navy" />
            {field.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function CheckList({
  title,
  note,
  name,
  options,
}: {
  title: string;
  note: string;
  name: string;
  options: { id: string; label: string }[];
}) {
  return (
    <fieldset className="mt-4">
      <legend className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</legend>
      <p className="mt-1 text-xs normal-case tracking-normal text-slate-500">{note}</p>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {options.map((option) => (
          <label key={option.id} className="flex items-center gap-2 text-sm text-slate-800">
            <input type="checkbox" name={name} value={option.id} className="accent-navy" />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
