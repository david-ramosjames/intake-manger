"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { IdentityMark } from "@/components/IdentityMark";
import { LeadTagFields } from "@/components/LeadTagFields";
import { saveLeadTags } from "@/lib/ops-actions";
import { formatChicago } from "@/lib/time";

export type QueueRow = {
  id: string;
  title: string;
  identityStatus: LeadIdentity | null;
  accident: string;
  when: string;
  priority: string | null;
  label: string;
  stageClassName: string;
  step: string;
  tags: string[];
  declineReason: string | null;
  qualifiedLabel: string;
  signed: boolean;
  lastLabel: string;
  waiting: boolean;
  automationLabel: string;
  automationBad: boolean;
  quoUrl: string | null;
  slackUrl: string | null;
  phone: string | null;
  email: string | null;
  summary: string | null;
  owner: string | null;
  grade: string | null;
  textsLive: boolean;
  textNext: string | null;
  agreementStatus: string | null;
  agreementSent: string | null;
  signingUrl: string | null;
  intakeHref: string | null;
  caseHref: string | null;
  calls: number;
  texts: number;
  nextCallLabel: string;
};

type LeadIdentity = "ok" | "needs_review" | "confirmed";

type Touch = {
  id: string;
  type: string | null;
  direction: string | null;
  content: string | null;
  occurred_at: string | null;
};

export function WorkQueue({ rows, initialId }: { rows: QueueRow[]; initialId?: string }) {
  const [selectedId, setSelectedId] = useState(initialId && rows.some((row) => row.id === initialId) ? initialId : "");
  const selected = rows.find((row) => row.id === selectedId) ?? null;

  return (
    <div className={`mt-4 grid items-start gap-4 ${selected ? "lg:grid-cols-[minmax(0,1fr)_22rem]" : ""}`}>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 border-b border-slate-200 bg-white text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Lead</th>
              <th className="px-4 py-3 font-medium">Grade</th>
              <th className="px-4 py-3 font-medium">Priority</th>
              <th className="px-4 py-3 font-medium">Stage</th>
              <th className="px-4 py-3 font-medium">Next step</th>
              <th className="px-4 py-3 font-medium">Qualified</th>
              <th className="px-4 py-3 font-medium">Last contacted</th>
              <th className="px-4 py-3 font-medium">Automation</th>
              <th className="px-4 py-3 font-medium">Links</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className={`border-b border-slate-100 last:border-0 ${
                  row.id === selectedId ? "bg-slate-50" : "hover:bg-slate-50"
                } ${row.waiting ? "shadow-[inset_3px_0_0_0_#f59e0b]" : ""}`}
              >
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setSelectedId(row.id)}
                    className="inline-flex items-center gap-1 text-left font-medium text-slate-900 hover:underline"
                  >
                    {row.title}
                    <IdentityMark status={row.identityStatus} />
                  </button>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {row.accident !== "—" ? row.accident : "Accident not captured"}
                    {row.when ? ` · ${row.when}` : ""}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${gradeClass(row.grade)}`}>
                    {row.grade ?? "—"}
                  </span>
                </td>
                <td className={`px-4 py-3 ${row.priority === "High" || row.priority === "Contract out" || row.priority === "Send contract" || row.priority === "High potential" ? "font-medium text-slate-900" : "text-slate-500"}`}>
                  {row.priority ?? "—"}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${row.stageClassName}`}>
                    {row.label}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-700">{row.step}</td>
                <td className={`px-4 py-3 ${row.qualifiedLabel === "Not tagged" ? "text-amber-700" : "text-slate-700"}`}>
                  {row.qualifiedLabel}
                </td>
                <td className="px-4 py-3 text-slate-700">{row.lastLabel}</td>
                <td className={`px-4 py-3 ${row.automationBad ? "font-medium text-red-700" : "text-slate-600"}`}>
                  {row.automationLabel}
                </td>
                <td className="px-4 py-3">
                  <RowLinks quoUrl={row.quoUrl} slackUrl={row.slackUrl} />
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                  Nothing in this queue.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {selected ? <LeadDrawer row={selected} onClose={() => setSelectedId("")} /> : null}
    </div>
  );
}

function RowLinks({ quoUrl, slackUrl }: { quoUrl: string | null; slackUrl: string | null }) {
  if (!quoUrl && !slackUrl) return <span className="text-slate-400">—</span>;
  return (
    <span className="flex gap-3">
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

function LeadDrawer({ row, onClose }: { row: QueueRow; onClose: () => void }) {
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
    <aside className="flex max-h-[calc(100vh-6rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:sticky lg:top-4">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900">
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
      <div className="space-y-5 overflow-y-auto px-4 py-4">
        <div className="flex flex-wrap gap-3 text-sm">
          {row.quoUrl ? (
            <a href={row.quoUrl} className="rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white" target="_blank" rel="noreferrer">
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
        <p className="text-sm text-slate-600">
          {row.phone || "No phone"}
          {row.email ? ` · ${row.email}` : ""}
          {row.owner ? ` · ${row.owner}` : ""}
          {row.grade ? ` · Grade ${row.grade}` : " · No grade"}
          {row.priority ? ` · ${row.priority}` : ""}
        </p>
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Summary</h3>
          <p className="mt-2 text-sm leading-6 text-slate-800">
            {row.summary?.trim() || "No call summary yet. Quo writes one after the conversation."}
          </p>
        </section>
        <TagEditor row={row} />
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Next</h3>
          <dl className="mt-2 space-y-1 text-sm text-slate-700">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Last contacted</dt>
              <dd>{row.lastLabel}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Next call</dt>
              <dd>{row.nextCallLabel}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Calls / texts</dt>
              <dd>
                {row.calls} / {row.texts}
              </dd>
            </div>
          </dl>
        </section>
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Automation</h3>
          <ul className="mt-2 space-y-2 text-sm">
            <li className="flex justify-between gap-3">
              <span className="text-slate-500">Texts</span>
              <span>{row.textsLive ? (row.textNext ? `Next ${formatChicago(row.textNext)}` : "Live") : "Off"}</span>
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
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Activity</h3>
          {touches === null ? (
            <p className="mt-2 text-sm text-slate-500">Loading activity…</p>
          ) : touches.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No calls or texts recorded yet.</p>
          ) : (
            <ul className="mt-2 space-y-3">
              {touches.map((touch) => (
                <li key={touch.id} className="text-sm">
                  <p className="font-medium text-slate-800">
                    {touchLabel(touch)}
                    <span className="ml-2 font-normal text-slate-400">
                      {touch.occurred_at ? formatChicago(touch.occurred_at) : ""}
                    </span>
                  </p>
                  {touch.content ? <p className="mt-0.5 line-clamp-2 text-slate-600">{touch.content}</p> : null}
                </li>
              ))}
            </ul>
          )}
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
      </div>
    </aside>
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
    <form action={onSubmit} className="rounded-lg border border-slate-200 p-3">
      <LeadTagFields
        key={`${row.id}:${row.tags.join("|")}:${row.signed ? "signed" : "open"}`}
        tags={row.tags}
        declineReason={row.declineReason}
        signed={row.signed}
      />
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="mt-3 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save tags"}
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
