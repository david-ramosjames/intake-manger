import Link from "next/link";
import { notFound } from "next/navigation";
import { IdentityMark } from "@/components/IdentityMark";
import { ReferralPanel } from "@/components/ReferralPanel";
import { LeadForm } from "@/components/LeadForm";
import { updateLead } from "@/lib/actions";
import { confirmLead, confirmSigned, markNotALead, resolveIdentity, saveCallbackPlan, savePriority, startFollowUp } from "@/lib/ops-actions";
import { CallWork } from "@/components/CallWork";
import { callOutcomeLabel } from "@/lib/calls";
import { describeFollowUp } from "@/lib/followup";
import { chicagoLocalInput, formatChicago } from "@/lib/time";
import { consultationWhen, contractSent, desiredWord, milestoneDesired, milestoneQualified, signatureNeedsConfirm } from "@/lib/desired";
import { daysOpen, leadTitle, listAccident, LEAD_ARRIVAL_LABEL, LEAD_KIND_LABEL, LEAD_SENTIMENT_LABEL, priorityReasonText, slackMessageUrl, type Lead, type LeadArrival, type LeadEvent, type LeadSentiment } from "@/lib/leads";
import { heardClientName, loadStaff, suggestClientName, type StaffPerson } from "@/lib/identity";
import { leadCycle, leadNeed, leadStatusLabel, outreachSequence, PRIORITY_PLACE_LABEL, priorityPlace } from "@/lib/next-step";
import { DEFAULT_REFERRAL_SMS, type ReferralDestination } from "@/lib/referrals";
import { requireStaff } from "@/lib/session";
import { slackThreadNotes } from "@/lib/slack";
import { loadSlackSettings } from "@/lib/slack-settings";
import { docketBaseUrl } from "@/lib/supabase/config";
import { buttonDanger, buttonPrimary, buttonSecondary } from "@/lib/ui";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, email } = await requireStaff();
  const docket = docketBaseUrl();

  const [{ data, error }, eventsResult, jobsResult, destinationsResult, templatesResult, attemptsResult, staff, historyResult, slackSettings] = await Promise.all([
    supabase.from("leads").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("lead_events")
      .select("id, event_type, actor, payload, created_at")
      .eq("lead_id", id)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("lead_jobs")
      .select("id, queue, position, due_at, body, status, detail, assigned_email, assigned_name, mention, outcome, notified_at")
      .eq("lead_id", id)
      .order("queue")
      .order("position"),
    supabase.from("referral_destinations").select("id, name, phone, practice_areas, address, email, website, spanish, matters, notes, active").eq("active", true).order("name"),
    supabase.from("referral_templates").select("language, body"),
    supabase
      .from("call_attempts")
      .select("id, job_id, outcome, note, actor, attempted_at")
      .eq("lead_id", id)
      .order("attempted_at", { ascending: false })
      .limit(20),
    loadStaff(supabase),
    supabase
      .from("intake_interactions")
      .select("id, type, direction, content, transcript, quo_link, occurred_at")
      .eq("lead_id", id)
      .order("occurred_at", { ascending: false })
      .limit(30),
    loadSlackSettings(),
  ]);

  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8 text-sm text-red-700">{error.message}</main>
    );
  }
  if (!data) notFound();
  const lead = data as Lead;
  const events = (eventsResult.data ?? []) as LeadEvent[];
  const jobs = (jobsResult.data ?? []) as {
    id: string;
    queue: string;
    position: number;
    due_at: string;
    body: string;
    status: string;
    detail: string | null;
    assigned_email: string | null;
    assigned_name: string | null;
    mention: string | null;
    outcome: string | null;
    notified_at: string | null;
  }[];
  const destinations = (destinationsResult.data ?? []) as ReferralDestination[];
  const templateRows = (templatesResult.data ?? []) as { language: string; body: string }[];
  const templates = {
    en: templateRows.find((row) => row.language === "en")?.body || DEFAULT_REFERRAL_SMS.en,
    es: templateRows.find((row) => row.language === "es")?.body || DEFAULT_REFERRAL_SMS.es,
  };
  const promoteHref = lead.intake_call_id
    ? `${docket}/intakes/${encodeURIComponent(lead.intake_call_id)}/promote`
    : null;
  const intakeHref = lead.intake_call_id
    ? `${docket}/intakes/${encodeURIComponent(lead.intake_call_id)}`
    : null;
  const caseHref = lead.case_id ? `${docket}/cases/${lead.case_id}` : null;
  const slackUrl = slackMessageUrl(lead);
  const openFor = daysOpen(lead.lead_date ?? lead.created_at, lead.date_signed ?? lead.signed_at);
  const touches = (historyResult.data ?? []) as { type: string | null; direction: string | null }[];
  const cycle = leadCycle(lead, touches);
  const priority = priorityPlace(lead);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/work" className="text-sm text-slate-500 hover:text-slate-900">
        All leads
      </Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-navy">
            {leadTitle(lead)}
            <IdentityMark status={lead.identity_status} />
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {leadStatusLabel(lead, cycle)}
            {priority ? ` · ${PRIORITY_PLACE_LABEL[priority]}` : ""}
            {` · ${LEAD_KIND_LABEL[lead.kind]}`}
            {lead.arrival ? ` · ${LEAD_ARRIVAL_LABEL[lead.arrival as LeadArrival] ?? lead.arrival}` : ""}
            {listAccident(lead) !== "—" ? ` · ${listAccident(lead)}` : ""}
            {lead.owner_name ? ` · handled by ${lead.owner_name}` : " · nobody assigned"}
            {lead.grade ? ` · Grade ${lead.grade}` : " · no grade"}
            {openFor != null ? ` · ${openFor} day${openFor === 1 ? "" : "s"} open` : ""}
            {lead.sentiment ? ` · ${LEAD_SENTIMENT_LABEL[lead.sentiment as LeadSentiment]}` : ""}
          </p>
          <LeadNeed lead={lead} touches={touches} />
          {(() => {
            const next = jobs
              .filter((job) => job.queue === "call" && job.status === "pending")
              .sort((a, b) => a.due_at.localeCompare(b.due_at))[0];
            if (!next) return null;
            return (
              <p className="mt-1 text-sm text-slate-800">
                Next call {formatChicago(next.due_at)}
                {next.assigned_email ? ` · ${next.assigned_email}` : " · unassigned"}
              </p>
            );
          })()}
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          {lead.quo_link ? (
            <a href={lead.quo_link} className={buttonSecondary} target="_blank" rel="noreferrer">
              Open in Quo
            </a>
          ) : null}
          {slackUrl ? (
            <a href={slackUrl} className="font-medium text-slate-900 underline" target="_blank" rel="noreferrer">
              First Slack post
            </a>
          ) : null}
          {intakeHref ? (
            <a href={intakeHref} className="font-medium text-slate-900 underline" target="_blank" rel="noreferrer">
              Intake form
            </a>
          ) : null}
        </div>
      </div>

      <dl className="mt-4 grid gap-2 sm:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Consultation</dt>
          <dd className="mt-1 text-sm text-slate-900">
            {lead.consultation_date ? consultationWhen(lead.consultation_date) : lead.consultation === "no" ? "No" : "—"}
          </dd>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Qualified</dt>
          <dd className="mt-1 text-sm text-slate-900">{desiredWord(milestoneQualified(lead))}</dd>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Desired</dt>
          <dd className="mt-1 text-sm text-slate-900">{desiredWord(milestoneDesired(lead))}</dd>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Signed</dt>
          <dd className="mt-1 text-sm text-slate-900">{lead.signed_case ? "Yes" : "—"}</dd>
        </div>
      </dl>
      {signatureNeedsConfirm(lead) ? (
        <form action={confirmSigned} className="mt-4 rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm">
          <input type="hidden" name="lead_id" value={lead.id} />
          <p className="font-medium text-violet-950">The contract looks complete.</p>
          <p className="mt-1 text-violet-900">Signed stays open until someone confirms every required signature is done.</p>
          <button className={`${buttonPrimary} mt-3`}>Confirm signed</button>
        </form>
      ) : null}

      {lead.signed_case || lead.case_id || lead.lead_status === "Signed" || lead.lead_status === "Promoted" ? null : lead.close_reason === "not_a_lead" ? (
        <p className="mt-4 text-sm text-slate-600">Not a lead. Calls and texts are off.</p>
      ) : (
        <form action={markNotALead.bind(null, lead.id)} className="mt-4">
          <button type="submit" className={buttonDanger}>
            Not a lead
          </button>
          <p className="mt-1 text-sm text-slate-500">
            Closes the lead and stops calls and texts. Use this when the call was never a personal-injury matter.
          </p>
        </form>
      )}

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Priority</h2>
        <p className="mt-1 text-sm text-slate-600">
          A sent contract stays on the priority list until the lead is signed or closed. Flag a lead yourself for a promising web form, a high-quality referral, or another reason. Write the next action the way you would say it.
        </p>
        {lead.priority_suggestion ? (
          <p className="mt-3 text-sm text-sky-900">Quo suggested this lead: {lead.priority_suggestion}</p>
        ) : null}
        <form action={savePriority.bind(null, lead.id)} className="mt-4 grid gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="hidden" name="priority" value="no" />
            <input type="checkbox" name="priority" value="yes" defaultChecked={lead.priority} className="accent-accent" />
            <span className="text-slate-600">Flag as priority</span>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Why it is flagged</span>
            <input
              name="priority_reason"
              defaultValue={priorityReasonText(lead.priority_reason) ?? ""}
              placeholder="Promising web form, high-quality referral"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Last action</span>
            <textarea
              name="last_action"
              defaultValue={lead.last_action ?? ""}
              rows={2}
              placeholder="Sent the contract. Waiting on the signature."
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Next action</span>
            <textarea
              name="next_action"
              defaultValue={lead.next_action ?? ""}
              rows={2}
              placeholder="Call Thursday if it is still unsigned."
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <button type="submit" className={`${buttonPrimary} w-fit`}>
            Save priority
          </button>
        </form>
      </section>

      {lead.signed_case && !lead.case_id ? (
        <section className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="font-medium text-emerald-950">Signed. The client signed.</p>
          <p className="mt-1 text-sm text-emerald-900">
            Review the intake, correct anything that is still wrong, then promote it to a case.
            Promoting does not happen on its own.
          </p>
          {promoteHref ? (
            <a
              href={promoteHref}
              className="mt-3 inline-block rounded-md bg-emerald-900 px-3 py-1.5 text-sm font-medium text-white"
            >
              Review and promote
            </a>
          ) : (
            <p className="mt-2 text-sm text-emerald-900">
              This lead has no Docket intake yet, so promote is not available.
            </p>
          )}
        </section>
      ) : null}

      {lead.case_id ? (
        <section className="mt-6 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
          Promoted into Docket{lead.case_number ? ` as case ${lead.case_number}` : ""}.{" "}
          {caseHref ? (
            <a href={caseHref} className="font-medium underline">
              Open the case
            </a>
          ) : null}
        </section>
      ) : null}

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Lead record</h2>
        <p className="mt-1 mb-4 text-sm text-slate-600">
          These are the spreadsheet fields. A correction here is kept, and it clears the confirmation
          so someone can check it again.
        </p>
        {lead.needs_verification ? (
          <p className="mb-4 text-sm text-amber-800">
            This record needs verification. A name or phone was missing, or a value was filled in from the summary.
          </p>
        ) : null}
        {lead.confirmed_at ? (
          <p className="mb-4 text-sm text-emerald-800">
            Confirmed by {lead.confirmed_by} on {new Date(lead.confirmed_at).toLocaleString()}.
          </p>
        ) : (
          <form action={confirmLead.bind(null, lead.id)} className="mb-4">
            <button type="submit" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">
              Confirm this record
            </button>
          </form>
        )}
        {(lead.identity_status === "needs_review" || (!lead.lead_name?.trim() && suggestClientName(lead.summary, staff))) ? (
          <IdentityReview lead={lead} staff={staff} />
        ) : null}
        <LeadForm lead={lead} staff={staff} action={updateLead.bind(null, lead.id)} />
      </section>

      <Conversation
        history={await conversationHistory(lead, (historyResult.data ?? []) as HistoryRow[], slackSettings.token)}
        error={historyResult.error?.message ?? null}
      />

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Follow-up</h2>
        <FollowUpPanel
          lead={lead}
          jobs={jobs}
          viewerEmail={email}
          attempts={(attemptsResult.data ?? []) as { id: string; job_id: string | null; outcome: string; note: string | null; actor: string | null; attempted_at: string }[]}
        />
      </section>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Referral</h2>
        <p className="mt-1 text-sm text-slate-600">
          A legal matter this firm does not handle stays a lead. Tag the practice area, then text the attorney’s contact details and close it.
          {lead.referral_opportunity ? " Tagged as a referral opportunity." : ""}
          {lead.caller_class === "non_pi" ? " Classified as a non-PI legal matter." : ""}
        </p>
        <ReferralPanel
          leadId={lead.id}
          leadName={lead.lead_name}
          practiceArea={lead.practice_area}
          referralOpportunity={Boolean(lead.referral_opportunity)}
          destinations={destinations}
          templates={templates}
          closed={lead.lead_status === "Referred" || lead.lead_status === "Lost" || lead.lead_status === "Signed" || lead.lead_status === "Promoted" || lead.signed_case}
        />
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-slate-900">History</h2>
        <ol className="mt-3 space-y-2">
          {events.map((event) => (
            <li key={event.id} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
              <span className="font-medium">{labelFor(event.event_type)}</span>
              <span className="text-slate-500">
                {" "}
                · {event.actor || "system"} · {new Date(event.created_at).toLocaleString()}
              </span>
              {event.event_type === "grade_changed" || event.event_type === "sentiment_changed" ? (
                <p className="mt-1 text-slate-700">
                  {String(event.payload.from ?? "none")} → {String(event.payload.to ?? "none")}
                  {event.payload.reason ? ` — ${String(event.payload.reason)}` : ""}
                </p>
              ) : null}
            </li>
          ))}
          {events.length === 0 ? <li className="text-sm text-slate-500">No history yet.</li> : null}
        </ol>
      </section>
    </main>
  );
}

type HistoryRow = {
  id: string;
  type: string | null;
  direction: string | null;
  content: string | null;
  transcript: string | null;
  quo_link: string | null;
  occurred_at: string | null;
  actor?: string | null;
};

async function conversationHistory(lead: Lead, history: HistoryRow[], token: string | null): Promise<HistoryRow[]> {
  const notes = await slackThreadNotes({
    token,
    channelId: lead.slack_channel_id,
    threadTs: lead.slack_thread_ts || lead.slack_message_ts,
    permalink: lead.slack_permalink,
  });
  const combined = [
    ...history,
    ...notes.map((note) => ({
      id: note.id,
      type: "slack",
      direction: null,
      content: note.text,
      transcript: null,
      quo_link: null,
      occurred_at: note.occurred_at,
      actor: note.userName,
    })),
  ];
  combined.sort((a, b) => String(b.occurred_at || "").localeCompare(String(a.occurred_at || "")));
  return combined;
}

function LeadNeed({ lead, touches }: { lead: Lead; touches: { type: string | null; direction: string | null }[] }) {
  const need = leadNeed(lead, touches);
  if (!need) return null;
  return (
    <p className="mt-2 text-sm text-slate-800">
      <span className="font-medium">{need.title}.</span> {need.detail}
    </p>
  );
}

function Conversation({ history, error }: { history: HistoryRow[]; error: string | null }) {
  return (
    <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Conversation</h2>
      <p className="mt-1 text-sm text-slate-600">
        Calls and texts from Quo, plus what staff wrote in the Slack thread. Quo app posts stay out because those calls and texts are already here.
      </p>
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      <ul className="mt-3 space-y-2">
        {history.map((row) => (
          <li key={row.id} className="rounded-md border border-slate-100 px-3 py-2 text-sm">
            <p className="text-slate-500">
              {row.occurred_at ? formatChicago(row.occurred_at) : "Time not recorded"}
              {" · "}
              {row.type === "slack" ? (row.actor ? `Slack · ${row.actor}` : "Slack") : `${row.direction || "unknown"} ${row.type || "message"}`}
              {row.quo_link ? (
                <>
                  {" · "}
                  <a href={row.quo_link} className="underline" target="_blank" rel="noreferrer">
                    Quo
                  </a>
                </>
              ) : null}
            </p>
            {row.content ? (
              <p className="mt-1 whitespace-pre-wrap text-slate-800">
                {row.type === "slack" ? snippet(row.content, 4000) : snippet(row.content)}
              </p>
            ) : null}
            {row.transcript ? (
              <details className="mt-1">
                <summary className="cursor-pointer text-slate-600">Transcript</summary>
                <p className="mt-1 whitespace-pre-wrap text-slate-700">{snippet(row.transcript, 4000)}</p>
              </details>
            ) : null}
          </li>
        ))}
        {history.length === 0 && !error ? <li className="text-sm text-slate-500">No calls, texts, or Slack notes stored for this lead yet.</li> : null}
      </ul>
    </section>
  );
}

function snippet(value: string, max = 500): string {
  const text = value.trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function labelFor(eventType: string): string {
  if (eventType === "grade_changed") return "Grade changed";
  if (eventType === "sentiment_changed") return "Sentiment changed";
  if (eventType === "signed") return "Marked signed";
  if (eventType === "imported") return "Imported from call intake";
  if (eventType === "created") return "Lead added";
  if (eventType === "updated") return "Fields updated";
  if (eventType === "confirmed") return "Record confirmed";
  if (eventType === "captured") return "Captured from Slack";
  if (eventType === "referred") return "Referred out";
  if (eventType === "not_a_lead") return "Marked not a lead";
  if (eventType === "callrail_tags") return "Tags saved";
  if (eventType === "slack_touch") return "Another Slack post on this lead";
  if (eventType === "priority_set") return "Added to the priority list";
  if (eventType === "priority_cleared") return "Removed from the priority list";
  if (eventType === "enrolled") return "Follow-up steps created";
  if (eventType === "merged") return "Merged with another lead";
  if (eventType === "call_claimed") return "Call claimed";
  if (eventType === "call_outcome") return "Call outcome recorded";
  if (eventType === "identity_corrected") return "Client name corrected";
  if (eventType === "identity_kept") return "Name kept after identity review";
  if (eventType === "identity_flagged") return "Name flagged against the staff directory";
  if (eventType === "agreement_sent") return "Contract sent";
  if (eventType === "agreement_reminder") return "Contract reminder sent";
  if (eventType === "agreement_signed") return "Contract signed in Sign Flow";
  return eventType;
}

function Signals({ lead }: { lead: Lead }) {
  const reminders = lead.agreement_reminder_count ?? 0;
  const waiting = lead.agreement_status === "sent" || lead.agreement_status === "viewed";
  return (
    <div className="mt-3 space-y-1 text-sm text-slate-700">
      {lead.agreement_sent_at ? (
        <p>
          Contract {lead.agreement_status || "sent"} {formatChicago(lead.agreement_sent_at)}.
          {" "}
          {reminders === 0 ? "No reminders sent." : `${reminders} reminder${reminders === 1 ? "" : "s"} sent.`}
          {lead.agreement_last_reminder_at ? ` Last reminder ${formatChicago(lead.agreement_last_reminder_at)}.` : ""}
          {lead.agreement_next_reminder_at
            ? ` Next reminder ${formatChicago(lead.agreement_next_reminder_at)}.`
            : waiting
              ? " No upcoming reminder."
              : ""}
        </p>
      ) : (
        <p className="text-slate-500">No contract send recorded from Sign Flow.</p>
      )}
      {waiting ? <p>Contract sequence is {outreachSequence(lead).label.toLowerCase()}.</p> : null}
      {lead.text_sequence_status ? (
        <p>
          SMS sequence {lead.text_sequence_slug || "follow-up"} is {lead.text_sequence_status.replaceAll("_", " ")}.
          {lead.text_next_at ? ` Next text ${formatChicago(lead.text_next_at)}.` : ""}
        </p>
      ) : (
        <p className="text-slate-500">No SMS sequence recorded for this number.</p>
      )}
    </div>
  );
}

function IdentityReview({ lead, staff }: { lead: Lead; staff: StaffPerson[] }) {
  const suggestion = suggestClientName(lead.summary, staff);
  const heard = heardClientName(lead.identity_evidence);
  const currentName = lead.lead_name?.trim() || "";
  return (
    <form action={resolveIdentity.bind(null, lead.id)} className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3">
      <p className="text-sm font-medium text-amber-950">{heard ? `Heard ${heard}` : "Check the name"}</p>
      <input
        name="client_name"
        aria-label="Client name"
        defaultValue={suggestion || currentName}
        className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        {currentName ? (
          <button type="submit" name="decision" value="keep" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm">
            Keep {currentName}
          </button>
        ) : null}
        <button
          type="submit"
          name="decision"
          value="replace"
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-navy"
        >
          Save
        </button>
      </div>
    </form>
  );
}

function FollowUpPanel({
  lead,
  jobs,
  viewerEmail,
  attempts,
}: {
  lead: Lead;
  jobs: {
    id: string;
    queue: string;
    position: number;
    due_at: string;
    body: string;
    status: string;
    detail: string | null;
    assigned_email: string | null;
    assigned_name: string | null;
    mention: string | null;
  }[];
  viewerEmail: string;
  attempts: { id: string; outcome: string; note: string | null; actor: string | null; attempted_at: string }[];
}) {
  const described = describeFollowUp(lead, jobs);
  const closed = lead.signed_case || Boolean(lead.case_id) || ["Lost", "Referred", "Promoted", "Signed"].includes(lead.lead_status);
  const contract = contractSent(lead);
  const pendingCalls = jobs.filter((job) => job.queue === "call" && (job.status === "pending" || job.status === "failed"));
  return (
    <>
      <p className="mt-1 text-sm text-slate-600">
        {contract
          ? "A contract is out. The contract follow-up proposes the person who handled it, and a reminder posts in the Slack thread."
          : "Missed calls and form fills start the uncontacted sequence on their own. After a conversation, start the post-consultation sequence here."}
      </p>
      <p className="mt-3 text-sm">
        <span className="font-medium">{described.state}.</span>
        {described.reason ? <span className="text-slate-600"> {described.reason}</span> : null}
      </p>
      {described.nextCall ? (
        <p className="mt-1 text-sm text-slate-700">Next call: {described.nextCall}</p>
      ) : null}
      <Signals lead={lead} />
      <p className="mt-1 text-sm text-slate-500">
        A Slack post tells someone to call. It does not mean the call was completed.
      </p>
      {!closed && !contract && pendingCalls.length === 0 ? (
        <form action={startFollowUp.bind(null, lead.id)} className="mt-3">
          <button type="submit" className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-navy">
            Start follow-up sequence
          </button>
        </form>
      ) : null}
      <ul className="mt-3 space-y-2 text-sm">
        {jobs
          .filter((job) => !(job.queue === "text" && job.status === "skipped"))
          .map((job) => (
          <li key={job.id} className="rounded-md border border-slate-100 px-3 py-2">
            <span className="font-medium">{job.queue === "text" ? "Text" : "Call"} {job.position}</span>
            <span className="text-slate-500">
              {" "}
              · {job.status} · {formatChicago(job.due_at)}
            </span>
            <p className="mt-1 text-slate-700">{job.body}</p>
            {job.detail ? <p className="mt-1 text-slate-500">{job.detail}</p> : null}
            {job.assigned_name ? <p className="mt-1 text-slate-500">Tag {job.assigned_name}</p> : null}
            {job.queue === "call" && (job.status === "pending" || job.status === "failed") ? (
              <>
                <form action={saveCallbackPlan} className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <input type="hidden" name="job_id" value={job.id} />
                  <label className="block text-xs text-slate-500">
                    Slack posts
                    <input
                      type="datetime-local"
                      name="due_at"
                      required
                      defaultValue={chicagoLocalInput(job.due_at)}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900"
                    />
                  </label>
                  <label className="block text-xs text-slate-500">
                    Who to tag
                    <input
                      name="assigned_name"
                      defaultValue={job.assigned_name ?? ""}
                      placeholder="Any available intake person"
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900"
                    />
                  </label>
                  <button type="submit" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm">
                    Save reminder
                  </button>
                </form>
                <CallWork jobId={job.id} assignedEmail={job.assigned_email} viewerEmail={viewerEmail} />
              </>
            ) : null}
          </li>
        ))}
      </ul>
      {attempts.length ? (
        <div className="mt-4">
          <h3 className="text-sm font-medium text-slate-900">Call attempts</h3>
          <ul className="mt-2 space-y-1 text-sm text-slate-700">
            {attempts.map((attempt) => (
              <li key={attempt.id}>
                {formatChicago(attempt.attempted_at)} · {callOutcomeLabel(attempt.outcome)}
                {attempt.actor ? ` · ${attempt.actor}` : ""}
                {attempt.note ? ` — ${attempt.note}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : lead.quo_link ? (
        <p className="mt-4 text-sm text-slate-500">
          No outcome recorded here. Calls and texts from Quo are in the conversation above.
        </p>
      ) : null}
    </>
  );
}
