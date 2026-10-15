"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { IdentityMark } from "@/components/IdentityMark";
import { LeadTagFields } from "@/components/LeadTagFields";
import { CLOSE_SUGGESTION_LABEL } from "@/lib/funnel";
import { confirmCloseSuggestion, confirmSigned, reviewPrioritySuggestion, saveLeadTags } from "@/lib/ops-actions";
import type { NextActionLine } from "@/lib/next-action";
import { formatChicago } from "@/lib/time";

export type QueueRow = {
  id: string;
  title: string;
  samePhone: { id: string; title: string; label: string }[];
  closeSuggestion: "decline" | "not_interested" | "not_a_lead" | null;
  identityStatus: LeadIdentity | null;
  accident: string;
  when: string;
  priority: string | null;
  prioritySuggestion: string | null;
  actionTitle: string | null;
  label: string;
  stageClassName: string;
  step: string;
  tags: string[];
  callrail: boolean;
  declineReason: string | null;
  qualifiedLabel: string;
  consultWhen: string;
  desired: string;
  signed: boolean;
  nonPi: boolean;
  confirmSigned: boolean;
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
  sequenceLabel: string;
  agreementStatus: string | null;
  agreementSent: string | null;
  signingUrl: string | null;
  intakeHref: string | null;
  caseHref: string | null;
  calls: number;
  texts: number;
  nextCallLabel: string;
  nextAction: NextActionLine[];
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
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 border-b border-slate-200 bg-white text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Lead</th>
              <th className="px-4 py-3 font-medium">Next action</th>
              <th className="px-4 py-3 font-medium">Stage</th>
              <th className="px-4 py-3 font-medium">Priority</th>
              <th className="px-4 py-3 font-medium">Grade</th>
              <th className="px-4 py-3 font-medium">Consult</th>
              <th className="px-4 py-3 font-medium">Qualified</th>
              <th className="px-4 py-3 font-medium">Desired</th>
              <th className="px-4 py-3 font-medium">Signed</th>
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
                  row.id === selectedId ? "bg-brand/10" : "hover:bg-slate-50"
                } ${row.waiting ? "shadow-[inset_3px_0_0_0_#f59e0b]" : row.id === selectedId ? "shadow-[inset_3px_0_0_0_#38B7E3]" : ""}`}
              >
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setSelectedId(row.id)}
                    className="inline-flex items-center gap-1 text-left font-medium text-navy hover:underline"
                  >
                    {row.title}
                    <IdentityMark status={row.identityStatus} />
                  </button>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {row.accident !== "—" ? row.accident : "Accident not captured"}
                    {row.when ? ` · ${row.when}` : ""}
                  </p>
                  {row.samePhone.length > 0 ? (
                    <p className="mt-0.5 text-xs text-slate-500">{row.samePhone.length + 1} records, same phone</p>
                  ) : null}
                  {row.closeSuggestion ? (
                    <p className="mt-0.5 text-xs font-medium text-orange-800">Suggested close: {CLOSE_SUGGESTION_LABEL[row.closeSuggestion]}</p>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-slate-800">
                  <p className="font-medium text-slate-900">{row.actionTitle ?? "—"}</p>
                  {row.nextAction
                    .filter((line) => line.when !== "None")
                    .map((line) => (
                      <p key={line.label} className="whitespace-nowrap text-slate-600">
                        <span className="text-slate-500">{line.label}</span> {line.when}
                      </p>
                    ))}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${row.stageClassName}`}>
                    {row.label}
                  </span>
                </td>
                <td className={`px-4 py-3 ${row.priority ? "font-medium text-slate-900" : "text-slate-500"}`}>
                  {row.priority ?? "—"}
                  {row.prioritySuggestion && row.priority === "Suggested" ? (
                    <p className="mt-0.5 max-w-40 text-xs font-normal text-slate-500">{row.prioritySuggestion}</p>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${gradeClass(row.grade)}`}>
                    {row.grade ?? "—"}
                  </span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-slate-700">{row.consultWhen}</td>
                <td className="px-4 py-3 text-slate-700">{row.qualifiedLabel}</td>
                <td className="px-4 py-3 text-slate-700">{row.desired}</td>
                <td className="px-4 py-3 text-slate-700">{row.signed ? "Yes" : row.confirmSigned ? "Confirm" : "—"}</td>
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
                <td colSpan={12} className="px-4 py-10 text-center text-slate-500">
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
      <div className="space-y-5 overflow-y-auto px-4 py-4">
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
        <p className="text-sm text-slate-600">
          {row.phone || "No phone"}
          {row.email ? ` · ${row.email}` : ""}
          {row.owner ? ` · ${row.owner}` : ""}
          {row.grade ? ` · Grade ${row.grade}` : " · No grade"}
          {row.priority ? ` · ${row.priority}` : ""}
        </p>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <FunnelMark label="Consultation" value={row.consultWhen === "No consult" ? "—" : row.consultWhen} />
          <FunnelMark label="Qualified" value={row.qualifiedLabel} />
          <FunnelMark label="Desired" value={row.desired} />
          <FunnelMark label="Signed" value={row.signed ? "Yes" : "—"} />
        </dl>
        {row.confirmSigned ? (
          <form action={confirmSigned} className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm">
            <input type="hidden" name="lead_id" value={row.id} />
            <p className="font-medium text-violet-950">The contract looks complete.</p>
            <p className="mt-1 text-violet-900">Confirm signed after every required signature is done.</p>
            <button className="mt-3 rounded-md bg-navy px-3 py-1.5 text-sm font-medium text-white">Confirm signed</button>
          </form>
        ) : null}
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
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Summary</h3>
          <p className="mt-2 text-sm leading-6 text-slate-800">
            {row.summary?.trim() || "No call summary yet. Quo writes one after the conversation."}
          </p>
        </section>
        <TagEditor row={row} />
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
        </section>
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Automation</h3>
          <ul className="mt-2 space-y-2 text-sm">
            <li className="flex justify-between gap-3">
              <span className="text-slate-500">Auto sequence</span>
              <span>
                {row.sequenceLabel}
                {row.textsLive && row.textNext ? ` · Next ${formatChicago(row.textNext)}` : ""}
              </span>
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

function FunnelMark({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-900">{value}</dd>
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
          Confirm priority
        </button>
        <button name="decision" value="dismiss" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm">
          Not now
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
      <p className="mt-1 text-orange-900">The lead stays open until someone confirms this.</p>
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
        desired={row.desired === "Yes" || row.signed}
        nonPi={row.nonPi}
        callrail={row.callrail}
      />
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="mt-3 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-navy disabled:opacity-60"
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
