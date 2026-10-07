import Link from "next/link";
import { runDueWork } from "@/lib/ops-actions";
import { requireStaff } from "@/lib/session";

export default async function QueuesPage({
  searchParams,
}: {
  searchParams: Promise<{ texts?: string; calls?: string; slack?: string; failed?: string }>;
}) {
  const params = await searchParams;
  const { supabase } = await requireStaff();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("lead_jobs")
    .select("id, queue, position, due_at, body, status, leads(lead_name, phone)")
    .in("status", ["pending", "failed"])
    .order("due_at")
    .limit(80);
  const { data: posts } = await supabase
    .from("slack_posts")
    .select("id, body, due_at, status, leads(lead_name)")
    .eq("status", "pending")
    .order("due_at")
    .limit(40);

  const jobs = (data ?? []) as {
    id: string;
    queue: string;
    position: number;
    due_at: string;
    body: string;
    status: string;
    leads: { lead_name: string | null; phone: string | null } | { lead_name: string | null; phone: string | null }[] | null;
  }[];

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Queues</h1>
          <p className="mt-1 text-sm text-slate-600">
            Texts send through Quo only when live sending is on. Calls and scheduled Slack notes
            post into the lead thread for someone to handle.
          </p>
        </div>
        <form action={runDueWork}>
          <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">
            Run what is due
          </button>
        </form>
      </div>
      {params.texts || params.calls || params.slack || params.failed ? (
        <p className="mt-4 text-sm text-slate-700">
          Last run: {params.texts ?? 0} texts sent, {params.calls ?? 0} calls posted, {params.slack ?? 0} Slack
          notes, {params.failed ?? 0} failed.
        </p>
      ) : null}
      {error ? <p className="mt-4 text-sm text-red-700">{error.message}</p> : null}
      <section className="mt-6">
        <h2 className="text-sm font-semibold">Texts and calls</h2>
        <ul className="mt-3 space-y-2">
          {jobs.map((job) => {
            const lead = Array.isArray(job.leads) ? job.leads[0] : job.leads;
            const due = job.due_at <= now;
            return (
              <li key={job.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                <span className="font-medium">{job.queue === "text" ? "Text" : "Call"} {job.position}</span>
                <span className="text-slate-500">
                  {" "}
                  · {lead?.lead_name || "Unnamed"} · {due ? "due" : "later"} · {job.status} ·{" "}
                  {new Date(job.due_at).toLocaleString()}
                </span>
                <p className="mt-1">{job.body}</p>
              </li>
            );
          })}
          {jobs.length === 0 ? <li className="text-sm text-slate-500">Nothing is waiting.</li> : null}
        </ul>
      </section>
      <section className="mt-8">
        <h2 className="text-sm font-semibold">Scheduled Slack posts</h2>
        <ul className="mt-3 space-y-2">
          {(posts ?? []).map((post) => {
            const row = post as { id: string; body: string; due_at: string; leads: { lead_name: string | null } | { lead_name: string | null }[] | null };
            const lead = Array.isArray(row.leads) ? row.leads[0] : row.leads;
            return (
              <li key={row.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                <Link href="/" className="font-medium">
                  {lead?.lead_name || "Unnamed lead"}
                </Link>
                <span className="text-slate-500"> · {new Date(row.due_at).toLocaleString()}</span>
                <p className="mt-1">{row.body}</p>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
