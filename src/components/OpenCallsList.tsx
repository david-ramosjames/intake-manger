"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { OpenCallPlan } from "@/components/OpenCallPlan";
import { LeadDrawer, type QueueRow } from "@/components/WorkQueue";
import type { StaffPerson } from "@/lib/identity";
import type { ReferralDestination } from "@/lib/referrals";

export type OpenCallCard = {
  id: string;
  leadId: string;
  title: string;
  phone: string | null;
  sequenceLabel: string;
  dueLabel: string;
  overdue: boolean;
  placeLabel: string;
  placeHref: string | null;
  quoUrl: string | null;
  assignedName: string;
  consultName: string;
  consulted: boolean;
  dueAt: string;
};

export function OpenCallsList({
  view,
  waitingCount,
  upcomingCount,
  jobs,
  destinations,
  templates,
  staff,
  staffNames,
  initialRow,
}: {
  view: "waiting" | "upcoming";
  waitingCount: number;
  upcomingCount: number;
  jobs: OpenCallCard[];
  destinations: ReferralDestination[];
  templates: { en: string; es: string };
  staff: StaffPerson[];
  staffNames: string[];
  initialRow?: QueueRow | null;
}) {
  const [selectedId, setSelectedId] = useState(initialRow?.id ?? "");
  const [row, setRow] = useState<QueueRow | null>(initialRow ?? null);

  useEffect(() => {
    if (!selectedId) return;
    let cancel = false;
    fetch(`/api/leads/${selectedId}/shelf`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { row?: QueueRow } | null) => {
        if (!cancel && payload?.row) setRow(payload.row);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, [selectedId]);

  function openLead(job: OpenCallCard) {
    setSelectedId(job.leadId);
    setRow((current) => (current?.id === job.leadId ? current : fallbackRow(job)));
    window.history.replaceState(null, "", callsHref(view, job.leadId));
  }

  function closeLead() {
    setSelectedId("");
    setRow(null);
    window.history.replaceState(null, "", callsHref(view));
  }

  const job = jobs.find((item) => item.leadId === selectedId);
  const selected = !selectedId ? null : row?.id === selectedId ? row : job ? fallbackRow(job) : null;

  return (
    <>
      <div className="mt-6 flex flex-wrap gap-2">
        <Link
          href={callsHref("waiting", selectedId)}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm ${
            view === "waiting" ? "bg-brand text-navy" : "bg-white text-slate-700 ring-1 ring-slate-200"
          }`}
        >
          Open calls
          <span
            className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none ${
              view === "waiting" ? "bg-accent text-white" : "bg-slate-100 text-slate-700"
            }`}
          >
            {waitingCount}
          </span>
        </Link>
        <Link
          href={callsHref("upcoming", selectedId)}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm ${
            view === "upcoming" ? "bg-brand text-navy" : "bg-white text-slate-700 ring-1 ring-slate-200"
          }`}
        >
          Upcoming tags
          <span
            className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none ${
              view === "upcoming" ? "bg-accent text-white" : "bg-slate-100 text-slate-700"
            }`}
          >
            {upcomingCount}
          </span>
        </Link>
      </div>

      <div className={`mt-6 grid items-start gap-4 ${selected ? "lg:grid-cols-[minmax(0,1fr)_28rem]" : ""}`}>
        <ul className="min-w-0 space-y-3">
          {jobs.map((job) => (
            <li
              key={job.id}
              className={`rounded-lg border border-slate-200 bg-white p-4 text-sm ${
                job.leadId === selectedId ? "bg-brand/10" : ""
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <button
                    type="button"
                    onClick={() => openLead(job)}
                    className="text-left text-sm font-medium text-navy hover:underline"
                  >
                    {job.title}
                  </button>
                  {job.phone ? <span className="text-slate-500"> · {job.phone}</span> : null}
                  <p className="mt-1 font-medium text-slate-800">{job.sequenceLabel}</p>
                  <p className="mt-1 text-slate-700">
                    {job.overdue ? "Waiting since" : "Due"} {job.dueLabel}
                  </p>
                </div>
                <span className="flex flex-col items-end gap-0.5">
                  {job.quoUrl ? (
                    <a href={job.quoUrl} className="font-medium text-navy underline" target="_blank" rel="noreferrer">
                      Quo
                    </a>
                  ) : null}
                  {job.placeHref ? (
                    <a href={job.placeHref} className="font-medium text-navy underline" target="_blank" rel="noreferrer">
                      Slack
                    </a>
                  ) : (
                    <span className="text-slate-500">{job.placeLabel}</span>
                  )}
                </span>
              </div>
              <OpenCallPlan
                jobId={job.id}
                dueAt={job.dueAt}
                assignedName={job.assignedName}
                consultName={job.consultName}
                consulted={job.consulted}
                staff={staff}
              />
            </li>
          ))}
          {jobs.length === 0 ? (
            <li className="text-sm text-slate-500">
              {view === "upcoming" ? "No upcoming call tags are scheduled." : "Every due call has a return in the log."}
            </li>
          ) : null}
        </ul>
        {selected ? (
          <LeadDrawer
            key={selected.id}
            row={selected}
            destinations={destinations}
            templates={templates}
            staff={staffNames}
            staffMentions={staff
              .filter((person): person is StaffPerson & { slackUserId: string } => Boolean(person.slackUserId))
              .map((person) => ({ name: person.name, slackUserId: person.slackUserId }))}
            onClose={closeLead}
          />
        ) : null}
      </div>
    </>
  );
}

function callsHref(view: "waiting" | "upcoming", leadId?: string): string {
  const params = new URLSearchParams();
  if (view === "upcoming") params.set("view", "upcoming");
  if (leadId) params.set("lead", leadId);
  const query = params.toString();
  return query ? `/open-calls?${query}` : "/open-calls";
}

function fallbackRow(job: OpenCallCard): QueueRow {
  return {
    id: job.leadId,
    title: job.title,
    samePhone: [],
    closeSuggestion: null,
    identityStatus: null,
    identityEvidence: null,
    suggestedName: null,
    accident: "—",
    caseType: "",
    leadSource: "",
    sourceType: "",
    when: "",
    priority: null,
    prioritySuggestion: null,
    actionTitle: job.sequenceLabel,
    label: "Need to contact",
    stageClassName: "bg-amber-50 text-amber-900",
    stageStripe: "shadow-[inset_3px_0_0_0_#f59e0b]",
    step: "—",
    tags: [],
    callrail: false,
    declineReason: null,
    qualifiedLabel: "—",
    consultWhen: "—",
    desired: "—",
    desiredLocked: false,
    signed: false,
    nonPi: false,
    practiceArea: null,
    referralSent: false,
    referralFirm: null,
    callerClass: null,
    confirmSigned: false,
    lastLabel: "Never",
    lastDays: null,
    consultKey: "",
    waiting: job.overdue,
    automationLabel: "—",
    automationBad: false,
    canStartText: false,
    quoUrl: job.quoUrl,
    slackUrl: job.placeHref,
    leadName: job.title,
    phone: job.phone,
    email: null,
    summary: null,
    owner: job.consultName || job.assignedName || null,
    grade: null,
    textsLive: false,
    textNext: null,
    sequenceLabel: job.sequenceLabel,
    agreementStatus: null,
    agreementSent: null,
    signingUrl: null,
    intakeHref: null,
    caseHref: null,
    calls: 0,
    texts: 0,
    nextCallLabel: job.dueLabel,
    callJobId: job.id,
    callTag: job.assignedName || null,
    textJobId: null,
    reminderAt: null,
    nextAction: [{ label: "Call", when: job.dueLabel, at: job.dueAt }],
    nextActionAt: job.dueAt,
    nextDayKey: "",
    nextDayLabel: "",
  };
}
