import Link from "next/link";
import { CAPTURE_LABEL, CHANNEL_PAGE_SIZE, loadChannelAudit, type ChannelAuditRow } from "@/lib/lead-channel";
import { leadTitle } from "@/lib/leads";
import { requireStaff } from "@/lib/session";
import { loadSlackSettings } from "@/lib/slack-settings";
import { formatChicago } from "@/lib/time";

export const metadata = { title: "Lead channel · Intake Manager" };

const COLUMNS = [
  "When",
  "Slack post",
  "Captured",
  "Name",
  "Phone",
  "Channel",
  "Accident",
  "Grade",
  "Consult",
  "Qualified",
  "Desired",
  "Signed",
  "Not a lead",
  "Decline",
  "Injury",
  "Size",
  "Unresponsive",
  "Handled by",
  "Still blank",
] as const;

function logHref(input: { view?: string; q?: string; page?: number; cursor?: string }): string {
  const params = new URLSearchParams();
  if (input.view && input.view !== "all") params.set("view", input.view);
  if (input.q) params.set("q", input.q);
  if (input.page && input.page > 1) params.set("page", String(input.page));
  if (input.cursor) params.set("cursor", input.cursor);
  const query = params.toString();
  return query ? `/calls?${query}` : "/calls";
}

function missedCapture(row: ChannelAuditRow): boolean {
  return row.capture === "not_stored" || row.capture === "no_lead";
}

export default async function LeadChannelPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string; page?: string; cursor?: string }>;
}) {
  const params = await searchParams;
  const view = params.view === "gaps" ? "gaps" : "all";
  const q = (params.q || "").trim().slice(0, 80);
  const page = Math.max(1, Number(params.page) || 1);
  const cursor = params.cursor || "";
  const { supabase } = await requireStaff();
  const slack = await loadSlackSettings();
  const audit = await loadChannelAudit(supabase, {
    token: slack.token,
    channelId: slack.channelId,
    cursor: cursor || undefined,
    page,
    q,
    gapsOnly: view === "gaps",
  });
  const pages = audit.total == null ? null : Math.max(1, Math.ceil(audit.total / CHANNEL_PAGE_SIZE));

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight text-navy">#lead-calls</h1>
      <p className="mt-1 max-w-3xl text-sm text-slate-600">
        Each row is a post in the leads Slack channel, with the lead fields stored from it. Use it to check that a
        call, form, or thread reply was captured with the right decision.
      </p>
      <p className="mt-2 max-w-3xl text-sm text-slate-600">
        <span className="font-medium text-slate-800">Not a lead</span> is why a caller stays out of the work queue:
        spam, a vendor, a job seeker, an existing client, an insurance company, another law office, a wrong number, or
        a return call. A blank cell means the person was kept as a lead. A non-PI legal matter stays a lead and is
        listed there so it can be referred.
      </p>
      {audit.notice ? <p className="mt-3 max-w-3xl text-sm text-amber-800">{audit.notice}</p> : null}

      <form className="mt-4 flex flex-wrap items-center gap-2" action="/calls">
        <input type="hidden" name="view" value={view} />
        <input
          name="q"
          defaultValue={q}
          placeholder="Name, phone, or post"
          className="w-56 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        <button type="submit" className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-navy">
          Search
        </button>
        {q ? (
          <Link href={logHref({ view })} className="text-sm text-slate-500 hover:text-slate-900">
            Clear
          </Link>
        ) : null}
      </form>

      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        {(
          [
            ["all", "All posts"],
            ["gaps", "Needs a look"],
          ] as const
        ).map(([id, label]) => (
          <Link
            key={id}
            href={logHref({ view: id, q })}
            className={`rounded-full px-3 py-1 ${view === id ? "bg-brand font-medium text-navy" : "bg-slate-100 text-slate-700"}`}
          >
            {label}
          </Link>
        ))}
        {audit.total != null ? (
          <span className="self-center text-slate-500">{audit.total.toLocaleString()} stored posts</span>
        ) : (
          <span className="self-center text-slate-500">Read from #lead-calls</span>
        )}
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-[1680px] w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {COLUMNS.map((column) => (
                <th key={column} className="whitespace-nowrap px-3 py-2 font-medium">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {audit.rows.map((row) => (
              <tr
                key={row.id}
                className={`border-b border-slate-100 align-top ${missedCapture(row) ? "bg-rose-50" : ""}`}
              >
                <td className="whitespace-nowrap px-3 py-2 text-slate-600">{formatChicago(row.when)}</td>
                <td className="max-w-xs px-3 py-2 text-slate-700">
                  <p className="line-clamp-3">{row.post || "—"}</p>
                  {row.slackUrl ? (
                    <a href={row.slackUrl} className="mt-1 inline-block text-xs text-slate-500 hover:text-slate-900" target="_blank" rel="noreferrer">
                      Slack
                    </a>
                  ) : null}
                  {row.quoUrl ? (
                    <a href={row.quoUrl} className="mt-1 ml-2 inline-block text-xs text-slate-500 hover:text-slate-900" target="_blank" rel="noreferrer">
                      Quo
                    </a>
                  ) : null}
                </td>
                <td className="whitespace-nowrap px-3 py-2">{CAPTURE_LABEL[row.capture]}</td>
                <td className="px-3 py-2">
                  {row.leadId ? (
                    <Link href={`/leads/${row.leadId}`} className="font-medium text-navy hover:underline">
                      {leadTitle({ lead_name: row.leadName, phone: row.phone })}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2">{row.phone || "—"}</td>
                <td className="whitespace-nowrap px-3 py-2">{row.channel}</td>
                <td className="px-3 py-2">{row.accident}</td>
                <td className="px-3 py-2">{row.grade}</td>
                <td className="whitespace-nowrap px-3 py-2">{row.consult}</td>
                <td className="px-3 py-2">{row.qualified}</td>
                <td className="px-3 py-2">{row.desired}</td>
                <td className="px-3 py-2">{row.signed}</td>
                <td className="px-3 py-2">{row.notALead}</td>
                <td className="px-3 py-2">{row.decline}</td>
                <td className="px-3 py-2">{row.injury}</td>
                <td className="px-3 py-2">{row.size}</td>
                <td className="px-3 py-2">{row.notQualified}</td>
                <td className="px-3 py-2">{row.handledBy}</td>
                <td className="px-3 py-2 text-amber-800">{row.blanks || "—"}</td>
              </tr>
            ))}
            {audit.rows.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-8 text-slate-500">
                  Nothing in this view.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center gap-3 text-sm">
        {audit.source === "slack" && cursor ? (
          <Link href={logHref({ view, q })} className="text-navy hover:underline">
            Newest
          </Link>
        ) : null}
        {audit.source === "stored" && page > 1 ? (
          <Link href={logHref({ view, q, page: page - 1 })} className="text-navy hover:underline">
            Newer
          </Link>
        ) : null}
        {pages != null ? (
          <span className="text-slate-500">
            Page {page} of {pages}
          </span>
        ) : null}
        {audit.source === "slack" && audit.nextCursor ? (
          <Link href={logHref({ view, q, cursor: audit.nextCursor })} className="text-navy hover:underline">
            Older
          </Link>
        ) : null}
        {audit.source === "stored" && pages != null && page < pages ? (
          <Link href={logHref({ view, q, page: page + 1 })} className="text-navy hover:underline">
            Older
          </Link>
        ) : null}
      </div>
    </main>
  );
}
