"use client";

import Link from "next/link";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { QueueId } from "@/lib/queue";

export type WorkFilterKey = "grade" | "priority" | "screen" | "intake" | "sourceType" | "leadSource" | "q";
export type WorkRange = "all" | "today" | "7";
export type WorkEntry = "" | "New" | "In Progress";

export type WorkFilterValues = Record<WorkFilterKey, string> & {
  range: WorkRange;
  queue: QueueId;
  entry: WorkEntry;
};

const FILTER_KEYS: WorkFilterKey[] = ["grade", "priority", "screen", "intake", "sourceType", "leadSource", "q"];

const WorkFilterContext = createContext<{
  values: WorkFilterValues;
  setValue: (key: WorkFilterKey, value: string) => void;
  setRange: (range: WorkRange) => void;
  setQueue: (queue: QueueId) => void;
  setEntry: (entry: WorkEntry) => void;
  clear: () => void;
} | null>(null);

function writeView(values: WorkFilterValues) {
  const url = new URL(window.location.href);
  for (const key of FILTER_KEYS) {
    const value = values[key];
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  if (values.range === "all") url.searchParams.delete("range");
  else url.searchParams.set("range", values.range);
  if (values.queue === "all") url.searchParams.delete("queue");
  else url.searchParams.set("queue", values.queue);
  if (values.entry) url.searchParams.set("entry", values.entry);
  else url.searchParams.delete("entry");
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

export function WorkFilterState({ initial, children }: { initial: WorkFilterValues; children: ReactNode }) {
  const [values, setValues] = useState(initial);
  const api = useMemo(
    () => ({
      values,
      setValue(key: WorkFilterKey, value: string) {
        setValues((current) => {
          const next = { ...current, [key]: value };
          writeView(next);
          return next;
        });
      },
      setRange(range: WorkRange) {
        setValues((current) => {
          const next = { ...current, range };
          writeView(next);
          return next;
        });
      },
      setQueue(queue: QueueId) {
        setValues((current) => {
          const next = { ...current, queue };
          writeView(next);
          return next;
        });
      },
      setEntry(entry: WorkEntry) {
        setValues((current) => {
          const next = { ...current, entry };
          writeView(next);
          return next;
        });
      },
      clear() {
        setValues((current) => {
          const next = { ...current, grade: "", priority: "", screen: "", intake: "", sourceType: "", leadSource: "", q: "" };
          writeView(next);
          return next;
        });
      },
    }),
    [values],
  );
  return <WorkFilterContext.Provider value={api}>{children}</WorkFilterContext.Provider>;
}

export function useWorkFilters() {
  const value = useContext(WorkFilterContext);
  if (!value) throw new Error("Search and filters are outside the work queue.");
  return value;
}

export function WorkSearch() {
  const { values, setValue, clear } = useWorkFilters();
  return (
    <div className="ml-auto flex items-center gap-1.5">
      <input
        value={values.q}
        onChange={(event) => setValue("q", event.target.value)}
        placeholder="Name, phone…"
        aria-label="Search leads"
        className="w-36 rounded-md border border-slate-300 bg-white px-2 py-0.5 text-sm xl:w-44"
      />
      <button
        type="button"
        onClick={clear}
        className="shrink-0 rounded-md bg-navy px-2.5 py-0.5 text-sm font-medium text-white hover:bg-[#0c2a56]"
      >
        Clear
      </button>
    </div>
  );
}

const RANGES: { id: WorkRange; label: string }[] = [
  { id: "all", label: "Any time" },
  { id: "today", label: "Today" },
  { id: "7", label: "Last 7 days" },
];

function pillClass(active: boolean): string {
  return `shrink-0 rounded-full px-2.5 py-0.5 ${active ? "bg-brand text-navy" : "bg-white text-slate-700 ring-1 ring-slate-200"}`;
}

export function WorkArrivedPills() {
  const { values, setRange } = useWorkFilters();
  return (
    <>
      {RANGES.map((item) => (
        <button key={item.id} type="button" onClick={() => setRange(item.id)} className={pillClass(values.range === item.id)}>
          {item.label}
        </button>
      ))}
    </>
  );
}

function navigate(changes: Record<string, string | null>) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(changes)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  window.location.assign(`${url.pathname}${url.search}`);
}

export function WorkStatusPills({
  local,
  closed,
  nonLeads,
  nonLeadsCount,
}: {
  local: boolean;
  closed: boolean;
  nonLeads: boolean;
  nonLeadsCount: number;
}) {
  const { values, setEntry } = useWorkFilters();
  const openQueue = values.queue === "nonleads" || values.queue === "signed" || values.queue === "closed" ? null : values.queue;
  return (
    <>
      {local ? (
        <button type="button" onClick={() => setEntry("")} className={pillClass(!values.entry)}>
          Open
        </button>
      ) : (
        <button type="button" onClick={() => navigate({ funnel: null, entry: null, queue: openQueue })} className={pillClass(false)}>
          Open
        </button>
      )}
      {local ? (
        <button type="button" onClick={() => setEntry("New")} className={pillClass(values.entry === "New")}>
          New
        </button>
      ) : (
        <button type="button" onClick={() => navigate({ funnel: null, entry: "New", queue: openQueue })} className={pillClass(false)}>
          New
        </button>
      )}
      {local ? (
        <button type="button" onClick={() => setEntry("In Progress")} className={pillClass(values.entry === "In Progress")}>
          In Progress
        </button>
      ) : (
        <button type="button" onClick={() => navigate({ funnel: null, entry: "In Progress", queue: openQueue })} className={pillClass(false)}>
          In Progress
        </button>
      )}
      <button type="button" onClick={() => navigate({ funnel: "closed", entry: null })} className={pillClass(closed)}>
        Closed
      </button>
      <button type="button" onClick={() => navigate({ queue: "nonleads", entry: null })} className={pillClass(nonLeads)}>
        Non-leads{nonLeadsCount ? ` (${nonLeadsCount})` : ""}
      </button>
    </>
  );
}

export function WorkMetric({
  href,
  active,
  label,
  value,
  tone,
  instantQueue,
}: {
  href: string;
  active: boolean;
  label: string;
  value: string;
  tone: string;
  instantQueue?: QueueId;
}) {
  const { values, setQueue } = useWorkFilters();
  const selected = instantQueue ? values.queue === instantQueue : active;
  const className = `flex items-baseline gap-1.5 rounded-md px-1 py-0.5 ${selected ? "bg-brand/40" : "hover:bg-slate-100"}`;
  const body = (
    <>
      <span className={`text-lg font-semibold tabular-nums leading-none ${tone}`}>{value}</span>
      <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</span>
    </>
  );
  if (instantQueue) {
    return (
      <button type="button" onClick={() => setQueue(instantQueue)} className={className}>
        {body}
      </button>
    );
  }
  return (
    <WorkFilterLink href={href} className={className}>
      {body}
    </WorkFilterLink>
  );
}

export function inArrivedRange(age: number | null, range: WorkRange): boolean {
  if (range === "all") return true;
  if (age == null) return false;
  if (range === "today") return age === 0;
  return age <= 6;
}

/** Keeps the current search and dropdown filters when a real page link changes the rest of the queue. */
export function WorkFilterLink({
  href,
  className,
  children,
  carryView = false,
}: {
  href: string;
  className?: string;
  children: ReactNode;
  carryView?: boolean;
}) {
  const { values } = useWorkFilters();
  const url = new URL(href, "http://local");
  for (const key of FILTER_KEYS) {
    const value = values[key];
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  if (values.range === "all") url.searchParams.delete("range");
  else url.searchParams.set("range", values.range);
  if (carryView) {
    if (values.queue === "all") url.searchParams.delete("queue");
    else url.searchParams.set("queue", values.queue);
    if (values.entry) url.searchParams.set("entry", values.entry);
    else url.searchParams.delete("entry");
  }
  return (
    <Link href={`${url.pathname}${url.search}`} className={className}>
      {children}
    </Link>
  );
}
