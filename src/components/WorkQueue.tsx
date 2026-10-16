"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { IdentityMark } from "@/components/IdentityMark";
import { LeadTagFields } from "@/components/LeadTagFields";
import { CLOSE_SUGGESTION_LABEL } from "@/lib/funnel";
import { CALLER_CLASS_LABEL, EXCLUDED_CALLER_CLASSES } from "@/lib/caller-class";
import { isSourceType, LEAD_SOURCES, PI_CASE_TYPES, SOURCE_TYPES } from "@/lib/leads";
import { classifyNonLead, confirmCloseSuggestion, confirmSigned, markPriority, markReferralAlreadySent, reviewPrioritySuggestion, saveLeadDetails, saveLeadTags, sendReferral, setConsultation, setDesired, setNextAction, setQualified, setTalkedWith, startTextSequence } from "@/lib/ops-actions";
import { referralFirmArea, referralFirms, renderReferralSms, type ReferralDestination } from "@/lib/referrals";
import type { NextActionLine } from "@/lib/next-action";
import { chicagoLocalInput, formatChicago } from "@/lib/time";

export type QueueRow = {
  id: string;
  title: string;
  samePhone: { id: string; title: string; label: string }[];
  closeSuggestion: "decline" | "not_interested" | "not_a_lead" | null;
  identityStatus: LeadIdentity | null;
  accident: string;
  caseType: string;
  leadSource: string;
  sourceType: string;
  when: string;
  priority: string | null;
  prioritySuggestion: string | null;
  actionTitle: string | null;
  label: string;
  stageClassName: string;
  stageStripe: string;
  step: string;
  tags: string[];
  callrail: boolean;
  declineReason: string | null;
  qualifiedLabel: string;
  consultWhen: string;
  desired: string;
  desiredLocked: boolean;
  signed: boolean;
  nonPi: boolean;
  practiceArea: string | null;
  referralSent: boolean;
  referralFirm: string | null;
  callerClass: string | null;
  confirmSigned: boolean;
  lastLabel: string;
  lastDays: number | null;
  consultKey: string;
  waiting: boolean;
  automationLabel: string;
  automationBad: boolean;
  canStartText: boolean;
  quoUrl: string | null;
  slackUrl: string | null;
  leadName: string;
  phone: string | null;
  email: string | null;
  summary: string | null;
  owner: string | null;
  grade: string | null;
  textsLive: boolean;
  textNext: string | null;
  sequenceLabel: string;
  agreementStatus: string | null;
  agreementSent: string | null;
  signingUrl: string | null;
  intakeHref: string | null;
  caseHref: string | null;
  calls: number;
  texts: number;
  nextCallLabel: string;
  callJobId: string | null;
  callTag: string | null;
  textJobId: string | null;
  reminderAt: string | null;
  nextAction: NextActionLine[];
  nextActionAt: string | null;
  nextDayKey: string;
  nextDayLabel: string;
};

type LeadIdentity = "ok" | "needs_review" | "confirmed";

type Touch = {
  id: string;
  type: string | null;
  direction: string | null;
  content: string | null;
  occurred_at: string | null;
};

type Column = "stage" | "priority" | "grade" | "consult" | "qualified" | "desired" | "signed" | "last" | "automation";

const COLUMNS: { id: Column; label: string; width: string }[] = [
  { id: "stage", label: "Stage", width: "10%" },
  { id: "priority", label: "Priority", width: "8%" },
  { id: "grade", label: "Grade", width: "5%" },
  { id: "consult", label: "Consult", width: "6%" },
  { id: "qualified", label: "Qualified", width: "9%" },
  { id: "desired", label: "Desired", width: "9%" },
  { id: "signed", label: "Signed", width: "6%" },
  { id: "last", label: "Last contacted", width: "9%" },
  { id: "automation", label: "Automation", width: "10%" },
];

function columnValue(row: QueueRow, column: Column): string {
  if (column === "stage") return row.label;
  if (column === "priority") return row.priority ?? "—";
  if (column === "grade") return row.grade ?? "—";
  if (column === "consult") return row.consultWhen;
  if (column === "qualified") return row.qualifiedLabel;
  if (column === "desired") return row.desired;
  if (column === "signed") return row.signed ? "Yes" : row.confirmSigned ? "Confirm" : "—";
  if (column === "last") return row.lastLabel;
  return row.automationLabel;
}

function sortValue(row: QueueRow, column: Column): string | number {
  if (column === "grade") return row.grade === "A" ? 0 : row.grade === "B" ? 1 : row.grade === "C" ? 2 : 3;
  if (column === "last") return row.lastDays ?? 9999;
  if (column === "consult") return row.consultKey || "9999-99-99";
  return columnValue(row, column).toLowerCase();
}

export function WorkQueue({
  rows,
  initialId,
  destinations,
  templates,
  staff,
}: {
  rows: QueueRow[];
  initialId?: string;
  destinations: ReferralDestination[];
  templates: { en: string; es: string };
  staff: string[];
}) {
  const [selectedId, setSelectedId] = useState(initialId && rows.some((row) => row.id === initialId) ? initialId : "");
  const [filters, setFilters] = useState<Partial<Record<Column, string>>>({});
  const [nextDay, setNextDay] = useState("");
  const [sort, setSort] = useState<{ column: Column; dir: "asc" | "desc" } | null>(null);
  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const shown = rows
    .filter((row) => !nextDay || row.nextDayKey === nextDay)
    .filter((row) => COLUMNS.every((column) => !filters[column.id] || columnValue(row, column.id) === filters[column.id]))
    .sort((a, b) => {
      if (!sort) {
        if (a.nextActionAt && b.nextActionAt && a.nextActionAt !== b.nextActionAt) return a.nextActionAt < b.nextActionAt ? -1 : 1;
        if (a.nextActionAt && !b.nextActionAt) return -1;
        if (!a.nextActionAt && b.nextActionAt) return 1;
        return a.title.localeCompare(b.title);
      }
      const left = sortValue(a, sort.column);
      const right = sortValue(b, sort.column);
      const compared = left < right ? -1 : left > right ? 1 : 0;
      return sort.dir === "asc" ? compared : -compared;
    });

  return (
    <div className={`mt-4 grid items-start gap-4 ${selected ? "xl:grid-cols-[minmax(0,1fr)_28rem]" : ""}`}>
      <div className="min-w-0 rounded-xl border border-slate-200 bg-white">
        <table className="w-full table-fixed text-left text-xs">
          <colgroup>
            <col style={{ width: "13%" }} />
            <col style={{ width: "10%" }} />
            {COLUMNS.map((column) => (
              <col key={column.id} style={{ width: column.width }} />
            ))}
            <col style={{ width: "5%" }} />
          </colgroup>
          <thead className="text-slate-500">
            <tr>
              <th className="sticky top-16 z-20 border-b border-slate-200 bg-white px-2 py-2 text-left font-medium uppercase tracking-wide">Lead</th>
              <NextDayHead rows={rows} day={nextDay} onChange={setNextDay} />
              {COLUMNS.map((column, index) => (
                <HeadSort
                  key={column.id}
                  label={column.label}
                  column={column.id}
                  align={index >= COLUMNS.length - 3 ? "end" : "start"}
                  rows={rows}
                  filter={filters[column.id] ?? ""}
                  sort={sort}
                  onChange={(value) => {
                    if (value === "sort:asc" || value === "sort:desc") {
                      setSort({ column: column.id, dir: value === "sort:asc" ? "asc" : "desc" });
                      return;
                    }
                    if (!value) setSort((current) => (current?.column === column.id ? null : current));
                    setFilters((current) => ({ ...current, [column.id]: value }));
                  }}
                />
              ))}
              <th className="sticky top-16 z-20 border-b border-slate-200 bg-white px-2 py-2 text-center font-medium uppercase tracking-wide">Links</th>
            </tr>
          </thead>
          <tbody className="[&_td]:align-top">
            {shown.map((row) => (
              <tr
                key={row.id}
                className={`border-b border-slate-100 last:border-0 ${
                  row.id === selectedId ? "bg-brand/10" : "hover:bg-slate-50"
                } ${row.stageStripe}`}
              >
                <td className="px-2 py-2">
                  <button
                    type="button"
                    onClick={() => setSelectedId(row.id)}
                    className="inline-flex items-center gap-1 text-left text-sm font-medium text-navy hover:underline"
                  >
                    {row.title}
                    <IdentityMark status={row.identityStatus} />
                  </button>
                  <p className="mt-0.5 line-clamp-2 text-slate-500">
                    {row.accident !== "—" ? row.accident : "Accident not captured"}
                    {row.when ? ` · ${row.when}` : ""}
                  </p>
                  {row.samePhone.length > 0 ? (
                    <p className="mt-0.5 text-slate-500">{row.samePhone.length + 1} records, same phone</p>
                  ) : null}
                  {row.closeSuggestion ? (
                    <p className="mt-0.5 font-medium text-orange-800">Suggested close: {CLOSE_SUGGESTION_LABEL[row.closeSuggestion]}</p>
                  ) : null}
                </td>
                <td className="px-2 py-2 text-slate-800">
                  <p className="font-medium text-slate-900">{row.actionTitle ?? "—"}</p>
                  {row.nextAction
                    .filter((line) => line.when !== "None")
                    .map((line) => (
                      <p key={line.label} className="text-slate-600">
                        <span className="text-slate-500">{line.label}</span> {line.when}
                      </p>
                    ))}
                </td>
                <td className="px-2 py-2 text-center">
                  <span className={`inline-flex rounded-full px-2 py-0.5 font-medium leading-tight ${row.stageClassName}`}>
                    {row.label}
                  </span>
                  {row.nonPi ? (
                    row.referralSent ? (
                      <p className="mt-1 text-[11px] font-medium text-emerald-800">Referral sent</p>
                    ) : (
                      <button type="button" onClick={() => setSelectedId(row.id)} className="mt-1 cursor-pointer rounded px-1 text-[11px] font-medium text-orange-800 underline transition-colors hover:bg-orange-100">
                        Send referral
                      </button>
                    )
                  ) : null}
                </td>
                <td className="px-2 py-2 text-center">
                  <PriorityCell row={row} />
                </td>
                <td className="px-2 py-2 text-center">
                  <span className={`inline-flex rounded-full px-2 py-0.5 font-medium ${gradeClass(row.grade)}`}>
                    {row.grade ?? "—"}
                  </span>
                </td>
                <td className="px-2 py-2 text-center text-slate-700">{row.consultWhen}</td>
                <td className="px-1 py-2 text-center">
                  <YesNoCell row={row} field="qualified" value={row.qualifiedLabel} action={setQualified} />
                </td>
                <td className="px-1 py-2 text-center">
                  {row.desiredLocked ? (
                    <span className="font-medium text-slate-900">{row.desired}</span>
                  ) : (
                    <YesNoCell row={row} field="desired" value={row.desired} action={setDesired} />
                  )}
                </td>
                <td className="px-2 py-2 text-center text-slate-700">{row.signed ? "Yes" : row.confirmSigned ? "Confirm" : "—"}</td>
                <td className="px-2 py-2 text-center text-slate-700">{row.lastLabel}</td>
                <td className="px-1 py-2 text-center">
                  <TextAutomation row={row} />
                </td>
                <td className="px-2 py-2 text-center">
                  <RowLinks quoUrl={row.quoUrl} slackUrl={row.slackUrl} />
                </td>
              </tr>
            ))}
            {shown.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-4 py-10 text-center text-slate-500">
                  Nothing in this queue.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {selected ? (
        <LeadDrawer key={selected.id} row={selected} destinations={destinations} templates={templates} staff={staff} onClose={() => setSelectedId("")} />
      ) : null}
    </div>
  );
}

function NextDayHead({ rows, day, onChange }: { rows: QueueRow[]; day: string; onChange: (day: string) => void }) {
  const [open, setOpen] = useState(false);
  const days = new Map<string, string>();
  for (const row of rows) {
    if (row.nextDayKey) days.set(row.nextDayKey, row.nextDayLabel);
  }
  const options = [...days.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const pick = (value: string) => {
    onChange(value);
    setOpen(false);
  };
  return (
    <th className={`sticky top-16 border-b border-slate-200 bg-white px-2 py-2 text-left font-medium ${open ? "z-30" : "z-20"}`}>
      <button
        type="button"
        aria-label="Filter next action by date"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`flex items-center gap-0.5 rounded-md border px-1 py-1 text-[11px] uppercase leading-tight tracking-normal ${
          day ? "border-sky-300 bg-sky-50 text-navy" : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white"
        }`}
      >
        <span>Next action</span>
        <span aria-hidden="true" className="text-[10px]">↕</span>
      </button>
      {open ? (
        <>
          <button type="button" aria-label="Close filter" className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 z-20 mt-1 max-h-64 w-48 overflow-auto rounded-md border border-slate-200 bg-white py-1 text-left text-sm normal-case tracking-normal text-slate-700 shadow-lg">
            <MenuChoice current={!day} onPick={() => pick("")}>
              All dates
            </MenuChoice>
            {options.map(([key, label]) => (
              <MenuChoice key={key} current={day === key} onPick={() => pick(key)}>
                {label}
              </MenuChoice>
            ))}
          </div>
        </>
      ) : null}
    </th>
  );
}

function HeadSort({
  label,
  column,
  align,
  rows,
  filter,
  sort,
  onChange,
}: {
  label: string;
  column: Column;
  align: "start" | "end";
  rows: QueueRow[];
  filter: string;
  sort: { column: Column; dir: "asc" | "desc" } | null;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const values = [...new Set(rows.map((row) => columnValue(row, column)).filter((value) => value && value !== "—"))].sort();
  const recent = column === "last" || column === "consult";
  const sortedHere = sort?.column === column;
  const pick = (value: string) => {
    onChange(value);
    setOpen(false);
  };
  return (
    <th className={`sticky top-16 border-b border-slate-200 bg-white px-1.5 py-2 font-medium ${open ? "z-30" : "z-20"}`}>
      <button
        type="button"
        aria-label={`Sort or filter ${label}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`flex w-full items-center justify-center gap-0.5 rounded-md border px-1 py-1 text-center text-[11px] uppercase leading-tight tracking-normal ${
          filter || sortedHere ? "border-sky-300 bg-sky-50 text-navy" : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white"
        }`}
      >
        <span className="min-w-0">{label}</span>
        <span aria-hidden="true" className="shrink-0 text-[10px]">
          ↕
        </span>
      </button>
      {open ? (
        <>
          <button type="button" aria-label="Close filter" className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
          <div className={`absolute top-full z-20 mt-1 max-h-64 w-48 overflow-auto rounded-md border border-slate-200 bg-white py-1 text-left text-sm normal-case tracking-normal text-slate-700 shadow-lg ${align === "end" ? "right-0" : "left-0"}`}>
            <MenuChoice current={!filter && !sortedHere} onPick={() => pick("")}>
              All
            </MenuChoice>
            <MenuChoice current={sortedHere && sort?.dir === "asc"} onPick={() => pick("sort:asc")}>
              {recent ? "Most recent" : "Sort A–Z"}
            </MenuChoice>
            <MenuChoice current={sortedHere && sort?.dir === "desc"} onPick={() => pick("sort:desc")}>
              {recent ? "Least recent" : "Sort Z–A"}
            </MenuChoice>
            {values.map((value) => (
              <MenuChoice key={value} current={filter === value} onPick={() => pick(value)}>
                {value}
              </MenuChoice>
            ))}
          </div>
        </>
      ) : null}
    </th>
  );
}

function MenuChoice({ current, onPick, children }: { current: boolean; onPick: () => void; children: string }) {
  return (
    <button type="button" onClick={onPick} className={`block w-full px-3 py-1.5 text-left hover:bg-slate-50 ${current ? "font-medium text-navy" : ""}`}>
      {children}
    </button>
  );
}

function TextAutomation({ row }: { row: QueueRow }) {
  if (row.textsLive) {
    return <span className={row.automationBad ? "font-medium text-red-700" : "font-medium text-slate-800"}>{row.automationLabel}</span>;
  }
  if (!row.canStartText) {
    return <span className={row.automationBad ? "font-medium text-red-700" : "text-slate-400"}>{row.automationLabel}</span>;
  }
  return (
    <form action={startTextSequence} className="flex flex-col items-center gap-1">
      <input type="hidden" name="lead_id" value={row.id} />
      <button name="sequence" value="new-lead" className="cursor-pointer rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] font-medium leading-tight text-slate-700 transition-colors hover:border-navy hover:bg-slate-100 hover:text-navy">
        New lead
      </button>
      <button name="sequence" value="more-info" className="cursor-pointer rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] font-medium leading-tight text-slate-700 transition-colors hover:border-navy hover:bg-slate-100 hover:text-navy">
        More info
      </button>
    </form>
  );
}

function YesNoCell({
  row,
  field,
  value,
  action,
  align = "center",
}: {
  row: QueueRow;
  field: "qualified" | "desired";
  value: string;
  action: (formData: FormData) => Promise<void>;
  align?: "center" | "start";
}) {
  const label = field === "qualified" ? "Qualified" : "Desired";
  return (
    <form action={action} className={`flex items-center gap-1 ${align === "start" ? "justify-start" : "justify-center"}`}>
      <input type="hidden" name="lead_id" value={row.id} />
      <button
        name="decision"
        value="yes"
        aria-label={`${label} yes`}
        className={`cursor-pointer rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors ${
          value === "Yes" ? "bg-navy text-white hover:bg-[#16366e]" : "border border-slate-300 bg-white text-slate-700 hover:border-navy hover:bg-slate-100 hover:text-navy"
        }`}
      >
        Yes
      </button>
      <button
        name="decision"
        value="no"
        aria-label={`${label} no`}
        className={`cursor-pointer rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors ${
          value === "No" ? "bg-navy text-white hover:bg-[#16366e]" : "border border-slate-300 bg-white text-slate-700 hover:border-navy hover:bg-slate-100 hover:text-navy"
        }`}
      >
        No
      </button>
    </form>
  );
}

function PriorityCell({ row }: { row: QueueRow }) {
  if (row.priority === "Suggested") {
    return (
      <form action={reviewPrioritySuggestion} className="flex flex-col items-center gap-1">
        <input type="hidden" name="lead_id" value={row.id} />
        <span className="text-xs font-medium text-slate-700">Suggested</span>
        <span className="flex gap-1">
          <button name="decision" value="confirm" className="cursor-pointer rounded-md bg-navy px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-[#16366e]" aria-label="Add to priority">
            Yes
          </button>
          <button name="decision" value="dismiss" className="cursor-pointer rounded-md border border-slate-300 bg-white px-2 py-1 text-xs transition-colors hover:border-navy hover:bg-slate-100 hover:text-navy" aria-label="Not a priority">
            No
          </button>
        </span>
      </form>
    );
  }
  if (!row.priority) {
    return (
      <form action={markPriority}>
        <input type="hidden" name="lead_id" value={row.id} />
        <button className="mx-auto cursor-pointer rounded-md border border-slate-300 bg-white px-1.5 py-1 text-center text-[11px] font-medium leading-tight text-slate-700 transition-colors hover:border-navy hover:bg-slate-100 hover:text-navy">
          <span className="block">Make</span>
          <span className="block">priority</span>
        </button>
      </form>
    );
  }
  return <span className="font-medium text-slate-900">{row.priority}</span>;
}

function RowLinks({ quoUrl, slackUrl }: { quoUrl: string | null; slackUrl: string | null }) {
  if (!quoUrl && !slackUrl) return <span className="text-slate-400">—</span>;
  return (
    <span className="flex flex-col items-center gap-0.5">
      {quoUrl ? (
        <a href={quoUrl} className="font-medium text-slate-900 underline" target="_blank" rel="noreferrer">
          Quo
        </a>
      ) : null}
      {slackUrl ? (
        <a href={slackUrl} className="font-medium text-slate-900 underline" target="_blank" rel="noreferrer">
          Slack
        </a>
      ) : null}
    </span>
  );
}

function fieldClass() {
  return "mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm font-normal normal-case tracking-normal text-slate-900";
}

function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <div className="mt-2 grid grid-cols-2 gap-3">{children}</div>
    </section>
  );
}

function FieldLabel({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block text-xs font-medium uppercase tracking-wide text-slate-500 ${className}`}>
      {label}
      {children}
    </label>
  );
}

function LeadFacts({ row, staff }: { row: QueueRow; staff: string[] }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    try {
      await saveLeadDetails(formData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setPending(false);
    }
  }
  const caseOptions = new Set<string>(PI_CASE_TYPES);
  if (row.caseType) caseOptions.add(row.caseType);
  const formId = `lead-details-${row.id}`;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <form id={formId} action={onSubmit} className="space-y-4">
          <input type="hidden" name="lead_id" value={row.id} />
          <PanelSection title="Contact">
            <FieldLabel label="Name" className="col-span-2">
              <input name="lead_name" defaultValue={row.leadName} className={fieldClass()} />
            </FieldLabel>
            <FieldLabel label="Phone">
              <input name="phone" defaultValue={row.phone ?? ""} className={fieldClass()} />
            </FieldLabel>
            <FieldLabel label="Email">
              <input name="email" defaultValue={row.email ?? ""} className={fieldClass()} />
            </FieldLabel>
          </PanelSection>
          <PanelSection title="Marketing">
            <FieldLabel label="Lead source">
              <input name="lead_source" list="lead-source-examples" defaultValue={row.leadSource} placeholder="Google, Friend, Attorney" className={fieldClass()} />
              <datalist id="lead-source-examples">
                {LEAD_SOURCES.map((item) => (
                  <option key={item.source} value={item.source} />
                ))}
              </datalist>
            </FieldLabel>
            <FieldLabel label="Source type">
              <select name="source_type" defaultValue={isSourceType(row.sourceType) ? row.sourceType : ""} className={fieldClass()}>
                <option value="">Not set</option>
                {SOURCE_TYPES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </FieldLabel>
          </PanelSection>
          <PanelSection title="Case details">
            <FieldLabel label="Type">
              <select name="case_type" defaultValue={row.caseType} className={fieldClass()}>
                <option value="">Not set</option>
                {[...caseOptions].map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </FieldLabel>
            <div />
          </PanelSection>
        </form>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Qualified</p>
            <div className="mt-1">
              <YesNoCell row={row} field="qualified" value={row.qualifiedLabel} action={setQualified} align="start" />
            </div>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Desired</p>
            <div className="mt-1">
              {row.desiredLocked ? (
                <span className="text-sm text-slate-900">{row.desired}</span>
              ) : (
                <YesNoCell row={row} field="desired" value={row.desired} action={setDesired} align="start" />
              )}
            </div>
          </div>
          <ConsultDate row={row} />
          <TalkedWith row={row} staff={staff} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <FunnelMark label="Signed" value={row.signed ? "Yes" : "—"} />
          {row.confirmSigned ? (
            <form action={confirmSigned}>
              <input type="hidden" name="lead_id" value={row.id} />
              <button className="cursor-pointer rounded-md bg-navy px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#16366e]">
                Confirm signed
              </button>
            </form>
          ) : null}
        </div>
        <TagEditor row={row} />
      </div>
      <div className="border-t border-slate-200 bg-white px-4 py-3">
        {error ? <p className="mb-2 text-sm text-red-700">{error}</p> : null}
        <button
          form={formId}
          disabled={pending}
          className="w-full cursor-pointer rounded-md bg-navy px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[#16366e] disabled:cursor-default disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function QueueReferral({
  row,
  destinations,
  templates,
}: {
  row: QueueRow;
  destinations: ReferralDestination[];
  templates: { en: string; es: string };
}) {
  const firms = referralFirms(destinations);
  const [firmId, setFirmId] = useState(firms[0]?.id ?? "");
  const [language, setLanguage] = useState<"en" | "es">("en");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const firm = firms.find((item) => item.id === firmId) ?? null;
  const area = firm ? referralFirmArea(firm, row.practiceArea) : "";
  const preview =
    firm && area
      ? renderReferralSms({
          language,
          template: templates[language],
          leadName: row.leadName || row.title,
          area,
          destination: firm,
        })
      : "";

  async function submit(kind: "send" | "already") {
    if (!firm || !area) {
      setError("Pick the firm.");
      return;
    }
    setPending(true);
    setError(null);
    const data = new FormData();
    data.set("destination_id", firm.id);
    data.set("language", language);
    data.set("practice_area", area);
    try {
      if (kind === "send") await sendReferral(row.id, data);
      else await markReferralAlreadySent(row.id, data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record the referral");
    } finally {
      setPending(false);
    }
  }

  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Referral</h3>
      {row.referralSent ? (
        <p className="mt-2 text-sm font-medium text-emerald-800">
          Referral sent{row.referralFirm ? ` · ${row.referralFirm}` : ""}
        </p>
      ) : firms.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">Add a firm on the Referrals page first.</p>
      ) : (
        <div className="mt-2 space-y-2">
          <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
            Firm
            <select
              value={firm?.id ?? ""}
              onChange={(event) => setFirmId(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm font-normal normal-case tracking-normal text-slate-900"
            >
              {firms.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
            Language
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value === "es" ? "es" : "en")}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm font-normal normal-case tracking-normal text-slate-900"
            >
              <option value="en">English</option>
              <option value="es">Spanish</option>
            </select>
          </label>
          {preview ? <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-800">{preview}</p> : null}
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => void submit("send")}
              className="cursor-pointer rounded-md bg-navy px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#16366e] disabled:cursor-default disabled:opacity-60"
            >
              {pending ? "Saving…" : "Send referral"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => void submit("already")}
              className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-900 transition-colors hover:border-navy hover:bg-slate-100 hover:text-navy disabled:cursor-default disabled:opacity-60"
            >
              Already sent
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function LeadDrawer({
  row,
  destinations,
  templates,
  staff,
  onClose,
}: {
  row: QueueRow;
  destinations: ReferralDestination[];
  templates: { en: string; es: string };
  staff: string[];
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"overview" | "details" | "activity">("overview");
  const [touches, setTouches] = useState<Touch[] | null>(null);
  useEffect(() => {
    let cancel = false;
    setTouches(null);
    fetch(`/api/leads/${row.id}/activity`)
      .then((response) => (response.ok ? response.json() : []))
      .then((data: Touch[]) => {
        if (!cancel) setTouches(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancel) setTouches([]);
      });
    return () => {
      cancel = true;
    };
  }, [row.id]);

  const contract = contractLabel(row);

  return (
    <aside className="flex max-h-[calc(100vh-5rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:sticky lg:top-16">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-navy">
            {row.title}
            <IdentityMark status={row.identityStatus} />
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {row.accident !== "—" ? row.accident : "Accident not captured"}
            {row.when ? ` · ${row.when}` : ""}
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-900">
          Close
        </button>
      </div>
      <div className="flex gap-1 border-b border-slate-200 px-3">
        {(
          [
            ["overview", "Overview"],
            ["details", "Details"],
            ["activity", "Activity"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`cursor-pointer border-b-2 px-3 py-2 text-sm font-medium ${
              tab === id ? "border-navy text-navy" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "details" ? (
        <LeadFacts row={row} staff={staff} />
      ) : (
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {tab === "activity" ? (
          <section>
            {touches === null ? (
              <p className="text-sm text-slate-500">Loading activity…</p>
            ) : touches.length === 0 ? (
              <p className="text-sm text-slate-500">No calls or texts recorded yet.</p>
            ) : (
              <ul className="space-y-3">
                {touches.map((touch) => (
                  <li key={touch.id} className="text-sm">
                    <p className="font-medium text-slate-800">
                      {touchLabel(touch)}
                      <span className="ml-2 font-normal text-slate-400">
                        {touch.occurred_at ? formatChicago(touch.occurred_at) : ""}
                      </span>
                    </p>
                    {touch.content ? <p className="mt-0.5 text-slate-600">{touch.content}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : (
          <>
        {row.nonPi ? <QueueReferral row={row} destinations={destinations} templates={templates} /> : null}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Summary</h3>
          <p className="mt-2 text-sm leading-6 text-slate-800">{row.summary?.trim() || "No call summary yet."}</p>
        </section>
        <div className="flex flex-wrap gap-3 text-sm">
          {row.quoUrl ? (
            <a href={row.quoUrl} className="rounded-md bg-brand px-3 py-1.5 font-medium text-navy" target="_blank" rel="noreferrer">
              Open in Quo
            </a>
          ) : (
            <span className="text-slate-400">No Quo link</span>
          )}
          {row.slackUrl ? (
            <a href={row.slackUrl} className="rounded-md border border-slate-300 px-3 py-1.5 font-medium text-slate-900" target="_blank" rel="noreferrer">
              Open in Slack
            </a>
          ) : (
            <span className="text-slate-400">No Slack post</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${row.stageClassName}`}>{row.label}</span>
          <span className="text-sm text-slate-700">{row.step === "—" ? "No next step" : row.step}</span>
        </div>
        {row.samePhone.length > 0 ? (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Same phone</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {row.samePhone.map((other) => (
                <li key={other.id}>
                  <Link href={`/leads/${other.id}`} className="font-medium text-navy underline">
                    {other.title}
                  </Link>
                  <span className="text-slate-500"> · {other.label}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {row.closeSuggestion ? <CloseSuggestion row={row} /> : null}
        {row.priority === "Suggested" && row.prioritySuggestion ? <PrioritySuggestion row={row} /> : null}
        {row.signed ? null : <NonLeadChoice row={row} />}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Next</h3>
          <p className="mt-2 text-sm font-medium text-slate-900">{row.actionTitle ?? "No next step"}</p>
          <dl className="mt-2 space-y-1 text-sm text-slate-700">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Last contacted</dt>
              <dd>{row.lastLabel}</dd>
            </div>
            {row.nextAction.filter((line) => line.when !== "None").map((line) => (
              <div key={line.label} className="flex justify-between gap-3">
                <dt className="text-slate-500">{line.label}</dt>
                <dd>{line.when}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Calls / texts</dt>
              <dd>
                {row.calls} / {row.texts}
              </dd>
            </div>
          </dl>
          <NextActionEdit row={row} staff={staff} />
        </section>
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Automation</h3>
          <ul className="mt-2 space-y-2 text-sm">
            <li className="space-y-2">
              <div className="flex justify-between gap-3">
                <span className="text-slate-500">Texts</span>
                <span>
                  {row.textsLive ? row.automationLabel : "Off"}
                  {row.textsLive && row.textNext ? ` · Next ${formatChicago(row.textNext)}` : ""}
                </span>
              </div>
              {row.canStartText ? (
                <form action={startTextSequence} className="flex flex-wrap gap-2">
                  <input type="hidden" name="lead_id" value={row.id} />
                  <button name="sequence" value="new-lead" className="cursor-pointer rounded-md bg-navy px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#16366e]">
                    New lead
                  </button>
                  <button name="sequence" value="more-info" className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-900 transition-colors hover:border-navy hover:bg-slate-100 hover:text-navy">
                    More info
                  </button>
                </form>
              ) : null}
            </li>
            <li className="flex justify-between gap-3">
              <span className="text-slate-500">Contract</span>
              <span className={contract.bad ? "font-medium text-red-700" : ""}>{contract.label}</span>
            </li>
          </ul>
          {row.signingUrl ? (
            <a href={row.signingUrl} className="mt-2 inline-block text-sm font-medium text-slate-900 underline" target="_blank" rel="noreferrer">
              Open the contract
            </a>
          ) : null}
        </section>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href={`/leads/${row.id}`} className="font-medium text-slate-900 underline">
            Open lead
          </Link>
          {row.intakeHref ? (
            <a href={row.intakeHref} className="font-medium text-slate-900 underline" target="_blank" rel="noreferrer">
              Docket intake
            </a>
          ) : null}
          {row.caseHref ? (
            <a href={row.caseHref} className="font-medium text-slate-900 underline" target="_blank" rel="noreferrer">
              Case
            </a>
          ) : null}
        </div>
          </>
        )}
      </div>
      )}
    </aside>
  );
}

function NextActionEdit({ row, staff }: { row: QueueRow; staff: string[] }) {
  const call = row.nextAction.find((line) => line.label === "Call" && line.at);
  const text = row.nextAction.find((line) => line.label === "Text" && line.at);
  const reminder = row.nextAction.find((line) => line.label === "Reminder" && line.at);
  const canEdit = Boolean(row.callJobId || text || reminder);
  if (!canEdit) return null;
  const names = row.callTag && !staff.includes(row.callTag) ? [row.callTag, ...staff] : staff;
  return (
    <form
      action={setNextAction}
      key={`${row.id}:${row.callJobId ?? ""}:${call?.at ?? ""}:${row.callTag ?? ""}:${text?.at ?? ""}:${reminder?.at ?? ""}`}
      className="mt-3 space-y-2 rounded-md bg-slate-50 px-3 py-2"
    >
      <input type="hidden" name="lead_id" value={row.id} />
      {row.callJobId && call?.at ? (
        <>
          <input type="hidden" name="call_job_id" value={row.callJobId} />
          <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
            Call time
            <input
              type="datetime-local"
              name="call_at"
              defaultValue={chicagoLocalInput(call.at)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm font-normal normal-case tracking-normal text-slate-900"
            />
          </label>
          <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
            Slack tag
            <select
              name="tag"
              defaultValue={row.callTag ?? ""}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm font-normal normal-case tracking-normal text-slate-900"
            >
              <option value="">Whoever is available</option>
              {names.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          </div>
        </>
      ) : null}
      {text?.at ? (
        <>
          {row.textJobId ? <input type="hidden" name="text_job_id" value={row.textJobId} /> : null}
          <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
            Text time
            <input
              type="datetime-local"
              name="text_at"
              defaultValue={chicagoLocalInput(text.at)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm font-normal normal-case tracking-normal text-slate-900"
            />
          </label>
        </>
      ) : null}
      {reminder?.at ? (
        <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
          Reminder time
          <input
            type="datetime-local"
            name="reminder_at"
            defaultValue={chicagoLocalInput(reminder.at)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm font-normal normal-case tracking-normal text-slate-900"
          />
        </label>
      ) : null}
      <button type="submit" className="rounded-md bg-navy px-3 py-1.5 text-sm font-medium text-white">
        Save next action
      </button>
    </form>
  );
}

function TalkedWith({ row, staff }: { row: QueueRow; staff: string[] }) {
  const names = row.owner && !staff.includes(row.owner) ? [row.owner, ...staff] : staff;
  return (
    <form action={setTalkedWith}>
      <input type="hidden" name="lead_id" value={row.id} />
      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
        Talked with
        <select
          key={`${row.id}:${row.owner ?? ""}`}
          name="owner_name"
          defaultValue={row.owner ?? ""}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
          className={fieldClass()}
        >
          <option value="">Not set</option>
          {names.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
    </form>
  );
}

function ConsultDate({ row }: { row: QueueRow }) {
  return (
    <form action={setConsultation}>
      <input type="hidden" name="lead_id" value={row.id} />
      <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
        Consultation date
        <input
          key={`${row.id}:${row.consultKey}`}
          type="date"
          name="consultation_date"
          defaultValue={row.consultKey.slice(0, 10)}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
          className={fieldClass()}
        />
      </label>
    </form>
  );
}

function FunnelMark({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm text-slate-900">{value}</dd>
    </div>
  );
}

function PrioritySuggestion({ row }: { row: QueueRow }) {
  return (
    <form action={reviewPrioritySuggestion} className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm">
      <input type="hidden" name="lead_id" value={row.id} />
      <p className="font-medium text-sky-950">Suggested priority</p>
      <p className="mt-1 text-sky-900">{row.prioritySuggestion}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button name="decision" value="confirm" className="rounded-md bg-navy px-3 py-1.5 text-sm font-medium text-white">
          Add to priority
        </button>
        <button name="decision" value="dismiss" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm">
          Not a priority
        </button>
      </div>
    </form>
  );
}

function CloseSuggestion({ row }: { row: QueueRow }) {
  if (!row.closeSuggestion) return null;
  const suggestion = row.closeSuggestion;
  return (
    <form action={confirmCloseSuggestion} className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm">
      <input type="hidden" name="lead_id" value={row.id} />
      <input type="hidden" name="suggestion" value={suggestion} />
      <p className="font-medium text-orange-950">Suggested close: {CLOSE_SUGGESTION_LABEL[suggestion]}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {suggestion === "decline" ? (
          <>
            <button name="decision" value="decline" className="rounded-md bg-navy px-3 py-1.5 text-sm font-medium text-white">
              Decline
            </button>
            <button name="decision" value="refer" className="rounded-md bg-navy px-3 py-1.5 text-sm font-medium text-white">
              Refer
            </button>
          </>
        ) : (
          <button name="decision" value="confirm" className="rounded-md bg-navy px-3 py-1.5 text-sm font-medium text-white">
            Confirm close
          </button>
        )}
        <button name="decision" value="dismiss" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm">
          Keep open
        </button>
      </div>
    </form>
  );
}

function NonLeadChoice({ row }: { row: QueueRow }) {
  const current = EXCLUDED_CALLER_CLASSES.find((item) => item === row.callerClass) ?? "";
  return (
    <form action={classifyNonLead} className="rounded-lg border border-slate-200 p-3 text-sm">
      <input type="hidden" name="lead_id" value={row.id} />
      <label className="block font-medium text-slate-700">
        Not a lead
        <select
          name="caller_class"
          defaultValue={current}
          required
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-normal"
        >
          <option value="">Choose a reason</option>
          {EXCLUDED_CALLER_CLASSES.map((item) => (
            <option key={item} value={item}>
              {CALLER_CLASS_LABEL[item]}
            </option>
          ))}
        </select>
      </label>
      <button className="mt-3 rounded-md bg-navy px-3 py-1.5 text-sm font-medium text-white">Move to non-leads</button>
    </form>
  );
}

function TagEditor({ row }: { row: QueueRow }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    try {
      await saveLeadTags(row.id, formData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save tags");
    } finally {
      setPending(false);
    }
  }

  return (
    <form action={onSubmit}>
      <LeadTagFields
        key={`${row.id}:${row.tags.join("|")}:${row.signed ? "signed" : "open"}:${row.qualifiedLabel}`}
        tags={row.tags}
        declineReason={row.declineReason}
        signed={row.signed}
        desired={row.desired === "Yes" || row.signed}
        nonPi={row.nonPi}
        callrail={row.callrail}
        quiet
        qualifiedMark={row.qualifiedLabel}
      />
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="mt-3 rounded-md bg-navy px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

function gradeClass(grade: string | null): string {
  if (grade === "A") return "bg-emerald-50 text-emerald-800";
  if (grade === "B") return "bg-sky-50 text-sky-800";
  if (grade === "C") return "bg-slate-100 text-slate-600";
  return "bg-slate-50 text-slate-400";
}

function contractLabel(row: QueueRow): { label: string; bad: boolean } {
  const status = (row.agreementStatus || "").toLowerCase();
  if (status === "failed") return { label: "Send failed", bad: true };
  if (status === "signed" || status === "completed") return { label: "Signed", bad: false };
  if (row.agreementSent) {
    const when = formatChicago(row.agreementSent);
    if (status === "cancelled") return { label: `Sent ${when}, then cancelled`, bad: false };
    return { label: `Sent ${when}`, bad: false };
  }
  return { label: "Not sent", bad: false };
}

function touchLabel(touch: Touch): string {
  const type = (touch.type || "note").replaceAll("_", " ");
  const direction = (touch.direction || "").toLowerCase();
  if (direction === "inbound") return `Inbound ${type}`;
  if (direction === "outbound") return `Outbound ${type}`;
  return type.charAt(0).toUpperCase() + type.slice(1);
}
