"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { canonicalLeadSource, caseTypeChoices, isSourceType, LEAD_SOURCES, officialCaseType, SOURCE_TYPE_OPTIONS } from "@/lib/leads";
import { saveLeadDetails, saveLeadTags, setConsultation, setDesired, setQualified } from "@/lib/ops-actions";
import { toE164 } from "@/lib/phone";
import { emailIsUnavailable, EMAIL_NOT_AVAILABLE, standardLeadEmail } from "@/lib/leads";
import { REVIEW_GAP_LABEL, REVIEW_GAPS, reviewCsv, reviewGaps, type ReviewGap, type ReviewLead } from "@/lib/review";
import { DECLINE_TAGS, QUALIFIED_NO, QUALIFIED_YES, TAG_LABEL } from "@/lib/tags";

const PAGE_SIZE = 40;

function withCurrent(options: readonly string[], current: string): string[] {
  if (current && !options.includes(current)) return [current, ...options];
  return [...options];
}

function formatContactDay(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "—";
  const [year, month, date] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, date)));
}

function box(missing: boolean, wide = false): string {
  return `${wide ? "min-w-[11rem]" : "min-w-[8rem]"} w-full rounded border px-1.5 py-1 text-xs text-slate-900 ${
    missing ? "border-amber-400 bg-amber-50" : "border-slate-200 bg-white"
  }`;
}

export function DataReview({ rows }: { rows: ReviewLead[] }) {
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState<"all" | "open" | "closed">("all");
  const [scope, setScope] = useState<"missing" | "complete" | "all">("missing");
  const [gap, setGap] = useState<ReviewGap | "any">("any");
  const [page, setPage] = useState(0);

  const pool = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (status === "open" && row.closed) return false;
      if (status === "closed" && !row.closed) return false;
      if (from && (!row.firstContact || row.firstContact < from)) return false;
      if (to && (!row.firstContact || row.firstContact > to)) return false;
      if (!needle) return true;
      const hay = `${row.name} ${row.phone} ${row.email} ${row.leadSource} ${row.caseType} ${row.status}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [rows, query, status, from, to]);

  const gapCounts = useMemo(() => {
    const counts = Object.fromEntries(REVIEW_GAPS.map((item) => [item, 0])) as Record<ReviewGap, number>;
    let missing = 0;
    for (const row of pool) {
      const gaps = reviewGaps(row);
      if (gaps.length) missing += 1;
      for (const item of gaps) counts[item] += 1;
    }
    return { counts, missing, complete: pool.length - missing };
  }, [pool]);

  const shown = useMemo(() => {
    return pool.filter((row) => {
      const gaps = reviewGaps(row);
      if (scope === "missing" && gaps.length === 0) return false;
      if (scope === "complete" && gaps.length > 0) return false;
      if (gap !== "any" && !gaps.includes(gap)) return false;
      return true;
    });
  }, [pool, scope, gap]);

  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const visible = shown.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  function pickGap(next: ReviewGap | "any") {
    setGap(next);
    setScope("missing");
    setPage(0);
  }

  function download() {
    const blob = new Blob([reviewCsv(shown)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `lead-review-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(0);
          }}
          placeholder="Search name, phone, email"
          className="w-64 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          aria-label="Search leads"
        />
        <label className="flex items-center gap-1 text-sm text-slate-600">
          From
          <input
            type="date"
            value={from}
            aria-label="First contact from"
            onChange={(event) => {
              setFrom(event.target.value);
              setPage(0);
            }}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex items-center gap-1 text-sm text-slate-600">
          To
          <input
            type="date"
            value={to}
            aria-label="First contact to"
            onChange={(event) => {
              setTo(event.target.value);
              setPage(0);
            }}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
        <select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as "all" | "open" | "closed");
            setPage(0);
          }}
          className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
          aria-label="Open or closed"
        >
          <option value="all">Open and closed</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
        </select>
        <select
          value={scope}
          onChange={(event) => {
            setScope(event.target.value as "missing" | "complete" | "all");
            setPage(0);
          }}
          className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
          aria-label="Which leads to show"
        >
          <option value="missing">Missing information ({gapCounts.missing})</option>
          <option value="complete">Complete ({gapCounts.complete})</option>
          <option value="all">All leads ({pool.length})</option>
        </select>
        <button
          type="button"
          onClick={download}
          disabled={shown.length === 0}
          className="rounded-md bg-navy px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          Export CSV
        </button>
        <span className="text-sm text-slate-500">
          {shown.length} shown
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <FilterChip active={gap === "any" && scope === "missing"} onClick={() => pickGap("any")} label="Any missing" count={gapCounts.missing} />
        {REVIEW_GAPS.map((item) => (
          <FilterChip
            key={item}
            active={gap === item}
            onClick={() => pickGap(item)}
            label={REVIEW_GAP_LABEL[item]}
            count={gapCounts.counts[item]}
          />
        ))}
      </div>
      <datalist id="review-lead-sources">
        {LEAD_SOURCES.map((item) => (
          <option key={item.source} value={item.source} />
        ))}
      </datalist>
      <div className="mt-3 max-h-[calc(100vh-16rem)] overflow-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[92rem] border-collapse text-left text-xs">
          <thead className="sticky top-0 z-20 bg-white shadow-[0_1px_0_0_rgb(226,232,240)]">
            <tr className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <th className="sticky left-0 z-30 bg-white px-2 py-2">Lead</th>
              <th className="px-2 py-2">First contact</th>
              <th className="px-2 py-2">Missing</th>
              <th className="px-2 py-2">Phone</th>
              <th className="px-2 py-2">Email</th>
              <th className="px-2 py-2">Lead source</th>
              <th className="px-2 py-2">Source type</th>
              <th className="px-2 py-2">Type</th>
              <th className="px-2 py-2">Qualified</th>
              <th className="px-2 py-2">Consultation</th>
              <th className="px-2 py-2">Desired</th>
              <th className="px-2 py-2">Signed</th>
              <th className="px-2 py-2">Declined</th>
              <th className="px-2 py-2">Updated by</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <ReviewRow key={row.id} row={row} />
            ))}
            {visible.length === 0 ? (
              <tr>
                <td colSpan={14} className="px-3 py-8 text-sm text-slate-500">
                  No leads match this filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center gap-3 text-sm">
        <button
          type="button"
          disabled={current === 0}
          onClick={() => setPage(current - 1)}
          className="rounded-md border border-slate-300 px-2 py-1 disabled:opacity-40"
        >
          Previous
        </button>
        <span className="text-slate-600">
          Page {current + 1} of {pageCount}
        </span>
        <button
          type="button"
          disabled={current + 1 >= pageCount}
          onClick={() => setPage(current + 1)}
          className="rounded-md border border-slate-300 px-2 py-1 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
        active ? "border-amber-500 bg-amber-50 text-amber-950" : "border-slate-200 bg-white text-slate-700"
      }`}
    >
      {label} <span className="tabular-nums text-slate-500">{count}</span>
    </button>
  );
}

function ReviewRow({ row }: { row: ReviewLead }) {
  const [draft, setDraft] = useState(row);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const inflight = useRef(0);
  const editing = useRef(false);
  const latest = useRef(row);
  const queue = useRef(Promise.resolve());
  latest.current = row;

  useEffect(() => {
    if (!editing.current) setDraft(row);
  }, [row]);

  const gaps = new Set(reviewGaps(draft));

  function run(job: () => Promise<void>, next: ReviewLead) {
    inflight.current += 1;
    setSaveState("saving");
    const task = queue.current.then(async () => {
      editing.current = true;
      setDraft(next);
      setError(null);
      try {
        await job();
        inflight.current -= 1;
        if (inflight.current === 0) setSaveState("saved");
      } catch (err) {
        inflight.current -= 1;
        setSaveState("failed");
        setError(err instanceof Error ? err.message : "Could not save");
        setDraft(latest.current);
      } finally {
        editing.current = false;
      }
    });
    queue.current = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  async function persistTags(next: ReviewLead) {
    await run(async () => {
      const data = new FormData();
      const qualifiedTag = next.qualified === "yes" ? QUALIFIED_YES : next.qualified === "no" ? QUALIFIED_NO : "";
      if (qualifiedTag) data.set("qualified_tag", qualifiedTag);
      data.set("decline_tag", next.decline);
      data.set("not_qualified_tag", next.notQualified);
      if (row.size) data.set("size_tag", row.size);
      if (row.injury) data.set("injury_type", row.injury);
      await saveLeadTags(row.id, data);
    }, next);
  }

  async function persistDetails(next: ReviewLead, phoneEdited: boolean) {
    await run(async () => {
      const data = new FormData();
      data.set("lead_id", next.id);
      data.set("lead_name", next.name);
      data.set("email", next.email);
      data.set("lead_source", next.leadSource);
      data.set("source_type", next.sourceType);
      data.set("case_type", next.caseType);
      data.set("phone", next.phone);
      if (!phoneEdited && !toE164(next.phone)) data.set("keep_phone", "1");
      await saveLeadDetails(data);
    }, next);
  }

  function detailsChanged(next: ReviewLead): boolean {
    return (
      next.name !== row.name ||
      next.phone !== row.phone ||
      next.email !== row.email ||
      next.leadSource !== row.leadSource ||
      next.sourceType !== row.sourceType ||
      next.caseType !== row.caseType
    );
  }

  const sticky = `sticky left-0 z-10 px-2 py-1.5 ${gaps.size ? "bg-amber-50" : "bg-white"}`;

  return (
    <>
      <tr className={gaps.size ? "bg-amber-50/60" : "bg-white"}>
        <td className={sticky}>
          <input
            aria-label="Name"
            value={draft.name}
            onFocus={() => {
              editing.current = true;
            }}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            onBlur={() => {
              if (detailsChanged(draft)) void persistDetails(draft, draft.phone !== row.phone);
              else editing.current = false;
            }}
            className={box(gaps.has("name"), true)}
          />
          <p className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
            <span>
              {row.closed ? "Closed" : "Open"} · {row.status}
            </span>
            <span className="inline-block w-14 text-right font-medium" aria-live="polite">
              {saveState === "saving" ? <span className="text-slate-500">Saving</span> : null}
              {saveState === "saved" ? <span className="text-emerald-700">Saved</span> : null}
              {saveState === "failed" ? <span className="text-red-700">Failed</span> : null}
            </span>
            <Link href={`/leads/${row.id}`} className="font-medium text-navy underline">
              Open
            </Link>
            {row.slackUrl ? (
              <a href={row.slackUrl} target="_blank" rel="noreferrer" className="font-medium text-navy underline">
                Slack
              </a>
            ) : null}
          </p>
        </td>
        <td className="px-2 py-1.5 text-slate-700">{formatContactDay(row.firstContact)}</td>
        <td className="px-2 py-1.5 align-top text-[11px] leading-4 text-amber-800">
          {gaps.size ? [...gaps].map((item) => REVIEW_GAP_LABEL[item]).join(", ") : <span className="text-slate-400">Complete</span>}
        </td>
        <td className="px-2 py-1.5">
          <input
            aria-label="Phone"
            value={draft.phone}
            onFocus={() => {
              editing.current = true;
            }}
            onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
            onBlur={() => {
              if (detailsChanged(draft)) void persistDetails(draft, true);
              else editing.current = false;
            }}
            className={box(gaps.has("phone"))}
          />
        </td>
        <td className="px-2 py-1.5">
          <input
            aria-label="Email"
            value={draft.email}
            onFocus={() => {
              editing.current = true;
            }}
            onChange={(event) => setDraft({ ...draft, email: event.target.value })}
            onBlur={() => {
              const next = { ...draft, email: standardLeadEmail(draft.email) ?? "" };
              if (detailsChanged(next)) void persistDetails(next, next.phone !== row.phone);
              else editing.current = false;
            }}
            className={box(false, true)}
          />
          {emailIsUnavailable(draft.email) ? null : (
            <button
              type="button"
              onClick={() => {
                const next = { ...draft, email: EMAIL_NOT_AVAILABLE };
                void persistDetails(next, next.phone !== row.phone);
              }}
              className="mt-1 block text-[11px] font-medium text-navy underline"
            >
              N/A
            </button>
          )}
        </td>
        <td className="px-2 py-1.5">
          <input
            aria-label="Lead source"
            list="review-lead-sources"
            value={draft.leadSource}
            onFocus={() => {
              editing.current = true;
            }}
            onChange={(event) => setDraft({ ...draft, leadSource: event.target.value })}
            onBlur={() => {
              const canonical = canonicalLeadSource(draft.leadSource);
              const next = {
                ...draft,
                leadSource: canonical.source,
                sourceType: canonical.type || (isSourceType(draft.sourceType) ? draft.sourceType : ""),
              };
              if (detailsChanged(next) || next.sourceType !== row.sourceType) void persistDetails(next, next.phone !== row.phone);
              else editing.current = false;
            }}
            className={box(gaps.has("lead_source"))}
          />
        </td>
        <td className="px-2 py-1.5">
          <select
            aria-label="Source type"
            value={isSourceType(draft.sourceType) && draft.sourceType !== "Unknown" ? draft.sourceType : ""}
            onChange={(event) => {
              const value = event.target.value;
              const next = { ...draft, sourceType: isSourceType(value) ? value : "" };
              void persistDetails(next, false);
            }}
            className={box(gaps.has("source_type"))}
          >
            <option value="">Not set</option>
            {SOURCE_TYPE_OPTIONS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </td>
        <td className="px-2 py-1.5">
          <select
            aria-label="Case type"
            value={(() => {
              const official = officialCaseType(draft.caseType);
              return official && official !== "Unknown / No Response" ? official : "";
            })()}
            onChange={(event) => {
              const next = { ...draft, caseType: event.target.value };
              void persistDetails(next, false);
            }}
            className={box(gaps.has("case_type"), true)}
          >
            <option value="">Not set</option>
            {caseTypeChoices(draft.caseType).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </td>
        <td className="px-2 py-1.5">
          <select
            aria-label="Qualified"
            value={draft.qualified}
            onChange={(event) => {
              const value = event.target.value === "yes" || event.target.value === "no" ? event.target.value : "";
              if (!value) return;
              const next: ReviewLead = {
                ...draft,
                qualified: value,
                desired: value === "no" ? "no" : draft.desired,
                desiredLocked: value === "no" ? true : draft.desiredLocked,
              };
              void run(async () => {
                const data = new FormData();
                data.set("lead_id", row.id);
                data.set("decision", value);
                await setQualified(data);
              }, next);
            }}
            className={box(gaps.has("qualified"))}
          >
            <option value="">Not set</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </td>
        <td className="px-2 py-1.5">
          <div className="flex items-center gap-1">
            <select
              aria-label="Consultation"
              value={draft.consulted}
              onChange={(event) => {
                const value = event.target.value === "yes" || event.target.value === "no" ? event.target.value : "";
                if (value === "yes" && !draft.consultation) {
                  setDraft({ ...draft, consulted: "yes" });
                  return;
                }
                const next: ReviewLead = {
                  ...draft,
                  consulted: value,
                  consultation: value === "yes" ? draft.consultation : "",
                };
                void run(async () => {
                  const data = new FormData();
                  data.set("lead_id", row.id);
                  data.set("consultation_date", next.consultation);
                  if (value === "no") data.set("consulted", "no");
                  await setConsultation(data);
                }, next);
              }}
              className={box(gaps.has("consultation"))}
            >
              <option value="">Not set</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
            {draft.consulted === "yes" ? (
              <input
                aria-label="Consultation date"
                type="date"
                value={draft.consultation}
                onFocus={() => {
                  editing.current = true;
                }}
                onChange={(event) => {
                  const next: ReviewLead = {
                    ...draft,
                    consulted: event.target.value ? "yes" : "",
                    consultation: event.target.value,
                  };
                  void run(async () => {
                    const data = new FormData();
                    data.set("lead_id", row.id);
                    data.set("consultation_date", next.consultation);
                    await setConsultation(data);
                  }, next);
                }}
                className={box(gaps.has("consultation"))}
              />
            ) : null}
          </div>
        </td>
        <td className="px-2 py-1.5">
          {draft.desiredLocked ? (
            <span className="inline-block min-w-[8rem] px-1 text-xs text-slate-800" title="Set from qualified or the contract.">
              {draft.desired === "yes" ? "Yes" : draft.desired === "no" ? "No" : "—"}
            </span>
          ) : (
            <select
              aria-label="Desired"
              value={draft.desired}
              onChange={(event) => {
                const value = event.target.value === "yes" || event.target.value === "no" ? event.target.value : "";
                if (!value) return;
                const next: ReviewLead = { ...draft, desired: value };
                void run(async () => {
                  const data = new FormData();
                  data.set("lead_id", row.id);
                  data.set("decision", value);
                  await setDesired(data);
                }, next);
              }}
              className={box(gaps.has("desired"))}
            >
              <option value="">Not set</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          )}
        </td>
        <td className="px-2 py-1.5 text-xs text-slate-800">{row.signed ? "Yes" : "No"}</td>
        <td className="px-2 py-1.5">
          <select
            aria-label="Declined"
            value={draft.decline}
            disabled={row.signed || !draft.qualified}
            onChange={(event) => {
              const next = { ...draft, decline: event.target.value };
              void persistTags(next);
            }}
            className={box(false, true)}
          >
            <option value="">No decline</option>
            {withCurrent(DECLINE_TAGS, draft.decline).map((item) => (
              <option key={item} value={item}>
                {TAG_LABEL[item as keyof typeof TAG_LABEL] ?? item}
              </option>
            ))}
          </select>
        </td>
        <td className="px-2 py-1.5 text-xs text-slate-600">{row.updatedBy || "—"}</td>
      </tr>
      {error ? (
        <tr>
          <td colSpan={14} className="px-2 pb-2 text-xs text-red-700">
            {error}
          </td>
        </tr>
      ) : null}
    </>
  );
}
