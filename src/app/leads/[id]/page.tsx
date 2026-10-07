import Link from "next/link";
import { notFound } from "next/navigation";
import { LeadForm } from "@/components/LeadForm";
import { updateLead } from "@/lib/actions";
import { confirmLead, scheduleSlackPost, sendReferral } from "@/lib/ops-actions";
import { LEAD_ARRIVAL_LABEL, LEAD_KIND_LABEL, LEAD_SENTIMENT_LABEL, type Lead, type LeadArrival, type LeadEvent, type LeadSentiment } from "@/lib/leads";
import { requireStaff } from "@/lib/session";
import { docketBaseUrl } from "@/lib/supabase/config";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireStaff();
  const docket = docketBaseUrl();

  const [{ data, error }, eventsResult, jobsResult, postsResult, destinationsResult] = await Promise.all([
    supabase.from("leads").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("lead_events")
      .select("id, event_type, actor, payload, created_at")
      .eq("lead_id", id)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("lead_jobs")
      .select("id, queue, position, due_at, body, status")
      .eq("lead_id", id)
      .order("queue")
      .order("position"),
    supabase
      .from("slack_posts")
      .select("id, body, due_at, status, mention")
      .eq("lead_id", id)
      .order("due_at", { ascending: false })
      .limit(10),
    supabase.from("referral_destinations").select("id, name, phone, case_types").eq("active", true).order("name"),
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
  }[];
  const posts = (postsResult.data ?? []) as {
    id: string;
    body: string;
    due_at: string;
    status: string;
    mention: string | null;
  }[];
  const destinations = (destinationsResult.data ?? []) as {
    id: string;
    name: string;
    phone: string | null;
    case_types: string[];
  }[];
  const suggested = destinations.find((destination) =>
    destination.case_types.some((phrase) =>
      (lead.case_type ?? "").toLowerCase().includes(phrase.toLowerCase()),
    ),
  );
  const promoteHref = lead.intake_call_id
    ? `${docket}/intakes/${encodeURIComponent(lead.intake_call_id)}/promote`
    : null;
  const intakeHref = lead.intake_call_id
    ? `${docket}/intakes/${encodeURIComponent(lead.intake_call_id)}`
    : null;
  const caseHref = lead.case_id ? `${docket}/cases/${lead.case_id}` : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/" className="text-sm text-slate-500 hover:text-slate-900">
        All leads
      </Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{lead.lead_name || "Unnamed lead"}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {LEAD_KIND_LABEL[lead.kind]}
            {lead.arrival ? ` · ${LEAD_ARRIVAL_LABEL[lead.arrival as LeadArrival] ?? lead.arrival}` : ""}
            {lead.owner_name ? ` · ${lead.owner_name}` : " · nobody assigned"}
            {lead.grade ? ` · Grade ${lead.grade}` : ""}
            {lead.sentiment ? ` · ${LEAD_SENTIMENT_LABEL[lead.sentiment as LeadSentiment]}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          {lead.quo_link ? (
            <a href={lead.quo_link} className="font-medium text-slate-900 underline" target="_blank" rel="noreferrer">
              Open in Quo
            </a>
          ) : null}
          {lead.slack_permalink ? (
            <a
              href={lead.slack_permalink}
              className="font-medium text-slate-900 underline"
              target="_blank"
              rel="noreferrer"
            >
              Slack thread
            </a>
          ) : null}
          {intakeHref ? (
            <a href={intakeHref} className="font-medium text-slate-900 underline" target="_blank" rel="noreferrer">
              Intake form
            </a>
          ) : null}
        </div>
      </div>

      {lead.signed_case && !lead.case_id ? (
        <section className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="font-medium text-emerald-950">This lead is signed.</p>
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
          Promoted{lead.case_number ? ` as case ${lead.case_number}` : ""}.{" "}
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
        <LeadForm lead={lead} action={updateLead.bind(null, lead.id)} />
      </section>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Follow-up</h2>
        <p className="mt-1 text-sm text-slate-600">
          {lead.kind === "needs_info"
            ? "This lead was already spoken with. Calls are queued. Texts stay off."
            : "This is a lead we want to sign. Texts and calls both run from the standard sequence."}
        </p>
        <ul className="mt-3 space-y-2 text-sm">
          {jobs.map((job) => (
            <li key={job.id} className="rounded-md border border-slate-100 px-3 py-2">
              <span className="font-medium">{job.queue === "text" ? "Text" : "Call"} {job.position}</span>
              <span className="text-slate-500">
                {" "}
                · {job.status} · {new Date(job.due_at).toLocaleString()}
              </span>
              <p className="mt-1 text-slate-700">{job.body}</p>
            </li>
          ))}
          {jobs.length === 0 ? (
            <li className="text-slate-500">Follow-up has not been started. Turn it on in the record and save.</li>
          ) : null}
        </ul>
      </section>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Slack for the team</h2>
        <form action={scheduleSlackPost.bind(null, lead.id)} className="mt-3 grid gap-3">
          <textarea
            name="body"
            required
            rows={3}
            placeholder="What should the team do?"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="font-medium text-slate-700">When</span>
              <input name="due_at" type="datetime-local" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
            </label>
            <label className="text-sm">
              <span className="font-medium text-slate-700">Slack member id to mention</span>
              <input name="mention" placeholder="U…" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
            </label>
          </div>
          <button type="submit" className="w-fit rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">
            Schedule Slack post
          </button>
        </form>
        <ul className="mt-4 space-y-2 text-sm">
          {posts.map((post) => (
            <li key={post.id}>
              <span className="font-medium">{post.status}</span>
              <span className="text-slate-500"> · {new Date(post.due_at).toLocaleString()}</span>
              <p>{post.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Refer this lead</h2>
        <p className="mt-1 text-sm text-slate-600">
          {suggested
            ? `${suggested.name} matches this case type.`
            : "Pick the firm from the referral tree. Sending stops texts and calls."}
        </p>
        <form action={sendReferral.bind(null, lead.id)} className="mt-3 grid gap-3">
          <select name="destination_id" defaultValue={suggested?.id ?? ""} className="rounded-md border border-slate-300 px-3 py-2 text-sm" required>
            <option value="">Choose a destination</option>
            {destinations.map((destination) => (
              <option key={destination.id} value={destination.id}>
                {destination.name}
                {destination.phone ? ` · ${destination.phone}` : ""}
              </option>
            ))}
          </select>
          <input name="note" placeholder="Anything the referral needs" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <button type="submit" className="w-fit rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">
            Send referral
          </button>
        </form>
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
  if (eventType === "slack_touch") return "Another Slack post on this lead";
  return eventType;
}
