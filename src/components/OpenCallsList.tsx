"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
  tagged: string;
  placeLabel: string;
  placeHref: string | null;
  quoUrl: string | null;
  assignedName: string;
  consultName: string;
  dueAt: string;
};

export function OpenCallsList({
  view,
  waitingCount,
  upcomingCount,
  jobs,
  shelves,
  destinations,
  templates,
  staff,
  staffNames,
  initialId,
}: {
  view: "waiting" | "upcoming";
  waitingCount: number;
  upcomingCount: number;
  jobs: OpenCallCard[];
  shelves: QueueRow[];
  destinations: ReferralDestination[];
  templates: { en: string; es: string };
  staff: StaffPerson[];
  staffNames: string[];
  initialId?: string;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(initialId && shelves.some((row) => row.id === initialId) ? initialId : "");
  const selected = shelves.find((row) => row.id === selectedId) ?? null;

  function openLead(leadId: string) {
    setSelectedId(leadId);
    router.replace(callsHref(view, leadId), { scroll: false });
  }

  function closeLead() {
    setSelectedId("");
    router.replace(callsHref(view), { scroll: false });
  }

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

      <div className={`mt-6 grid items-start gap-4 ${selected ? "xl:grid-cols-[minmax(0,1fr)_28rem]" : ""}`}>
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
                    onClick={() => openLead(job.leadId)}
                    className="font-medium text-navy hover:underline"
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
              <p className="mt-2 text-slate-800">
                Tag: <span className="font-medium">{job.tagged}</span>
                <span className="text-slate-500"> · {job.placeLabel}</span>
              </p>
              <OpenCallPlan
                jobId={job.id}
                dueAt={job.dueAt}
                assignedName={job.assignedName}
                consultName={job.consultName}
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
