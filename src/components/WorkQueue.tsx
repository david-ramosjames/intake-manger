"use client";

import { createContext, useActionState, useContext, useEffect, useLayoutEffect, useRef, useState, useTransition, type MouseEvent, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { IdentityMark } from "@/components/IdentityMark";
import { CLOSE_SUGGESTION_LABEL } from "@/lib/funnel";
import { heardClientName } from "@/lib/identity";
import { EXCLUDED_CALLER_CLASSES, NON_LEAD_TAG } from "@/lib/caller-class";
import { DECLINE_TAGS, QUALIFIED_NO, QUALIFIED_YES, SIZE_TAGS, selectedDecline, selectedOne } from "@/lib/tags";
import { canonicalLeadSource, caseTypeChoices, emailIsUnavailable, EMAIL_NOT_AVAILABLE, isSourceType, leadSourceFromText, leadSourcesFor, officialCaseType, SOURCE_TYPE_OPTIONS, standardLeadEmail } from "@/lib/leads";
import { closeGaps } from "@/lib/close-ready";
import { callJobHeaderClass, callJobLabel } from "@/lib/call-grade";
import { LOST_LEAD_REASONS, isLostLeadReason, type LostLeadReason } from "@/lib/funnel";
import { classifyNonLead, confirmCloseSuggestion, confirmSigned, markPriority, markReferralAlreadySent, reviewPrioritySuggestion, resolveIdentity, saveLeadDetails, saveLeadTags, sendReferral, setConsultation, setDesired, setLostLead, setNextAction, setQualified, startTextSequence } from "@/lib/ops-actions";
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
  lostReason: LostLeadReason | null;
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
  screenBy: string | null;
  intakeBy: string | null;
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
  jobs?: string | null;
  screenHandler?: string | null;
  intakeHandler?: string | null;
  screenGrade?: string | null;
  intakeGrade?: string | null;
};

type Column = "type" | "stage" | "consult" | "qualified" | "desired" | "last" | "automation";
type SortColumn = Column | "opened";

const COLUMNS: { id: Exclude<Column, "type">; label: string; width: string }[] = [
  { id: "stage", label: "Stage", width: "8%" },
  { id: "consult", label: "Consult", width: "8%" },
  { id: "qualified", label: "Qualified", width: "8%" },
  { id: "desired", label: "Desired", width: "8%" },
  { id: "last", label: "Last contacted", width: "9%" },
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

function typeLabel(row: Pick<QueueRow, "accident" | "caseType">): string {
  const candidates = [row.caseType, row.accident].map((value) => (value || "").trim()).filter((value) => value && value !== "—");
  for (const text of candidates) {
    const official = officialCaseType(text);
    if (official && official !== "Unknown / No Response") return official;
  }
  return "TBD";
}

function gradeLabel(row: QueueRow): string {
  return row.grade?.trim() || "Not set";
}

function priorityLabel(row: QueueRow): string {
  return row.priority ?? "None";
}

function screenByLabel(row: QueueRow): string {
  return row.screenBy?.trim() || "Not set";
}

function intakeByLabel(row: QueueRow): string {
  return row.intakeBy?.trim() || "Not set";
}

function sourceTypeLabel(row: QueueRow): string {
  return row.sourceType?.trim() || "Not set";
}

function leadSourceLabel(row: QueueRow): string {
  return row.leadSource?.trim() || "Not set";
}

function columnValue(row: QueueRow, column: Column): string {
  if (column === "type") return typeLabel(row);
  if (column === "stage") return row.label;
  if (column === "consult") return row.consultWhen;
  if (column === "qualified") return decisionLabel(row.qualifiedLabel);
  if (column === "desired") return decisionLabel(row.desired);
  if (column === "last") return row.lastLabel;
  return row.automationLabel;
}

function compareRecent(a: QueueRow, b: QueueRow): number {
  const left = a.openedKey || "";
  const right = b.openedKey || "";
  if (left !== right) return right < left ? -1 : 1;
  return a.title.localeCompare(b.title);
}

function decisionLabel(value: string): string {
  if (value === "Yes" || value === "No") return value;
  return "Not yet";
}

function phoneLabel(phone: string | null): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length === 10) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  return phone?.trim() || "—";
}

function sortValue(row: QueueRow, column: SortColumn): string | number {
  if (column === "opened") return row.openedKey || "";
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
  gradeFilter = "",
  priorityFilter = "",
  screenFilter = "",
  intakeFilter = "",
  sourceTypeFilter = "",
  leadSourceFilter = "",
}: {
  rows: QueueRow[];
  initialId?: string;
  destinations: ReferralDestination[];
  templates: { en: string; es: string };
  staff: string[];
  admin?: boolean;
  gradeFilter?: string;
  priorityFilter?: string;
  screenFilter?: string;
  intakeFilter?: string;
  sourceTypeFilter?: string;
  leadSourceFilter?: string;
}) {
  const [selectedId, setSelectedId] = useState(initialId && rows.some((row) => row.id === initialId) ? initialId : "");
  const [shownId, setShownId] = useState(selectedId);
  const [, startOpening] = useTransition();
  const [referralOpenId, setReferralOpenId] = useState("");
  const [filters, setFilters] = useState<Partial<Record<Column, string>>>({});
  const [nextDay, setNextDay] = useState("");
  const [sort, setSort] = useState<{ column: SortColumn; dir: "asc" | "desc" } | null>({ column: "opened", dir: "desc" });
  const canLeave = useRef<() => boolean>(() => true);
  
  function pick(id: string) {
    if (id !== selectedId && !canLeave.current()) return;
    setSelectedId(id);
    if (id !== shownId) startOpening(() => setShownId(id));
  }
  function closeDrawer() {
    if (!canLeave.current()) return;
    setSelectedId("");
    setShownId("");
  }
  function openFromRow(event: MouseEvent<HTMLTableRowElement>, id: string) {
    const target = event.target;
    if (target instanceof Element && target.closest("a, button, input, select, textarea, label")) return;
    pick(id);
  }
  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const shown = rows
    .filter((row) => !nextDay || row.nextDayKey === nextDay)
    .filter((row) => !gradeFilter || gradeLabel(row) === gradeFilter)
    .filter((row) => !priorityFilter || priorityLabel(row) === priorityFilter)
    .filter((row) => !sourceTypeFilter || sourceTypeLabel(row) === sourceTypeFilter)
    .filter((row) => !leadSourceFilter || leadSourceLabel(row) === leadSourceFilter)
    .filter((row) => !screenFilter || screenByLabel(row) === screenFilter)
    .filter((row) => !intakeFilter || intakeByLabel(row) === intakeFilter)
    .filter((row) => !filters.type || columnValue(row, "type") === filters.type)
    .filter((row) => COLUMNS.every((column) => !filters[column.id] || columnValue(row, column.id) === filters[column.id]))
    .sort((a, b) => {
      if (!sort) return compareRecent(a, b);
      const left = sortValue(a, sort.column);
      const right = sortValue(b, sort.column);
      const compared = left < right ? -1 : left > right ? 1 : 0;
      return sort.dir === "asc" ? compared : -compared;
    });

  const opening = Boolean(selected && selected.id !== shownId);

  return (
    <div className={`mt-4 ${selected ? "xl:pr-[29rem]" : ""}`}>
      <div className="min-w-0 rounded-xl border border-slate-200 bg-white relative">
        <table className="w-full table-fixed text-left text-xs">
          <colgroup>
            <col style={{ width: "9%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "10%" }} />
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
                    setSort((current) =>
                      current?.column === "opened" && current.dir === "desc"
                        ? { column: "opened", dir: "asc" }
                        : { column: "opened", dir: "desc" },
                    )
                  }
                  className="inline-flex items-center gap-0.5 rounded-md border border-slate-200 bg-slate-50 px-1 py-1 text-[11px] uppercase leading-tight tracking-normal text-slate-600 hover:border-slate-300 hover:bg-white"
                >
                  Date
                  <span aria-hidden="true" className="text-[10px]">
                    {sort?.column === "opened" ? (sort.dir === "asc" ? "↑" : "↓") : sort ? "↕" : "↓"}
                  </span>
                </button>
              </th>
              <th className="sticky top-16 z-20 border-b border-slate-200 bg-white px-2 py-2 text-left font-medium uppercase tracking-wide">Lead</th>
              <NextDayHead rows={rows} day={nextDay} onChange={setNextDay} />
              <HeadSort
                label="Type"
                column="type"
                align="start"
                rows={rows}
                filter={filters.type ?? ""}
                sort={sort}
                onChange={(value) => {
                  if (value === "sort:asc" || value === "sort:desc") {
                    setSort({ column: "type", dir: value === "sort:asc" ? "asc" : "desc" });
                    return;
                  }
                  if (!value) setSort((current) => (current?.column === "type" ? null : current));
                  setFilters((current) => ({ ...current, type: value }));
                }}
              />
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
                onClick={(event) => openFromRow(event, row.id)}
                aria-selected={row.id === selectedId}
                aria-busy={opening && row.id === selectedId}
                className={`cursor-pointer border-b border-slate-100 last:border-0 ${
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
                  <p className="mt-0.5 text-slate-500">{phoneLabel(row.phone)}</p>
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
                <td className="px-2 py-2 text-slate-700">
                  {columnValue(row, "type") === "TBD" ? <TbdValue /> : <p className="line-clamp-2">{columnValue(row, "type")}</p>}
                </td>
                <td className="px-2 py-2 text-center">
                  <span className={`inline-flex rounded-full px-2 py-0.5 font-medium leading-tight ${row.stageClassName}`}>
                    {row.label}
                  </span>
                  {row.nonPi || row.tags.includes("DEC: Referred") ? (
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
                <td className="px-2 py-2 text-center text-slate-700">{row.consultWhen}</td>
                <td className="px-1 py-2 text-center">
                  <DecisionValue value={row.qualifiedLabel} />
                </td>
                <td className="px-1 py-2 text-center">
                  <DecisionValue value={row.desired} />
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
                <td colSpan={11} className="px-4 py-10 text-center text-slate-500">
                  Nothing in this queue.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {selected ? (
        <div className="fixed top-16 right-4 bottom-4 z-30 flex w-[min(28rem,calc(100vw-2rem))] flex-col">
          {opening ? (
            <DrawerSkeleton row={selected} onClose={closeDrawer} />
          ) : (
            <LeadDrawer
              key={selected.id}
              row={selected}
              destinations={destinations}
              templates={templates}
              staff={staff}
              admin={admin}
              startReferral={referralOpenId === selected.id}
              canLeave={canLeave}
              onClose={closeDrawer}
            />
          )}
        </div>
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

export function QueueFilter({
  label,
  value,
  options,
  onChange,
  pending = false,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  pending?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !root.current) {
      setMenu(null);
      return;
    }
    const box = root.current.getBoundingClientRect();
    setMenu({ top: box.bottom + 4, left: box.left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: globalThis.MouseEvent) => {
      if (root.current?.contains(event.target as Node)) return;
      const panel = document.getElementById(`queue-filter-${label}`);
      if (panel?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, label]);

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
  };
  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        aria-label={`Filter ${label}`}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm whitespace-nowrap ${
          value ? "border-sky-300 bg-sky-50 text-navy" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
        }`}
      >
        <span>{value ? `${label}: ${value}` : label}</span>
        {pending ? (
          <span aria-hidden="true" className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent" />
        ) : (
          <span aria-hidden="true" className="text-[10px] text-slate-400">
            ▾
          </span>
        )}
      </button>
      {open && menu ? (
        <div
          id={`queue-filter-${label}`}
          role="listbox"
          aria-label={label}
          className="fixed z-50 max-h-64 w-48 overflow-auto rounded-md border border-slate-200 bg-white py-1 text-left text-sm normal-case tracking-normal text-slate-700 shadow-lg"
          style={{ top: menu.top, left: menu.left }}
        >
          <MenuChoice current={!value} onPick={() => pick("")}>
            All
          </MenuChoice>
          {options.map((option) => (
            <MenuChoice key={option} current={value === option} onPick={() => pick(option)}>
              {option}
            </MenuChoice>
          ))}
        </div>
      ) : null}
    </div>
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
      <button name="sequence" value="more-info" disabled={pending} className={compact ? button : buttonPrimary}>
        More Info
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

function TbdMark() {
  return <span aria-hidden="true" className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />;
}

function TbdValue() {
  return (
    <span className="inline-flex items-center gap-1 text-slate-500" title="Not classified yet">
      <TbdMark />
      TBD
    </span>
  );
}

function DecisionValue({ value }: { value: string }) {
  const label = decisionLabel(value);
  if (label === "Not yet") {
    return (
      <span className="inline-flex items-center justify-center gap-1 font-medium text-slate-500" title="Not filled in yet">
        <TbdMark />
        {label}
      </span>
    );
  }
  const tone = label === "Yes" ? "text-emerald-800" : "text-slate-900";
  return <span className={`font-medium ${tone}`}>{label}</span>;
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

function notLeadReasonFor(row: QueueRow): string {
  const taggedSpam = row.tags.includes("NQ: Spam / Robo Call") || row.tags.includes("NL: Spam / Robo Call");
  return EXCLUDED_CALLER_CLASSES.find((item) => item === row.callerClass) ?? (taggedSpam ? "spam" : "");
}

function detailGap(input: {
  notALead: boolean;
  consulted: "yes" | "no" | "";
  consultDate: string;
  qualified: "yes" | "no" | "";
  desired: "yes" | "no" | "";
  size: string;
  decline: string;
  signedChoice: "yes" | "no" | "";
  signedDate: string;
  lostChoice: "yes" | "no" | "";
  lostReason: string;
  admin: boolean;
}): string | null {
  if (input.notALead) return null;
  if (input.consulted === "yes" && !input.consultDate) return "Enter the consultation date before saving or closing.";
  if (input.qualified === "no" && input.desired === "yes") return "A lead that is not qualified is not desired.";
  if (input.desired === "yes" && !input.size) return "Choose a size before saving or closing.";
  if (input.desired === "no" && !input.decline) return "Choose a decline reason before saving or closing.";
  if (input.admin && input.signedChoice === "yes" && !input.signedDate) return "Enter the signed date before saving or closing.";
  if (input.signedChoice === "yes" && input.lostChoice === "yes") return "A lead cannot be both signed and lost.";
  if (input.lostChoice === "yes" && !isLostLeadReason(input.lostReason)) return "Choose why the lead was lost before saving.";
  return null;
}

function chosenSourceType(value: string): string {
  return isSourceType(value) && value !== "Unknown" ? value : "";
}

function chosenLeadSource(value: string, type: string): string {
  const source = canonicalLeadSource(value).source;
  if (!source) return "";
  if (!type) return source;
  return leadSourcesFor(type).includes(source) ? source : "";
}

function marketingFromRow(row: { sourceType: string; leadSource: string; summary?: string | null }): { type: string; source: string } {
  const fromSource = canonicalLeadSource(row.leadSource);
  let type = chosenSourceType(row.sourceType) || chosenSourceType(fromSource.type);
  let source = chosenLeadSource(fromSource.source || row.leadSource, type);
  if (!type || !source) {
    const guessed = leadSourceFromText(row.summary);
    if (guessed) {
      type = type || chosenSourceType(guessed.type);
      source = source || chosenLeadSource(guessed.source, type);
      if (!type) type = chosenSourceType(canonicalLeadSource(source).type);
    }
  }
  return { type, source };
}

function shownCaseType(value: string): string {
  const official = officialCaseType(value);
  if (!official || official === "Unknown / No Response") return value.trim() ? "TBD" : "";
  return official;
}

function LeadFacts({
  row,
  admin,
  canLeave,
  destinations,
  templates,
  startReferral = false,
}: {
  row: QueueRow;
  admin: boolean;
  canLeave: RefObject<() => boolean>;
  destinations: ReferralDestination[];
  templates: { en: string; es: string };
  startReferral?: boolean;
}) {
  const notify = useContext(DrawerNoticeContext);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState({ consult: false, qualified: false, desired: false, signed: false, lost: false });
  const [consulted, setConsulted] = useState<"yes" | "no" | "">(row.consulted);
  const [consultDate, setConsultDate] = useState(row.consultKey.slice(0, 10));
  const [qualified, setQualifiedChoice] = useState<"yes" | "no" | "">(row.qualifiedLabel === "Yes" ? "yes" : row.qualifiedLabel === "No" ? "no" : "");
  const [notLeadReason, setNotLeadReason] = useState(() => notLeadReasonFor(row));
  const [desired, setDesiredChoice] = useState<"yes" | "no" | "">(row.desired === "Yes" ? "yes" : row.desired === "No" ? "no" : "");
  const [size, setSize] = useState(selectedOne(row.tags, SIZE_TAGS));
  const [sourceType, setSourceType] = useState(() => marketingFromRow(row).type);
  const [leadSource, setLeadSource] = useState(() => marketingFromRow(row).source);
  const [caseType, setCaseType] = useState(() => shownCaseType(row.caseType));
  const [email, setEmail] = useState(() => standardLeadEmail(row.email) ?? "");
  const [decline, setDecline] = useState(selectedDecline(row.tags));
  const [signedChoice, setSignedChoice] = useState<"yes" | "no" | "">(() => (row.signed || row.confirmSigned ? "yes" : ""));
  const [signedDate, setSignedDate] = useState(row.signedDate);
  const [lostChoice, setLostChoice] = useState<"yes" | "no" | "">(row.lostReason ? "yes" : "");
  const [lostReason, setLostReason] = useState<string>(row.lostReason ?? "");
  useEffect(() => {
    const marketing = marketingFromRow(row);
    setSourceType(marketing.type);
    setLeadSource(marketing.source);
    setCaseType(shownCaseType(row.caseType));
    setEmail(standardLeadEmail(row.email) ?? "");
    setNotLeadReason(notLeadReasonFor(row));
    setSignedChoice(row.signed || row.confirmSigned ? "yes" : "");
    setSignedDate(row.signedDate);
    setLostChoice(row.lostReason ? "yes" : "");
    setLostReason(row.lostReason ?? "");
  }, [row.id]);
  const contractLocked = row.desiredLocked && row.qualifiedLabel !== "No";
  const lostLocked = row.signed || signedChoice === "yes";
  const { pending: confirming, submit: confirmSubmit } = useNotedSubmit();

  const notALead = Boolean(notLeadReason);
  function gap() {
    return detailGap({
      notALead,
      consulted,
      consultDate,
      qualified,
      desired,
      size,
      decline,
      signedChoice,
      signedDate,
      lostChoice,
      lostReason,
      admin,
    });
  }

  function exitGap() {
    if (notALead) return null;
    if (dirty.consult && consulted === "yes" && !consultDate) return "Enter the consultation date before saving or closing.";
    if ((dirty.qualified || dirty.desired) && qualified === "no" && desired === "yes") return "A lead that is not qualified is not desired.";
    if (dirty.desired && desired === "yes" && !size) return "Choose a size before saving or closing.";
    if (dirty.desired && desired === "no" && !decline) return "Choose a decline reason before saving or closing.";
    if (dirty.signed && admin && signedChoice === "yes" && !signedDate) return "Enter the signed date before saving or closing.";
    if (dirty.lost && lostChoice === "yes" && !isLostLeadReason(lostReason)) return "Choose why the lead was lost before saving or closing.";
    if (dirty.lost && signedChoice === "yes" && lostChoice === "yes") return "A lead cannot be both signed and lost.";
    return null;
  }

  canLeave.current = () => {
    const message = exitGap();
    if (!message) return true;
    notify({ tone: "error", text: message });
    return false;
  };

  function mark(key: "consult" | "qualified" | "desired" | "signed" | "lost") {
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
      if (!notALead) {
        const tagsData = new FormData();
        tagsData.set("qualified_tag", qualified === "yes" ? QUALIFIED_YES : qualified === "no" ? QUALIFIED_NO : "");
        tagsData.set("not_qualified_tag", "");
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
        if (dirty.lost && (lostChoice === "yes" || lostChoice === "no")) {
          const lostData = new FormData();
          lostData.set("lead_id", row.id);
          lostData.set("decision", lostChoice);
          if (lostChoice === "yes") lostData.set("reason", lostReason);
          await setLostLead(lostData);
        }
      }
      setSaved(true);
      setDirty({ consult: false, qualified: false, desired: false, signed: false, lost: false });
      notify({ tone: "saved", text: "Saved" });
    } catch (err) {
      const text = err instanceof Error ? err.message : "Could not save";
      notify({ tone: "error", text });
      setError(text);
    } finally {
      setPending(false);
    }
  }
  const caseOptions = caseTypeChoices(row.caseType);
  const formId = `lead-details-${row.id}`;
  const nameValue = row.leadName || (row.title === "Not captured" ? "" : row.title);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <form id={formId} action={onSubmit} className="space-y-4">
          <input type="hidden" name="lead_id" value={row.id} />
          {notLeadReason ? <input type="hidden" name="non_lead_reason" value={notLeadReason} /> : null}
          {row.signed ? null : (
            <NonLeadChoice row={row} reason={notLeadReason} onReason={setNotLeadReason} />
          )}
          <PanelSection title="Contact">
            <FieldLabel label="Name" className="col-span-2">
              <input name="lead_name" defaultValue={nameValue} className={fieldClass()} />
            </FieldLabel>
            <FieldLabel label="Phone">
              <input name="phone" defaultValue={row.phone ?? ""} className={fieldClass()} />
            </FieldLabel>
            <FieldLabel label="Email">
              <input
                name="email"
                value={email}
                autoComplete="off"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Optional"
                className={fieldClass()}
              />
              {emailIsUnavailable(email) ? null : (
                <button type="button" onClick={() => setEmail(EMAIL_NOT_AVAILABLE)} className="mt-1 text-[11px] font-medium text-navy underline">
                  N/A
                </button>
              )}
            </FieldLabel>
          </PanelSection>
          <input type="hidden" name="consulted" value={consulted} />
          {admin ? <input type="hidden" name="signed_decision" value={signedChoice} /> : null}
          <PanelSection title="Marketing">
            <FieldLabel label="Source type">
              <input type="hidden" name="source_type" value={sourceType} />
              <select
                value={sourceType}
                autoComplete="off"
                onChange={(event) => {
                  const next = event.target.value;
                  setSourceType(next);
                  setLeadSource((current) => {
                    if (!next) return "";
                    if (leadSourcesFor(next).includes(current)) return current;
                    const inferred = canonicalLeadSource(current);
                    return inferred.type === next ? chosenLeadSource(inferred.source, next) : "";
                  });
                }}
                className={fieldClass()}
              >
                <option value="">Not set</option>
                {SOURCE_TYPE_OPTIONS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </FieldLabel>
            <FieldLabel label="Lead source">
              <input type="hidden" name="lead_source" value={leadSource} />
              <select
                value={leadSource}
                autoComplete="off"
                disabled={!sourceType}
                onChange={(event) => {
                  const next = event.target.value;
                  setLeadSource(next);
                  const inferred = canonicalLeadSource(next).type;
                  if (inferred && inferred !== "Unknown") setSourceType(inferred);
                }}
                className={fieldClass(!sourceType)}
              >
                <option value="">{sourceType ? "Not set" : "Pick source type first"}</option>
                {sourceType
                  ? leadSourcesFor(sourceType).map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))
                  : null}
              </select>
            </FieldLabel>
          </PanelSection>
          <PanelSection title="Case type">
            <div className="col-span-2">
              <select
                name="case_type"
                value={caseOptions.includes(caseType) ? caseType : caseType || ""}
                onChange={(event) => {
                  const next = event.target.value;
                  setCaseType(next);
                  if (next !== "Non-PI Legal Matter") return;
                  mark("consult");
                  setConsulted("no");
                  setConsultDate("");
                  mark("qualified");
                  setQualifiedChoice("no");
                  mark("desired");
                  setDesiredChoice("no");
                  setSize("");
                  setDecline("DEC: Non-PI Legal Matter");
                }}
                className={fieldClass()}
              >
                <option value="">Not set</option>
                {[...caseOptions].map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
                {caseType && !caseOptions.includes(caseType) ? (
                  <option key={caseType} value={caseType}>
                    {caseType}
                  </option>
                ) : null}
              </select>
            </div>
          </PanelSection>
          <PanelSection title="Consultation">
            <div className="col-span-2 sm:col-span-1">
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
            <FieldLabel label="Consultation date">
              <input
                type="date"
                name="consultation_date"
                value={consultDate}
                required={!notALead && consulted === "yes"}
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
              <ChoiceToggle
                label="Qualified"
                value={qualified}
                onChange={(value) => {
                  mark("qualified");
                  setQualifiedChoice(value);
                }}
              />
            </div>
          </PanelSection>
          <PanelSection title="Desired">
            <div className="col-span-2 max-w-[12rem]">
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
            <FieldLabel label="Size">
              <select
                value={size}
                required={!notALead && desired === "yes"}
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
                required={!notALead && desired === "no"}
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
            {decline === "DEC: Referred" || row.nonPi || startReferral ? (
              <div className="col-span-2 border-t border-slate-200 pt-3">
                <QueueReferral row={row} destinations={destinations} templates={templates} startOpen />
              </div>
            ) : null}
          </PanelSection>
          <PanelSection title="Signed">
            <div>
              <ChoiceToggle
                label="Signed"
                value={signedChoice}
                disabled={!admin}
                onChange={(value) => {
                  mark("signed");
                  setSignedChoice(value);
                  if (value === "no") setSignedDate("");
                  if (value === "yes") {
                    setLostChoice("no");
                    setLostReason("");
                    mark("lost");
                  }
                }}
              />
              {admin ? null : (
                <p className="mt-1 text-xs normal-case tracking-normal text-slate-500">
                  {row.confirmSigned || row.signed ? "Filled from the signing flow. Only an admin can change it." : "Locked until an admin changes it."}
                </p>
              )}
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
          <PanelSection title="Lost lead">
            <div>
              <ChoiceToggle
                label="Lost lead"
                value={lostChoice}
                disabled={lostLocked}
                onChange={(value) => {
                  mark("lost");
                  setLostChoice(value);
                  if (value === "no") setLostReason("");
                  if (value === "yes" && signedChoice === "yes") {
                    setSignedChoice("no");
                    setSignedDate("");
                    mark("signed");
                  }
                }}
              />
              {lostLocked ? (
                <p className="mt-1 text-xs normal-case tracking-normal text-slate-500">Unavailable once the lead is signed.</p>
              ) : null}
            </div>
            <FieldLabel label="Lost reason">
              <select
                value={lostReason}
                required={lostChoice === "yes"}
                disabled={lostLocked || lostChoice !== "yes"}
                onChange={(event) => {
                  mark("lost");
                  setLostReason(event.target.value);
                }}
                className={fieldClass(lostLocked || lostChoice !== "yes")}
              >
                <option value="">{lostChoice === "yes" ? "Choose a reason" : "Locked"}</option>
                {(Object.entries(LOST_LEAD_REASONS) as [LostLeadReason, string][]).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </FieldLabel>
          </PanelSection>
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
  const types = PRACTICE_AREAS.filter((area) => firms.some((firm) => firm.practice_areas.includes(area.id))).sort((a, b) =>
    a.label.localeCompare(b.label),
  );
  const sectionRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(startOpen);
  const [area, setArea] = useState(types.some((item) => item.id === row.practiceArea) ? (row.practiceArea ?? "") : "");
  const [firmId, setFirmId] = useState("");
  const [language, setLanguage] = useState<"en" | "es">("en");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const notify = useContext(DrawerNoticeContext);
  const partners = area
    ? firms.filter((firm) => firm.practice_areas.includes(area)).sort((a, b) => a.name.localeCompare(b.name))
    : [];
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

function DrawerSkeleton({ row, onClose }: { row: QueueRow; onClose: () => void }) {
  return (
    <aside
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
    >
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-navy">{row.title}</h2>
          <p className="mt-1 text-sm text-slate-500">Opening…</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        >
          Close
        </button>
      </div>
      <div className="flex gap-1 border-b border-slate-200 px-3">
        {["Details", "Activity", "Overview"].map((label) => (
          <span key={label} className="border-b-2 border-transparent px-3 py-2 text-sm font-medium text-slate-300">
            {label}
          </span>
        ))}
      </div>
      <div className="min-h-0 flex-1 space-y-3 px-4 py-4">
        <div className="h-8 w-2/5 animate-pulse rounded-md bg-slate-100" />
        <div className="h-24 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-16 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-32 animate-pulse rounded-lg bg-slate-100" />
      </div>
    </aside>
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
  const [tab, setTab] = useState<"overview" | "details" | "activity">("details");
  useEffect(() => {
    setTab("details");
  }, [row.id, startReferral]);
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
    <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-navy">
            {row.title}
            <IdentityMark status={row.identityStatus} />
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-slate-500">
            <span>
              {typeLabel(row)}
              {row.when ? ` · ${row.when}` : ""}
            </span>
            <span className="text-slate-300" aria-hidden="true">
              ·
            </span>
            <span>
              <span className="text-emerald-700">Screening</span>
              <span className="text-slate-500"> · </span>
              <span className="text-slate-700">{row.screenBy?.trim() || "—"}</span>
            </span>
            <span className="text-slate-300" aria-hidden="true">
              ·
            </span>
            <span>
              <span className="text-sky-700">Intake</span>
              <span className="text-slate-500"> · </span>
              <span className="text-slate-700">{row.intakeBy?.trim() || "—"}</span>
            </span>
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
            ["details", "Details"],
            ["activity", "Activity"],
            ["overview", "Overview"],
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
        <LeadFacts
          row={row}
          admin={admin}
          canLeave={canLeave ?? { current: () => true }}
          destinations={destinations}
          templates={templates}
          startReferral={startReferral}
        />
      </div>
      {tab === "activity" ? <ActivityThread touches={touches} row={row} staff={staff} /> : null}
      {tab === "overview" ? (
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
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
        <PriorityPanel row={row} />
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Next</h3>
          <dl className="mt-2 space-y-1 text-sm text-slate-700">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Last contacted</dt>
              <dd>{row.lastLabel}</dd>
            </div>
            <ActionLines lines={row.nextAction.filter((line) => line.label !== "Call" && line.label !== "Text")} layout="row" />
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Calls / texts</dt>
              <dd>
                {row.calls} / {row.texts}
              </dd>
            </div>
          </dl>
          <NextActionEdit row={row} staff={staff} part="reminder" />
        </section>
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Automation</h3>
          <ul className="mt-2 space-y-2 text-sm">
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
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Summary</h3>
          <p className="mt-2 text-sm leading-6 text-slate-800">{row.summary?.trim() || "No call summary yet."}</p>
        </section>
      </div>
      ) : null}
      </DrawerNoticeContext.Provider>
    </aside>
  );
}

function ActivityThread({ touches, row, staff }: { touches: Touch[] | null; row: QueueRow; staff: string[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const ordered = touches === null ? null : [...touches].sort((a, b) => String(a.occurred_at || "").localeCompare(String(b.occurred_at || "")));
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [touches, row.id]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scroller} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
        <div className="mt-auto">
          {ordered === null ? (
            <p className="text-sm text-slate-500">Loading activity…</p>
          ) : ordered.length === 0 ? (
            <p className="text-sm text-slate-500">No calls, texts, or Slack notes yet.</p>
          ) : (
            <ul className="space-y-3">
              {ordered.map((touch) => {
                const jobLabel = callJobLabel(touch.jobs);
                const headerClass = (touch.type || "").toLowerCase() === "call" || touch.jobs
                  ? callJobHeaderClass(touch.jobs)
                  : "text-slate-800";
                const timeClass = touch.jobs === "screen"
                  ? "text-emerald-600/80"
                  : touch.jobs === "intake"
                    ? "text-sky-600/80"
                    : touch.jobs === "both"
                      ? "text-pink-600/80"
                      : "text-slate-400";
                return (
                  <li key={touch.id} className="text-sm">
                    <p className={`font-medium ${headerClass}`}>
                      {touchLabel(touch)}
                      <span className={`ml-2 font-normal ${timeClass}`}>
                        {touch.occurred_at ? formatChicago(touch.occurred_at) : ""}
                      </span>
                      {jobLabel ? <span className="ml-2 text-xs font-semibold uppercase tracking-wide opacity-80">{jobLabel}</span> : null}
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
                );
              })}
            </ul>
          )}
        </div>
      </div>
      <div className="shrink-0 space-y-3 border-t border-slate-200 px-4 py-3">
        <NextCallDetails row={row} staff={staff} />
        <TextSequence row={row} />
      </div>
    </div>
  );
}

function NextCallDetails({ row, staff }: { row: QueueRow; staff: string[] }) {
  const call = row.nextAction.find((line) => line.label === "Call");
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Next call</h3>
      <p className="mt-1 text-sm font-medium text-slate-900">{row.actionTitle ?? "No next call"}</p>
      <p className="mt-1 text-sm text-slate-700">
        <span className="text-slate-500">When </span>
        {call?.when && call.when !== "None" ? call.when : "Not scheduled"}
        {row.callTag ? <span className="text-slate-500"> · {row.callTag}</span> : null}
      </p>
      <NextActionEdit row={row} staff={staff} part="call" />
    </section>
  );
}

function TextSequence({ row }: { row: QueueRow }) {
  return (
    <section className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Texts</h3>
      <p className="min-w-0 text-sm text-slate-700">
        {row.textsLive ? row.automationLabel : "Off"}
        {row.textsLive && row.textNext ? ` · Next ${formatChicago(row.textNext)}` : ""}
      </p>
      {row.canStartText ? (
        <div className="ml-auto shrink-0">
          <TextStartButtons leadId={row.id} />
        </div>
      ) : null}
    </section>
  );
}

function NextActionEdit({ row, staff, part }: { row: QueueRow; staff: string[]; part: "call" | "reminder" }) {
  const call = row.nextAction.find((line) => line.label === "Call" && line.at);
  const reminder = row.nextAction.find((line) => line.label === "Reminder" && line.at);
  // Show editors whenever a next call/reminder time exists — even if the pending job is overdue
  // or the time is only computed from the call sequence (setNextAction will attach/create the job).
  const showCall = part === "call" && Boolean(call?.at);
  const showReminder = part === "reminder" && Boolean(reminder?.at);
  if (!showCall && !showReminder) return null;
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
      {showCall && call?.at ? (
        <>
          <input type="hidden" name="call_job_id" value={row.callJobId ?? ""} />
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
      {showReminder && reminder?.at ? (
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
        <div className="mt-3 flex justify-end">
          <button type="submit" disabled={pending} className="cursor-pointer rounded-md bg-navy px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#16366e] disabled:cursor-default disabled:opacity-60">
            <ButtonLabel value={pending ? "Saving…" : idleLabel} reserve={["Saving…", idleLabel]} />
          </button>
        </div>
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

function PriorityPanel({ row }: { row: QueueRow }) {
  if (row.priority === "Suggested") return <PrioritySuggestion row={row} />;
  if (!row.priority) {
    return (
      <NotedForm action={markPriority} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
        <input type="hidden" name="lead_id" value={row.id} />
        <p className="font-medium text-slate-900">Priority</p>
        <p className="mt-1 text-slate-600">Not flagged.</p>
        <button type="submit" className="mt-3 cursor-pointer rounded-md bg-navy px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#16366e]">
          Flag priority
        </button>
      </NotedForm>
    );
  }
  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Priority</h3>
      <p className="mt-1 font-medium text-slate-900">{row.priority}</p>
    </section>
  );
}

function PrioritySuggestion({ row }: { row: QueueRow }) {
  return (
    <NotedForm action={reviewPrioritySuggestion} className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm">
      <input type="hidden" name="lead_id" value={row.id} />
      <p className="font-medium text-sky-950">Suggested priority</p>
      {row.prioritySuggestion ? <p className="mt-1 text-sky-900">{row.prioritySuggestion}</p> : null}
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

function NonLeadChoice({
  row,
  reason,
  onReason,
}: {
  row: QueueRow;
  reason: string;
  onReason: (reason: string) => void;
}) {
  const gaps = rowCloseGaps(row, "nonlead");
  const { pending, submit } = useNotedSubmit();
  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Not a lead</h3>
      {gaps.length ? <p className="mt-2 text-sm text-orange-800">Closing needs: {gaps.join(", ")}.</p> : null}
      <label className="mt-2 block text-xs font-medium uppercase tracking-wide text-slate-500">
        Reason
        <select
          value={reason}
          onChange={(event) => onReason(event.target.value)}
          className={fieldClass()}
        >
          <option value="">Choose a reason</option>
          {[...EXCLUDED_CALLER_CLASSES]
            .sort((a, b) => NON_LEAD_TAG[a].localeCompare(NON_LEAD_TAG[b]))
            .map((item) => (
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
