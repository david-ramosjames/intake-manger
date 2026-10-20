"use client";

import { createContext, useActionState, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { IdentityMark } from "@/components/IdentityMark";
import { CLOSE_SUGGESTION_LABEL } from "@/lib/funnel";
import { heardClientName } from "@/lib/identity";
import { EXCLUDED_CALLER_CLASSES, NON_LEAD_TAG } from "@/lib/caller-class";
import { DECLINE_TAGS, NOT_QUALIFIED_TAGS, QUALIFIED_NO, QUALIFIED_YES, SIZE_TAGS, selectedDecline, selectedOne } from "@/lib/tags";
import { isSourceType, LEAD_SOURCES, PI_CASE_TYPES, SOURCE_TYPES } from "@/lib/leads";
import { closeGaps } from "@/lib/close-ready";
import { isPlaceholderOwner } from "@/lib/talked-with";
import { classifyNonLead, confirmCloseSuggestion, confirmSigned, markPriority, markReferralAlreadySent, reviewPrioritySuggestion, resolveIdentity, saveLeadDetails, saveLeadTags, sendReferral, setConsultation, setDesired, setNextAction, setQualified, setTalkedWith, startTextSequence } from "@/lib/ops-actions";
import { PRACTICE_AREAS, referralFirms, renderReferralSms, type ReferralDestination } from "@/lib/referrals";
import type { NextActionLine } from "@/lib/next-action";
import { chicagoLocalInput, formatChicago } from "@/lib/time";
import { ButtonLabel } from "@/components/ButtonLabel";
import { buttonPrimary, buttonSecondary } from "@/lib/ui";

type DrawerNotice = { tone: "saving" | "saved" | "error"; text: string };
const DrawerNoticeContext = createContext<(notice: DrawerNotice | null) => void>(() => {});

function useNotedSubmit() {
  const notify = useContext(DrawerNoticeContext);
  const [pending, setPending] = useState(false);
  async function submit(task: () => Promise<void>) {
    setPending(true);
    notify({ tone: "saving", text: "Saving…" });
    try {
      await task();
      notify({ tone: "saved", text: "Saved" });
    } catch (err) {
      notify({ tone: "error", text: err instanceof Error ? err.message : "Could not save." });
    } finally {
      setPending(false);
    }
  }
  return { pending, submit };
}

export type QueueRow = {
  id: string;
  title: string;
  samePhone: { id: string; title: string; label: string }[];
  closeSuggestion: "decline" | "not_interested" | "not_a_lead" | null;
  identityStatus: LeadIdentity | null;
  identityEvidence: string | null;
  suggestedName: string | null;
  accident: string;
  caseType: string;
  leadSource: string;
  sourceType: string;
  when: string;
  openedLabel: string;
  openedKey: string;
  consulted: "yes" | "no" | "";
  signedDate: string;
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
  actor?: string | null;
  grade?: string | null;
  gradeReason?: string | null;
  gradeHandler?: string | null;
};

type Column = "stage" | "priority" | "grade" | "consult" | "qualified" | "desired" | "last" | "automation";
type SortColumn = Column | "opened";

const COLUMNS: { id: Column; label: string; width: string }[] = [
  { id: "stage", label: "Stage", width: "9%" },
  { id: "priority", label: "Priority", width: "7%" },
  { id: "grade", label: "Grade", width: "5%" },
  { id: "consult", label: "Consult", width: "7%" },
  { id: "qualified", label: "Qualified", width: "8%" },
  { id: "desired", label: "Desired", width: "8%" },
  { id: "last", label: "Last contacted", width: "8%" },
  { id: "automation", label: "Automation", width: "8%" },
];

function ActionLines({ lines, layout = "stack" }: { lines: NextActionLine[]; layout?: "stack" | "row" }) {
  const shown = lines.filter((line) => line.when !== "None");
  return (
    <>
      {shown.map((line) => {
        if (layout === "row") {
          return (
            <div key={line.label} className="flex justify-between gap-3">
              <dt className="text-slate-500">{line.label}</dt>
              <dd>{line.when}</dd>
            </div>
          );
        }
        return (
          <p key={line.label} className="text-slate-600">
            <span className="text-slate-500">{line.label}</span> {line.when}
          </p>
        );
      })}
    </>
  );
}

function columnValue(row: QueueRow, column: Column): string {
  if (column === "stage") return row.label;
  if (column === "priority") return row.priority ?? "—";
  if (column === "grade") return row.grade ?? "—";
  if (column === "consult") return row.consultWhen;
  if (column === "qualified") return row.qualifiedLabel;
  if (column === "desired") return row.desired;
  if (column === "last") return row.lastLabel;
  return row.automationLabel;
}

function sortValue(row: QueueRow, column: SortColumn): string | number {
  if (column === "opened") return row.openedKey || "9999";
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
  admin = false,
}: {
  rows: QueueRow[];
  initialId?: string;
  destinations: ReferralDestination[];
  templates: { en: string; es: string };
  staff: string[];
  admin?: boolean;
}) {
  const [selectedId, setSelectedId] = useState(initialId && rows.some((row) => row.id === initialId) ? initialId : "");
  const [referralOpenId, setReferralOpenId] = useState("");
  const [filters, setFilters] = useState<Partial<Record<Column, string>>>({});
  const [nextDay, setNextDay] = useState("");
  const [sort, setSort] = useState<{ column: SortColumn; dir: "asc" | "desc" } | null>(null);
  const canLeave = useRef<() => boolean>(() => true);
  function pick(id: string) {
    if (id !== selectedId && !canLeave.current()) return;
    setSelectedId(id);
  }
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
            <col style={{ width: "10%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "11%" }} />
            {COLUMNS.map((column) => (
              <col key={column.id} style={{ width: column.width }} />
            ))}
            <col style={{ width: "5%" }} />
          </colgroup>
          <thead className="text-slate-500">
            <tr>
              <th className="sticky top-16 z-20 border-b border-slate-200 bg-white px-2 py-2 text-left font-medium uppercase tracking-wide">
                <button
                  type="button"
                  onClick={() =>
                    setSort((current) => {
                      if (current?.column !== "opened") return { column: "opened", dir: "desc" };
                      if (current.dir === "desc") return { column: "opened", dir: "asc" };
                      return null;
                    })
                  }
                  className="inline-flex items-center gap-0.5 rounded-md border border-slate-200 bg-slate-50 px-1 py-1 text-[11px] uppercase leading-tight tracking-normal text-slate-600 hover:border-slate-300 hover:bg-white"
                >
                  Date
                  <span aria-hidden="true" className="text-[10px]">
                    {sort?.column === "opened" ? (sort.dir === "asc" ? "↑" : "↓") : "↕"}
                  </span>
                </button>
              </th>
              <th className="sticky top-16 z-20 border-b border-slate-200 bg-white px-2 py-2 text-left font-medium uppercase tracking-wide">Lead</th>
              <NextDayHead rows={rows} day={nextDay} onChange={setNextDay} />
              {COLUMNS.map((column, index) => (
                <HeadSort
                  key={column.id}
                  label={column.label}
                  column={column.id}
                  align={index >= COLUMNS.length - 2 ? "end" : "start"}
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
                <td className="px-2 py-2 whitespace-pre-line leading-tight text-slate-700">{row.openedLabel}</td>
                <td className="px-2 py-2">
                  <button
                    type="button"
                    onClick={() => pick(row.id)}
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
                  <ActionLines lines={row.nextAction} />
                </td>
                <td className="px-2 py-2 text-center">
                  <span className={`inline-flex rounded-full px-2 py-0.5 font-medium leading-tight ${row.stageClassName}`}>
                    {row.label}
                  </span>
                  {row.nonPi ? (
                    row.referralSent ? (
                      <p className="mt-1 text-[11px] font-medium text-emerald-800">Referral sent</p>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          if (!canLeave.current()) return;
                          pick(row.id);
                          setReferralOpenId(row.id);
                        }}
                        className="mt-1 cursor-pointer rounded px-1 text-[11px] font-medium text-orange-800 underline transition-colors hover:bg-orange-100"
                      >
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
                  <YesNoCell row={row} field="qualified" value={row.qualifiedLabel} action={setQualified} fit />
                </td>
                <td className="px-1 py-2 text-center">
                  {row.desiredLocked ? (
                    <span className="font-medium text-slate-900">{row.desired}</span>
                  ) : (
                    <YesNoCell row={row} field="desired" value={row.desired} action={setDesired} fit />
                  )}
                </td>
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
        <LeadDrawer
          key={selected.id}
          row={selected}
          destinations={destinations}
          templates={templates}
          staff={staff}
          admin={admin}
          startReferral={referralOpenId === selected.id}
          canLeave={canLeave}
          onClose={() => {
            if (!canLeave.current()) return;
            setSelectedId("");
          }}
        />
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
  sort: { column: SortColumn; dir: "asc" | "desc" } | null;
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

function TextStartButtons({ leadId, compact = false }: { leadId: string; compact?: boolean }) {
  const [state, action, pending] = useActionState(startTextSequence, null);
  const notify = useContext(DrawerNoticeContext);
  const wasPending = useRef(false);
  useEffect(() => {
    if (pending) {
      wasPending.current = true;
      notify({ tone: "saving", text: "Saving…" });
      return;
    }
    if (!wasPending.current) return;
    wasPending.current = false;
    notify(state?.error ? { tone: "error", text: state.error } : { tone: "saved", text: "Saved" });
  }, [notify, pending, state]);
  const button = compact
    ? "cursor-pointer rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] font-medium leading-tight text-slate-700 transition-colors hover:border-navy hover:bg-slate-100 hover:text-navy disabled:opacity-60"
    : "";
  return (
    <form action={action} className={compact ? "flex flex-col items-center gap-1" : "flex flex-wrap gap-2"}>
      <input type="hidden" name="lead_id" value={leadId} />
      <button name="sequence" value="new-lead" disabled={pending} className={compact ? button : buttonPrimary}>
        New lead
      </button>
      <button name="sequence" value="more-info" disabled={pending} className={compact ? button : buttonSecondary}>
        More info
      </button>
      {state?.error ? <p className="w-full text-[11px] font-medium text-red-700">{state.error}</p> : null}
    </form>
  );
}

function TextAutomation({ row }: { row: QueueRow }) {
  if (row.textsLive) {
    return <span className={row.automationBad ? "font-medium text-red-700" : "font-medium text-slate-800"}>{row.automationLabel}</span>;
  }
  if (!row.canStartText) {
    return <span className={row.automationBad ? "font-medium text-red-700" : "text-slate-400"}>{row.automationLabel}</span>;
  }
  return <TextStartButtons leadId={row.id} compact />;
}

function YesNoCell({
  row,
  field,
  value,
  action,
  align = "center",
  fit = false,
}: {
  row: QueueRow;
  field: "qualified" | "desired";
  value: string;
  action: (formData: FormData) => Promise<void>;
  align?: "center" | "start";
  fit?: boolean;
}) {
  const label = field === "qualified" ? "Qualified" : "Desired";
  const notify = useContext(DrawerNoticeContext);
  const [pending, setPending] = useState<"yes" | "no" | null>(null);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  const unknown = value !== "Yes" && value !== "No";

  async function choose(decision: "yes" | "no") {
    const selected = decision === "yes" ? "Yes" : "No";
    if (value === selected || pending) return;
    setPending(decision);
    setSaved(false);
    setFailed(false);
    notify({ tone: "saving", text: "Saving…" });
    const data = new FormData();
    data.set("lead_id", row.id);
    data.set("decision", decision);
    try {
      await action(data);
      setSaved(true);
      notify({ tone: "saved", text: "Saved" });
    } catch {
      setFailed(true);
      notify({ tone: "error", text: "Could not save." });
    } finally {
      setPending(null);
    }
  }

  const side = fit
    ? "flex h-7 min-w-0 flex-1 cursor-pointer items-center justify-center whitespace-nowrap px-1 text-[11px] font-medium leading-none transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent disabled:cursor-default"
    : "h-9 min-w-0 flex-1 cursor-pointer px-2 text-sm font-medium transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent disabled:cursor-default";

  return (
    <div className={`flex flex-col ${align === "start" ? "items-stretch" : "items-center"}`}>
      <div className={`relative ${fit ? "mx-auto w-full max-w-[6.5rem]" : "w-full"}`}>
        <div className="flex w-full overflow-hidden rounded-lg border border-slate-300 bg-white" role="group" aria-label={label}>
          <button
            type="button"
            aria-label={`${label} yes`}
            aria-pressed={value === "Yes"}
            disabled={pending !== null}
            onClick={() => void choose("yes")}
            className={`${side} border-r border-slate-300 ${
              value === "Yes" ? "bg-emerald-50 text-emerald-900 hover:bg-emerald-100" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            {value === "Yes" ? "✓ Yes" : "Yes"}
          </button>
          <button
            type="button"
            aria-label={`${label} no`}
            aria-pressed={value === "No"}
            disabled={pending !== null}
            onClick={() => void choose("no")}
            className={`${side} ${value === "No" ? "bg-slate-200 text-slate-900 hover:bg-slate-300" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}
          >
            No
          </button>
        </div>
        <span className={`absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full ${unknown ? "bg-amber-500" : "bg-transparent"}`} aria-hidden="true" />
      </div>
      <span className="mt-0.5 h-4 text-[11px] font-medium" aria-live="polite">
        {failed ? <span className="text-red-700">Failed</span> : pending ? <span className="text-slate-500">Saving</span> : saved ? <span className="text-emerald-700">Saved</span> : null}
      </span>
    </div>
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
        <button className="mx-auto inline-flex w-full max-w-[5.25rem] items-center justify-center rounded-lg border border-slate-300 bg-white px-1.5 py-1.5 text-center text-[11px] font-medium leading-tight text-navy shadow-sm transition duration-150 hover:border-navy hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2">
          Flag priority
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

function fieldClass(locked = false) {
  return locked
    ? "mt-1 w-full cursor-not-allowed rounded-md border border-slate-200 bg-slate-100 px-2 py-1.5 text-sm font-normal normal-case tracking-normal text-slate-400"
    : "mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm font-normal normal-case tracking-normal text-slate-900";
}

function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
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

function detailGap(input: {
  consulted: "yes" | "no" | "";
  consultDate: string;
  qualified: "yes" | "no" | "";
  notQualified: string;
  desired: "yes" | "no" | "";
  size: string;
  decline: string;
  signedChoice: "yes" | "no" | "";
  signedDate: string;
  admin: boolean;
}): string | null {
  if (input.consulted === "yes" && !input.consultDate) return "Enter the consultation date before saving or closing.";
  if (input.qualified === "no" && !input.notQualified) return "Choose a Not Qualified reason before saving or closing.";
  if (input.qualified === "no" && input.desired === "yes") return "A lead that is not qualified is not desired.";
  if (input.desired === "yes" && !input.size) return "Choose a size before saving or closing.";
  if (input.desired === "no" && !input.decline) return "Choose a decline reason before saving or closing.";
  if (input.admin && input.signedChoice === "yes" && !input.signedDate) return "Enter the signed date before saving or closing.";
  return null;
}

function LeadFacts({
  row,
  staff,
  admin,
  canLeave,
}: {
  row: QueueRow;
  staff: string[];
  admin: boolean;
  canLeave: RefObject<() => boolean>;
}) {
  const notify = useContext(DrawerNoticeContext);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState({ consult: false, qualified: false, desired: false, signed: false });
  const [consulted, setConsulted] = useState<"yes" | "no" | "">(row.consulted);
  const [consultDate, setConsultDate] = useState(row.consultKey.slice(0, 10));
  const [qualified, setQualifiedChoice] = useState<"yes" | "no" | "">(row.qualifiedLabel === "Yes" ? "yes" : row.qualifiedLabel === "No" ? "no" : "");
  const [notQualified, setNotQualified] = useState(selectedOne(row.tags, NOT_QUALIFIED_TAGS));
  const [desired, setDesiredChoice] = useState<"yes" | "no" | "">(row.desired === "Yes" ? "yes" : row.desired === "No" ? "no" : "");
  const [size, setSize] = useState(selectedOne(row.tags, SIZE_TAGS));
  const [decline, setDecline] = useState(selectedDecline(row.tags));
  const [signedChoice, setSignedChoice] = useState<"yes" | "no" | "">(row.signed ? "yes" : "");
  const [signedDate, setSignedDate] = useState(row.signedDate);
  const contractLocked = row.desiredLocked && row.qualifiedLabel !== "No";
  const { pending: confirming, submit: confirmSubmit } = useNotedSubmit();

  function gap() {
    return detailGap({ consulted, consultDate, qualified, notQualified, desired, size, decline, signedChoice, signedDate, admin });
  }

  function exitGap() {
    if (dirty.consult && consulted === "yes" && !consultDate) return "Enter the consultation date before saving or closing.";
    if (dirty.qualified && qualified === "no" && !notQualified) return "Choose a Not Qualified reason before saving or closing.";
    if ((dirty.qualified || dirty.desired) && qualified === "no" && desired === "yes") return "A lead that is not qualified is not desired.";
    if (dirty.desired && desired === "yes" && !size) return "Choose a size before saving or closing.";
    if (dirty.desired && desired === "no" && !decline) return "Choose a decline reason before saving or closing.";
    if (dirty.signed && admin && signedChoice === "yes" && !signedDate) return "Enter the signed date before saving or closing.";
    return null;
  }

  canLeave.current = () => {
    const message = exitGap();
    if (!message) return true;
    notify({ tone: "error", text: message });
    return false;
  };

  function mark(key: "consult" | "qualified" | "desired" | "signed") {
    setDirty((current) => ({ ...current, [key]: true }));
    setSaved(false);
  }

  async function onSubmit(formData: FormData) {
    const message = gap();
    if (message) {
      setError(message);
      notify({ tone: "error", text: message });
      return;
    }
    setPending(true);
    setSaved(false);
    setError(null);
    notify({ tone: "saving", text: "Saving…" });
    try {
      await saveLeadDetails(formData);
      const tagsData = new FormData();
      tagsData.set("qualified_tag", qualified === "yes" ? QUALIFIED_YES : qualified === "no" ? QUALIFIED_NO : "");
      tagsData.set("not_qualified_tag", qualified === "yes" ? "" : notQualified);
      tagsData.set("decline_tag", desired === "yes" ? "" : decline);
      tagsData.set("size_tag", desired === "no" ? "" : size);
      await saveLeadTags(row.id, tagsData);
      if (qualified === "yes" || qualified === "no") {
        const decision = new FormData();
        decision.set("lead_id", row.id);
        decision.set("decision", qualified);
        await setQualified(decision);
      }
      if (!contractLocked && (desired === "yes" || desired === "no")) {
        const decision = new FormData();
        decision.set("lead_id", row.id);
        decision.set("decision", desired);
        await setDesired(decision);
      }
      setSaved(true);
      setDirty({ consult: false, qualified: false, desired: false, signed: false });
      notify({ tone: "saved", text: "Saved" });
    } catch (err) {
      const text = err instanceof Error ? err.message : "Could not save";
      notify({ tone: "error", text });
      setError(text);
    } finally {
      setPending(false);
    }
  }
  const caseOptions = new Set<string>(PI_CASE_TYPES);
  if (row.caseType) caseOptions.add(row.caseType);
  const formId = `lead-details-${row.id}`;
  const nameValue = row.leadName || (row.title === "Not captured" ? "" : row.title);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <form id={formId} action={onSubmit} className="space-y-4">
          <input type="hidden" name="lead_id" value={row.id} />
          <PanelSection title="Contact">
            <FieldLabel label="Name" className="col-span-2">
              <input name="lead_name" defaultValue={nameValue} className={fieldClass()} />
            </FieldLabel>
            <FieldLabel label="Phone">
              <input name="phone" defaultValue={row.phone ?? ""} className={fieldClass()} />
            </FieldLabel>
            <FieldLabel label="Email">
              <input name="email" defaultValue={row.email ?? ""} className={fieldClass()} />
            </FieldLabel>
          </PanelSection>
          <input type="hidden" name="consulted" value={consulted} />
          {admin ? <input type="hidden" name="signed_decision" value={signedChoice} /> : null}
          <PanelSection title="Marketing">
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
            <FieldLabel label="Lead source">
              <input name="lead_source" list="lead-source-examples" defaultValue={row.leadSource} placeholder="Google, Friend, Attorney" className={fieldClass()} />
              <datalist id="lead-source-examples">
                {LEAD_SOURCES.map((item) => (
                  <option key={item.source} value={item.source} />
                ))}
              </datalist>
            </FieldLabel>
          </PanelSection>
          {row.signed ? null : <NonLeadChoice row={row} />}
          <PanelSection title="Case type">
            <FieldLabel label="Case type" className="col-span-2">
              <select name="case_type" defaultValue={row.caseType} className={fieldClass()}>
                <option value="">Not set</option>
                {[...caseOptions].map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </FieldLabel>
          </PanelSection>
          <PanelSection title="Consultation">
            <div className="col-span-2 sm:col-span-1">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Consultation</p>
              <div className="mt-1">
                <ChoiceToggle
                  label="Consultation"
                  value={consulted}
                  onChange={(value) => {
                    mark("consult");
                    setConsulted(value);
                    if (value === "no") setConsultDate("");
                  }}
                />
              </div>
            </div>
            <FieldLabel label="Consultation date">
              <input
                type="date"
                name="consultation_date"
                value={consultDate}
                required={consulted === "yes"}
                disabled={consulted !== "yes"}
                onChange={(event) => {
                  mark("consult");
                  setConsultDate(event.target.value);
                }}
                className={fieldClass(consulted !== "yes")}
              />
            </FieldLabel>
          </PanelSection>
          <PanelSection title="Qualified">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Qualified</p>
              <div className="mt-1">
                <ChoiceToggle
                  label="Qualified"
                  value={qualified}
                  onChange={(value) => {
                    mark("qualified");
                    setQualifiedChoice(value);
                    if (value === "yes") setNotQualified("");
                  }}
                />
              </div>
            </div>
            <FieldLabel label="Not qualified">
              <select
                value={notQualified}
                required={qualified === "no"}
                disabled={qualified !== "no"}
                onChange={(event) => {
                  mark("qualified");
                  setNotQualified(event.target.value);
                }}
                className={fieldClass(qualified !== "no")}
              >
                <option value="">{qualified === "no" ? "Choose a reason" : "Locked"}</option>
                {NOT_QUALIFIED_TAGS.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag.slice("NQ: ".length)}
                  </option>
                ))}
              </select>
            </FieldLabel>
          </PanelSection>
          <PanelSection title="Desired">
            <div className="col-span-2">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Desired</p>
              <div className="mt-1 max-w-[12rem]">
                <ChoiceToggle
                  label="Desired"
                  value={desired}
                  disabled={contractLocked}
                  onChange={(value) => {
                    mark("desired");
                    setDesiredChoice(value);
                    if (value === "yes") setDecline("");
                    if (value === "no") setSize("");
                  }}
                />
              </div>
            </div>
            <FieldLabel label="Size">
              <select
                value={size}
                required={desired === "yes"}
                disabled={desired !== "yes"}
                onChange={(event) => {
                  mark("desired");
                  setSize(event.target.value);
                }}
                className={fieldClass(desired !== "yes")}
              >
                <option value="">{desired === "yes" ? "Choose a size" : "Locked"}</option>
                {SIZE_TAGS.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag.slice("S: ".length)}
                  </option>
                ))}
              </select>
            </FieldLabel>
            <FieldLabel label="Decline reason">
              <select
                value={decline}
                required={desired === "no"}
                disabled={desired !== "no"}
                onChange={(event) => {
                  mark("desired");
                  setDecline(event.target.value);
                }}
                className={fieldClass(desired !== "no")}
              >
                <option value="">{desired === "no" ? "Choose a reason" : "Locked"}</option>
                {DECLINE_TAGS.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag.slice("DEC: ".length)}
                  </option>
                ))}
              </select>
            </FieldLabel>
          </PanelSection>
          <PanelSection title="Signed">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Signed</p>
              <div className="mt-1">
                <ChoiceToggle
                  label="Signed"
                  value={signedChoice}
                  disabled={!admin}
                  onChange={(value) => {
                    mark("signed");
                    setSignedChoice(value);
                    if (value === "no") setSignedDate("");
                  }}
                />
              </div>
              {admin ? null : <p className="mt-1 text-xs normal-case tracking-normal text-slate-500">Locked until an admin changes it.</p>}
            </div>
            <FieldLabel label="Signed date">
              <input
                type="date"
                name="date_signed"
                value={signedDate}
                required={admin && signedChoice === "yes"}
                disabled={!admin}
                onChange={(event) => {
                  mark("signed");
                  setSignedDate(event.target.value);
                }}
                className={fieldClass(!admin)}
              />
            </FieldLabel>
            {row.confirmSigned ? (
              <button
                type="button"
                disabled={confirming}
                onClick={() => {
                  const data = new FormData();
                  data.set("lead_id", row.id);
                  void confirmSubmit(() => confirmSigned(data));
                }}
                className="col-span-2 w-fit cursor-pointer rounded-md bg-navy px-3 py-1.5 text-sm font-medium normal-case tracking-normal text-white hover:bg-[#16366e] disabled:cursor-default disabled:opacity-60"
              >
                {confirming ? "Saving…" : "Confirm signed"}
              </button>
            ) : null}
          </PanelSection>
          <TalkedWith row={row} staff={staff} />
        </form>
      </div>
      <div className="border-t border-slate-200 bg-white px-4 py-3">
        {error ? <p className="mb-2 text-sm text-red-700">{error}</p> : null}
        <button
          form={formId}
          disabled={pending}
          className={`${buttonPrimary} w-full ${saved && !pending ? "!bg-emerald-600 hover:!bg-emerald-700" : ""}`}
        >
          <ButtonLabel value={pending ? "Saving…" : saved ? "✓ Saved" : "Save"} reserve={["Saving…", "✓ Saved", "Save"]} />
        </button>
      </div>
    </div>
  );
}

function QueueReferral({
  row,
  destinations,
  templates,
  startOpen = false,
}: {
  row: QueueRow;
  destinations: ReferralDestination[];
  templates: { en: string; es: string };
  startOpen?: boolean;
}) {
  const firms = referralFirms(destinations);
  const types = PRACTICE_AREAS.filter((area) => firms.some((firm) => firm.practice_areas.includes(area.id)));
  const sectionRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(startOpen);
  const [area, setArea] = useState(types.some((item) => item.id === row.practiceArea) ? (row.practiceArea ?? "") : "");
  const [firmId, setFirmId] = useState("");
  const [language, setLanguage] = useState<"en" | "es">("en");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const notify = useContext(DrawerNoticeContext);
  const partners = area ? firms.filter((firm) => firm.practice_areas.includes(area)) : [];
  const firm = partners.find((item) => item.id === firmId) ?? null;
  useEffect(() => {
    if (!startOpen) return;
    setOpen(true);
    sectionRef.current?.scrollIntoView({ block: "nearest" });
  }, [startOpen]);
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
      setError("Choose a referral type and a partner.");
      return;
    }
    setPending(true);
    setError(null);
    notify({ tone: "saving", text: "Saving…" });
    const data = new FormData();
    data.set("destination_id", firm.id);
    data.set("language", language);
    data.set("practice_area", area);
    try {
      const result = kind === "send" ? await sendReferral(row.id, data) : await markReferralAlreadySent(row.id, data);
      if (result.error) {
        notify({ tone: "error", text: result.error });
        setError(result.error);
        return;
      }
      notify({ tone: "saved", text: "Saved" });
    } catch (err) {
      notify({ tone: "error", text: err instanceof Error ? err.message : "Could not record the referral" });
      setError(err instanceof Error ? err.message : "Could not record the referral");
    } finally {
      setPending(false);
    }
  }

  const fieldClass = "mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm font-normal normal-case tracking-normal text-slate-900 disabled:cursor-default disabled:bg-slate-100 disabled:text-slate-400";

  return (
    <section ref={sectionRef}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Referral</h3>
      {row.referralSent ? (
        <p className="mt-2 text-sm font-medium text-emerald-800">
          Referral sent{row.referralFirm ? ` · ${row.referralFirm}` : ""}
        </p>
      ) : !open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-2 cursor-pointer rounded-md bg-navy px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#16366e]"
        >
          Send referral
        </button>
      ) : firms.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">Add a firm on the Referrals page first.</p>
      ) : (
        <div className="mt-2 space-y-2">
          <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
            Referral type
            <select
              value={area}
              onChange={(event) => {
                setArea(event.target.value);
                setFirmId("");
              }}
              className={fieldClass}
            >
              <option value="">Choose the type</option>
              {types.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
            Referral partner
            <select
              value={firm?.id ?? ""}
              disabled={!area}
              onChange={(event) => setFirmId(event.target.value)}
              className={fieldClass}
            >
              <option value="">{area ? "Choose the partner" : "Choose a type first"}</option>
              {partners.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.phone ? ` · ${item.phone}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
            Language
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value === "es" ? "es" : "en")}
              className={fieldClass}
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
              disabled={pending || !firm || !area}
              onClick={() => void submit("send")}
              className="cursor-pointer rounded-md bg-navy px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#16366e] disabled:cursor-default disabled:opacity-60"
            >
              {pending ? "Saving…" : "Send referral"}
            </button>
            <button
              type="button"
              disabled={pending || !firm || !area}
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

export function LeadDrawer({
  row,
  destinations,
  templates,
  staff,
  admin = false,
  startReferral = false,
  canLeave,
  onClose,
}: {
  row: QueueRow;
  destinations: ReferralDestination[];
  templates: { en: string; es: string };
  staff: string[];
  admin?: boolean;
  startReferral?: boolean;
  canLeave?: RefObject<() => boolean>;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"overview" | "details" | "activity">("overview");
  useEffect(() => {
    if (startReferral) setTab("overview");
  }, [startReferral]);
  const [notice, setNotice] = useState<DrawerNotice | null>(null);
  const [touches, setTouches] = useState<Touch[] | null>(null);
  useEffect(() => {
    setNotice(null);
  }, [row.id]);
  useEffect(() => {
    if (!notice || notice.tone === "saving") return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);
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
        <button
          type="button"
          onClick={() => {
            if (canLeave && !canLeave.current()) return;
            onClose();
          }}
          className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        >
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
            onClick={() => {
              if (tab === "details" && id !== "details" && canLeave && !canLeave.current()) return;
              setTab(id);
            }}
            className={`cursor-pointer border-b-2 px-3 py-2 text-sm font-medium ${
              tab === id ? "border-navy text-navy" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {notice ? (
        <p
          role="status"
          className={`px-4 py-2.5 text-sm font-semibold text-white ${
            notice.tone === "saved" ? "bg-emerald-600" : notice.tone === "saving" ? "bg-navy" : "bg-red-700"
          }`}
        >
          {notice.text}
        </p>
      ) : null}
      <DrawerNoticeContext.Provider value={setNotice}>
      {row.identityStatus === "needs_review" ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3">
          <IdentityShelf row={row} />
        </div>
      ) : null}
      <div className={tab === "details" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
        <LeadFacts row={row} staff={staff} admin={admin} canLeave={canLeave ?? { current: () => true }} />
      </div>
      {tab === "details" ? null : (
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {tab === "activity" ? (
          <section>
            {touches === null ? (
              <p className="text-sm text-slate-500">Loading activity…</p>
            ) : touches.length === 0 ? (
              <p className="text-sm text-slate-500">No calls, texts, or Slack notes yet.</p>
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
                    {touch.grade ? (
                      <p className="mt-1 text-sm text-slate-800">
                        <span className={`mr-2 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${callGradeClass(touch.grade)}`}>
                          {touch.grade}
                        </span>
                        {touch.gradeHandler ? <span className="font-medium">{touch.gradeHandler}</span> : null}
                        {touch.gradeReason ? <span className="text-slate-600">{touch.gradeHandler ? " — " : ""}{touch.gradeReason}</span> : null}
                      </p>
                    ) : null}
                    {touch.content ? <p className="mt-0.5 whitespace-pre-wrap text-slate-600">{touch.content}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : (
          <>
        <div className="flex flex-wrap gap-3 text-sm">
          {row.quoUrl ? (
            <a href={row.quoUrl} className={buttonSecondary} target="_blank" rel="noreferrer">
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
            <ActionLines lines={row.nextAction} layout="row" />
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
              {row.canStartText ? <TextStartButtons leadId={row.id} /> : null}
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
        {row.nonPi && !row.signed && !row.referralSent ? (
          <QueueReferral row={row} destinations={destinations} templates={templates} startOpen={startReferral} />
        ) : null}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Summary</h3>
          <p className="mt-2 text-sm leading-6 text-slate-800">{row.summary?.trim() || "No call summary yet."}</p>
        </section>
          </>
        )}
      </div>
      )}
      </DrawerNoticeContext.Provider>
    </aside>
  );
}

function NextActionEdit({ row, staff }: { row: QueueRow; staff: string[] }) {
  const call = row.nextAction.find((line) => line.label === "Call" && line.at);
  const reminder = row.nextAction.find((line) => line.label === "Reminder" && line.at);
  const canEdit = Boolean((row.callJobId && call?.at) || reminder?.at);
  if (!canEdit) return null;
  const extra = row.callTag && row.callTag !== "Outbound" && !staff.includes(row.callTag) ? [row.callTag] : [];
  const names = [...extra, ...staff];
  return (
    <NotedForm
      action={setNextAction}
      formKey={`${row.id}:${row.callJobId ?? ""}:${call?.at ?? ""}:${row.callTag ?? ""}:${reminder?.at ?? ""}`}
      className="mt-3 space-y-2 rounded-md bg-slate-50 px-3 py-2"
      idleLabel="Save next action"
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
              defaultValue={row.callTag || "Outbound"}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm font-normal normal-case tracking-normal text-slate-900"
            >
              <option value="Outbound">Slack Outbound</option>
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
    </NotedForm>
  );
}

function rowCloseGaps(row: QueueRow, kind: "lead" | "nonlead" = "lead") {
  return closeGaps(
    {
      lead_name: row.leadName,
      phone: row.phone,
      email: row.email,
      identity_status: row.identityStatus,
      owner_name: row.owner,
      qualified: row.qualifiedLabel === "Yes" ? true : row.qualifiedLabel === "No" ? false : null,
      callrail_tags: row.tags,
      desired_case: row.desired === "Yes" ? true : row.desired === "No" ? false : null,
      signed_case: row.signed,
      date_signed: row.signedDate,
      caller_class: row.callerClass,
      case_type: row.caseType,
      lead_source: row.leadSource,
      source_type: row.sourceType,
      consultation: row.consulted === "yes" ? "staff" : row.consulted === "no" ? "no" : null,
      consultation_date: row.consultKey,
    },
    kind,
  );
}

function IdentityShelf({ row }: { row: QueueRow }) {
  const currentName = row.leadName || (row.title === "Not captured" ? "" : row.title);
  const heard = heardClientName(row.identityEvidence);
  return (
    <NotedForm action={resolveIdentity.bind(null, row.id)}>
      <p className="text-sm font-medium text-amber-950">{heard ? `Heard ${heard}` : "Check the name"}</p>
      <input
        name="client_name"
        aria-label="Client name"
        defaultValue={row.suggestedName || currentName}
        className="mt-2 w-full rounded-md border border-amber-300 bg-white px-2 py-1.5 text-sm text-slate-900"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        {currentName ? (
          <button name="decision" value="keep" className="cursor-pointer rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-950 transition-colors hover:border-amber-500 hover:bg-amber-100">
            Keep {currentName}
          </button>
        ) : null}
        <button name="decision" value="replace" className="cursor-pointer rounded-md bg-navy px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#16366e]">
          Save
        </button>
      </div>
    </NotedForm>
  );
}

function TalkedWith({ row, staff }: { row: QueueRow; staff: string[] }) {
  const known = row.owner && !isPlaceholderOwner(row.owner) && row.owner !== "Outbound" ? row.owner : "";
  const names = known && !staff.includes(known) ? [known, ...staff] : staff;
  const { pending, submit } = useNotedSubmit();
  return (
    <PanelSection title="Slack tag">
      <FieldLabel label="Slack tag" className="col-span-2">
        <select
          key={`${row.id}:${row.owner ?? ""}`}
          defaultValue={known || "Outbound"}
          disabled={pending}
          onChange={(event) => {
            const data = new FormData();
            data.set("lead_id", row.id);
            data.set("owner_name", event.target.value);
            void submit(() => setTalkedWith(data));
          }}
          className={`${fieldClass()} cursor-pointer`}
        >
          <option value="Outbound">Slack Outbound</option>
          {names.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </FieldLabel>
    </PanelSection>
  );
}

function NotedForm({
  action,
  children,
  className,
  formKey,
  idleLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  children: ReactNode;
  className?: string;
  formKey?: string;
  idleLabel?: string;
}) {
  const { pending, submit } = useNotedSubmit();
  return (
    <form
      key={formKey}
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const submitter = (event.nativeEvent as SubmitEvent).submitter;
        if (submitter instanceof HTMLButtonElement && submitter.name) data.set(submitter.name, submitter.value);
        void submit(() => action(data));
      }}
    >
      {children}
      {idleLabel ? (
        <button type="submit" disabled={pending} className="mt-3 cursor-pointer rounded-md bg-navy px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#16366e] disabled:cursor-default disabled:opacity-60">
          <ButtonLabel value={pending ? "Saving…" : idleLabel} reserve={["Saving…", idleLabel]} />
        </button>
      ) : null}
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
    <NotedForm action={reviewPrioritySuggestion} className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm">
      <input type="hidden" name="lead_id" value={row.id} />
      <p className="font-medium text-sky-950">Suggested priority</p>
      <p className="mt-1 text-sky-900">{row.prioritySuggestion}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button name="decision" value="confirm" className="cursor-pointer rounded-md bg-navy px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#16366e]">
          Add to priority
        </button>
        <button name="decision" value="dismiss" className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm transition-colors hover:border-navy hover:bg-slate-100 hover:text-navy">
          Not a priority
        </button>
      </div>
    </NotedForm>
  );
}

function CloseSuggestion({ row }: { row: QueueRow }) {
  if (!row.closeSuggestion) return null;
  const suggestion = row.closeSuggestion;
  return (
    <NotedForm action={confirmCloseSuggestion} className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm">
      <input type="hidden" name="lead_id" value={row.id} />
      <input type="hidden" name="suggestion" value={suggestion} />
      <p className="font-medium text-orange-950">Suggested close: {CLOSE_SUGGESTION_LABEL[suggestion]}</p>
      {rowCloseGaps(row, suggestion === "not_a_lead" ? "nonlead" : "lead").length ? (
        <p className="mt-2 text-orange-900">
          Closing needs: {rowCloseGaps(row, suggestion === "not_a_lead" ? "nonlead" : "lead").join(", ")}.
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {suggestion === "decline" ? (
          <>
            <button name="decision" value="decline" className="cursor-pointer rounded-md bg-navy px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#16366e]">
              Decline
            </button>
            <button name="decision" value="refer" className="cursor-pointer rounded-md bg-navy px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#16366e]">
              Refer
            </button>
          </>
        ) : (
          <button name="decision" value="confirm" className="cursor-pointer rounded-md bg-navy px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#16366e]">
            Confirm close
          </button>
        )}
        <button name="decision" value="dismiss" className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm transition-colors hover:border-navy hover:bg-slate-100 hover:text-navy">
          Keep open
        </button>
      </div>
    </NotedForm>
  );
}

function NonLeadChoice({ row }: { row: QueueRow }) {
  const current = EXCLUDED_CALLER_CLASSES.find((item) => item === row.callerClass) ?? "";
  const gaps = rowCloseGaps(row, "nonlead");
  const { pending, submit } = useNotedSubmit();
  const [reason, setReason] = useState(current);
  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Not a lead</h3>
      {gaps.length ? <p className="mt-2 text-sm text-orange-800">Closing needs: {gaps.join(", ")}.</p> : null}
      <label className="mt-2 block text-xs font-medium uppercase tracking-wide text-slate-500">
        Reason
        <select
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className={fieldClass()}
        >
          <option value="">Choose a reason</option>
          {EXCLUDED_CALLER_CLASSES.filter((item) => item !== "spam").map((item) => (
            <option key={item} value={item}>
              {NON_LEAD_TAG[item]}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={pending || !reason}
        onClick={() => {
          const data = new FormData();
          data.set("lead_id", row.id);
          data.set("caller_class", reason);
          void submit(() => classifyNonLead(data));
        }}
        className="mt-3 cursor-pointer rounded-md bg-navy px-3 py-1.5 text-sm font-medium normal-case tracking-normal text-white transition-colors hover:bg-[#16366e] disabled:cursor-default disabled:opacity-60"
      >
        <ButtonLabel value={pending ? "Saving…" : "Move to non-leads"} reserve={["Saving…", "Move to non-leads"]} />
      </button>
    </section>
  );
}

function ChoiceToggle({
  label,
  value,
  disabled = false,
  onChange,
}: {
  label: string;
  value: "yes" | "no" | "";
  disabled?: boolean;
  onChange: (value: "yes" | "no") => void;
}) {
  const side =
    "flex h-9 min-w-0 flex-1 cursor-pointer items-center justify-center px-2 text-sm font-medium normal-case tracking-normal transition duration-150 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent";
  return (
    <div className={`flex w-full overflow-hidden rounded-lg border border-slate-300 bg-white ${disabled ? "bg-slate-100" : ""}`} role="group" aria-label={label}>
      <button
        type="button"
        aria-pressed={value === "yes"}
        disabled={disabled}
        onClick={() => onChange("yes")}
        className={`${side} border-r border-slate-300 ${value === "yes" ? "bg-emerald-50 text-emerald-900 hover:bg-emerald-100" : "text-slate-600"}`}
      >
        {value === "yes" ? "✓ Yes" : "Yes"}
      </button>
      <button
        type="button"
        aria-pressed={value === "no"}
        disabled={disabled}
        onClick={() => onChange("no")}
        className={`${side} ${value === "no" ? "bg-slate-200 text-slate-900 hover:bg-slate-300" : "text-slate-600"}`}
      >
        No
      </button>
    </div>
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

function callGradeClass(letter: string): string {
  if (letter === "A") return "bg-emerald-50 text-emerald-800";
  if (letter === "B") return "bg-sky-50 text-sky-800";
  if (letter === "C") return "bg-amber-50 text-amber-900";
  if (letter === "D") return "bg-orange-50 text-orange-900";
  return "bg-red-50 text-red-800";
}

function touchLabel(touch: Touch): string {
  if ((touch.type || "").toLowerCase() === "slack") return touch.actor ? `Slack · ${touch.actor}` : "Slack";
  const type = (touch.type || "note").replaceAll("_", " ");
  const direction = (touch.direction || "").toLowerCase();
  if (direction === "inbound") return `Inbound ${type}`;
  if (direction === "outbound") return `Outbound ${type}`;
  return type.charAt(0).toUpperCase() + type.slice(1);
}
