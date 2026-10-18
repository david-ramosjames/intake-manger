import Link from "next/link";
import { loadStaff, type StaffPerson } from "@/lib/identity";
import { leadTitle, slackMessageUrl } from "@/lib/leads";
import { requireStaff } from "@/lib/session";
import { LEAD_CHANNEL_ID } from "@/lib/slack";
import { loadSlackSettings } from "@/lib/slack-settings";
import { isPlaceholderOwner } from "@/lib/talked-with";
import { formatChicago } from "@/lib/time";

export const metadata = { title: "Open calls · Intake Manager" };

type LeadBits = {
  id: string;
  lead_name: string | null;
  phone: string | null;
  owner_name: string | null;
  slack_permalink: string | null;
  slack_channel_id: string | null;
  slack_message_ts: string | null;
  slack_thread_ts: string | null;
  identity_status: string | null;
};

type JobRow = {
  id: string;
  lead_id: string;
  position: number;
  due_at: string;
  body: string;
  status: string;
  mention: string | null;
  assigned_name: string | null;
  assigned_email: string | null;
  notified_at: string | null;
  leads: LeadBits | LeadBits[] | null;
};

function leadOf(job: JobRow): LeadBits | null {
  if (!job.leads) return null;
  return Array.isArray(job.leads) ? job.leads[0] ?? null : job.leads;
}

function slackUserId(mention: string | null): string {
  return (mention || "").replace(/[<@>]/g, "").trim();
}

function taggedAs(job: JobRow, lead: LeadBits | null, staff: StaffPerson[]): string {
  const id = slackUserId(job.mention);
  const bySlack = id ? staff.find((person) => person.slackUserId === id) : null;
  if (bySlack) return bySlack.name;
  if (job.assigned_name && !isPlaceholderOwner(job.assigned_name)) return job.assigned_name.trim();
  if (lead?.owner_name && !isPlaceholderOwner(lead.owner_name)) return lead.owner_name.trim();
  if (job.assigned_email) return job.assigned_email;
  if (id) return "Channel tag";
  return "Not tagged yet";
}

function callPlace(
  lead: LeadBits | null,
  channelId: string,
): { label: string; href: string | null } {
  const href = lead ? slackMessageUrl(lead) : null;
  const channel = lead?.slack_channel_id || channelId;
  if (!channel || channel === channelId || channel === LEAD_CHANNEL_ID) {
    return { label: "#lead-calls", href };
  }
  return { label: "Case channel", href };
}

function JobCard({
  job,
  staff,
  channelId,
  now,
}: {
  job: JobRow;
  staff: StaffPerson[];
  channelId: string;
  now: number;
}) {
  const lead = leadOf(job);
  const place = callPlace(lead, channelId);
  const tagged = taggedAs(job, lead, staff);
  const overdue = new Date(job.due_at).getTime() < now;
  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={`/leads/${job.lead_id}`} className="font-medium text-navy hover:underline">
            {leadTitle({
              lead_name: lead?.lead_name ?? null,
              phone: lead?.phone ?? null,
              identity_status: lead?.identity_status,
            })}
          </Link>
          <span className="text-slate-500">
            {" "}
            · Call {job.position}
            {lead?.phone ? ` · ${lead.phone}` : ""}
          </span>
          <p className="mt-1 text-slate-700">
            {overdue ? "Overdue" : "Due"} {formatChicago(job.due_at)}
            {job.notified_at ? ` · Open since ${formatChicago(job.notified_at)}` : ""}
          </p>
        </div>
        {place.href ? (
          <a href={place.href} className="text-sm text-navy hover:underline" target="_blank" rel="noreferrer">
            {place.label}
          </a>
        ) : (
          <span className="text-slate-500">{place.label}</span>
        )}
      </div>
      <p className="mt-2 text-slate-800">
        Tagged: <span className="font-medium">{tagged}</span>
        <span className="text-slate-500"> · {place.label}</span>
      </p>
      <p className="mt-1 text-slate-600">{job.body}</p>
    </li>
  );
}

export default async function OpenCallsPage() {
  const { supabase } = await requireStaff();
  const now = Date.now();
  const [{ data, error }, staff, slack] = await Promise.all([
    supabase
      .from("lead_jobs")
      .select(
        "id, lead_id, position, due_at, body, status, mention, assigned_name, assigned_email, notified_at, leads(id, lead_name, phone, owner_name, slack_permalink, slack_channel_id, slack_message_ts, slack_thread_ts, identity_status)",
      )
      .eq("queue", "call")
      .eq("status", "pending")
      .order("due_at")
      .limit(400),
    loadStaff(supabase),
    loadSlackSettings(),
  ]);

  const jobs = (data ?? []) as JobRow[];
  const open = jobs.filter((job) => Boolean(job.notified_at));
  const upcoming = jobs.filter((job) => !job.notified_at);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-navy">Open calls</h1>
      <p className="mt-1 max-w-3xl text-sm text-slate-600">
        Who is tagged, where the call lives in Slack, and what is coming next. Quo already posts the
        call itself — this list is the reminder queue, not a second Slack post.
      </p>
      {error ? <p className="mt-4 text-sm text-red-700">{error.message}</p> : null}

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Open now · {open.length}
        </h2>
        <ul className="mt-3 space-y-3">
          {open.map((job) => (
            <JobCard key={job.id} job={job} staff={staff} channelId={slack.channelId} now={now} />
          ))}
          {open.length === 0 && !error ? (
            <li className="text-sm text-slate-500">No call is waiting on a tag right now.</li>
          ) : null}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Upcoming tags · {upcoming.length}
        </h2>
        <ul className="mt-3 space-y-3">
          {upcoming.map((job) => (
            <JobCard key={job.id} job={job} staff={staff} channelId={slack.channelId} now={now} />
          ))}
          {upcoming.length === 0 && !error ? (
            <li className="text-sm text-slate-500">No upcoming call tags are scheduled.</li>
          ) : null}
        </ul>
      </section>
    </main>
  );
}
