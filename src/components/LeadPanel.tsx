import Link from "next/link";
import { IdentityMark } from "@/components/IdentityMark";
import { leadTitle, type Lead } from "@/lib/leads";
import { leadStatusLabel, type LeadCycle } from "@/lib/next-step";
import { automationLine, receivedLabel, stageClass } from "@/lib/queue";
import { formatChicago } from "@/lib/time";

type Touch = {
  id: string;
  type: string | null;
  direction: string | null;
  content: string | null;
  occurred_at: string | null;
  quo_link: string | null;
};

export function LeadPanel({
  lead,
  cycle,
  accident,
  age,
  step,
  calls,
  texts,
  lastLabel,
  nextCallLabel,
  touches,
  slack,
  intakeHref,
  caseHref,
  closeHref,
}: {
  lead: Pick<
    Lead,
    | "id"
    | "lead_name"
    | "phone"
    | "email"
    | "summary"
    | "identity_status"
    | "quo_link"
    | "text_sequence_status"
    | "text_sequence_slug"
    | "text_next_at"
    | "agreement_status"
    | "agreement_sent_at"
    | "owner_name"
    | "grade"
    | "close_reason"
  >;
  cycle: LeadCycle;
  accident: string;
  age: number | null;
  step: string;
  calls: number;
  texts: number;
  lastLabel: string;
  nextCallLabel: string;
  touches: Touch[];
  slack: string | null;
  intakeHref: string | null;
  caseHref: string | null;
  closeHref: string;
}) {
  const label = leadStatusLabel(lead, cycle);
  const automation = automationLine(lead);
  const when = receivedLabel(age);
  return (
    <aside className="flex max-h-[calc(100vh-6rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:sticky lg:top-4">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900">
            {leadTitle(lead)}
            <IdentityMark status={lead.identity_status} />
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {accident !== "—" ? accident : "Accident not captured"}
            {when ? ` · ${when}` : ""}
          </p>
        </div>
        <Link href={closeHref} className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-900">
          Close
        </Link>
      </div>
      <div className="space-y-5 overflow-y-auto px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${stageClass(label)}`}>{label}</span>
          <span className="text-sm text-slate-700">{step === "—" ? "No next step" : step}</span>
        </div>
        <p className="text-sm text-slate-600">
          {lead.phone || "No phone"}
          {lead.email ? ` · ${lead.email}` : ""}
          {lead.owner_name ? ` · ${lead.owner_name}` : ""}
          {lead.grade ? ` · Grade ${lead.grade}` : ""}
        </p>
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Summary</h3>
          <p className="mt-2 text-sm leading-6 text-slate-800">
            {lead.summary?.trim() || "No call summary yet. Quo writes one after the conversation."}
          </p>
        </section>
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Next</h3>
          <dl className="mt-2 space-y-1 text-sm text-slate-700">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Last contacted</dt>
              <dd>{lastLabel}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Next call</dt>
              <dd>{nextCallLabel}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Calls / texts</dt>
              <dd>
                {calls} / {texts}
              </dd>
            </div>
          </dl>
        </section>
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Automation</h3>
          <ul className="mt-2 space-y-2 text-sm">
            <li className="flex justify-between gap-3">
              <span className="text-slate-500">Quo</span>
              <span>{lead.quo_link || lead.summary ? "Synced" : "Waiting"}</span>
            </li>
            <li className="flex justify-between gap-3">
              <span className="text-slate-500">Texts</span>
              <span>
                {(lead.text_sequence_status || "").toLowerCase() === "active"
                  ? lead.text_next_at
                    ? `Next ${formatChicago(lead.text_next_at)}`
                    : "Live"
                  : "Off"}
              </span>
            </li>
            <li className="flex justify-between gap-3">
              <span className="text-slate-500">Contract</span>
              <span className={automation.bad ? "font-medium text-red-700" : ""}>
                {lead.agreement_status
                  ? `${lead.agreement_status}${lead.agreement_sent_at ? ` · ${formatChicago(lead.agreement_sent_at)}` : ""}`
                  : "Not sent"}
              </span>
            </li>
          </ul>
        </section>
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Activity</h3>
          {touches.length === 0 ? (
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
          <Link href={`/leads/${lead.id}`} className="font-medium text-slate-900 underline">
            Open lead
          </Link>
          {lead.quo_link ? (
            <a href={lead.quo_link} className="font-medium text-slate-900 underline" target="_blank" rel="noreferrer">
              Quo
            </a>
          ) : null}
          {slack ? (
            <a href={slack} className="font-medium text-slate-900 underline" target="_blank" rel="noreferrer">
              Slack
            </a>
          ) : null}
          {intakeHref ? (
            <a href={intakeHref} className="font-medium text-slate-900 underline" target="_blank" rel="noreferrer">
              Docket intake
            </a>
          ) : null}
          {caseHref ? (
            <a href={caseHref} className="font-medium text-slate-900 underline" target="_blank" rel="noreferrer">
              Case
            </a>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function touchLabel(touch: Touch): string {
  const type = (touch.type || "note").replaceAll("_", " ");
  const direction = (touch.direction || "").toLowerCase();
  if (direction === "inbound") return `Inbound ${type}`;
  if (direction === "outbound") return `Outbound ${type}`;
  return type.charAt(0).toUpperCase() + type.slice(1);
}
