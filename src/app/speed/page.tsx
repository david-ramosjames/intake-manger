import Link from "next/link";
import { dashboardPeriod, loadSpeedDetail, resolvePeriod, type PeriodId, type ResolvedPeriod, type SpeedEvent } from "@/lib/dashboard";
import { requireStaff } from "@/lib/session";
import { formatChicago } from "@/lib/time";

export const metadata = { title: "Speed to lead · Intake Manager" };

export default async function SpeedPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string; view?: string }>;
}) {
  const params = await searchParams;
  const period = dashboardPeriod(resolvePeriod(params));
  const view = params.view === "met" || params.view === "late" ? params.view : "all";
  const { supabase } = await requireStaff();
  const detail = await loadSpeedDetail(supabase, period, { log: true });
  const events = detail.events.filter((event) => (view === "met" ? event.met : view === "late" ? !event.met : true));
  const late = detail.total - detail.met;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6">
      <Link href={homeHref(period)} className="text-sm text-slate-500 hover:text-navy">
        Intake
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-navy">Contacted within 2 minutes</h1>
      <p className="mt-1 text-sm text-slate-600">{period.label}</p>
      <p className="mt-3 text-sm text-slate-700">
        {detail.total
          ? `${detail.met} of ${detail.total} were contacted in time. ${late} were not.`
          : "Nothing in this period."}
      </p>
      <p className="mt-1 text-sm text-slate-500">
        Only intake leads are listed. Insurance companies, existing clients, and other non-leads are left out. The first outbound text or call counts, including the automatic text, when it is stored on the lead or the same phone number. Open a row for the log and the Slack post.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Filter period={period} view="all" current={view} label={`All ${detail.total}`} />
        <Filter period={period} view="met" current={view} label={`In 2 minutes ${detail.met}`} />
        <Filter period={period} view="late" current={view} label={`Missed the window ${late}`} />
      </div>

      <div className="mt-4 divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {events.length ? (
          events.map((event) => <SpeedRow key={`${event.id}-${event.at}`} event={event} />)
        ) : (
          <p className="px-4 py-6 text-sm text-slate-500">Nothing in this view.</p>
        )}
      </div>
    </main>
  );
}

function SpeedRow({ event }: { event: SpeedEvent }) {
  return (
    <details className="group px-4 py-3">
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900">
              {event.kind}
              <span className="mx-2 font-normal text-slate-300">·</span>
              {event.name}
              <span className="ml-2 font-normal text-slate-500">{event.phone}</span>
            </p>
            <p className="mt-0.5 text-xs text-slate-500">{formatChicago(event.at)}</p>
          </div>
          <p className={`text-sm font-medium ${event.met ? "text-emerald-700" : "text-red-700"}`}>{event.wait}</p>
        </div>
      </summary>
      <div className="mt-3 flex flex-wrap gap-4">
        {event.leadId ? (
          <Link href={`/leads/${event.leadId}`} className="text-sm text-navy hover:underline">
            Open {event.name}
          </Link>
        ) : null}
        {event.slack ? (
          <a href={event.slack} target="_blank" rel="noreferrer" className="text-sm text-navy hover:underline">
            Slack post
          </a>
        ) : (
          <span className="text-sm text-slate-400">No Slack post stored</span>
        )}
      </div>
      <ol className="mt-3 space-y-2 border-l border-slate-200 pl-3">
        {event.log.map((touch, index) => (
          <li key={`${touch.at}-${touch.label}-${index}`} className="text-sm">
            <p className="text-slate-800">
              <span className="font-medium">{touch.label}</span>
              <span className="ml-2 text-xs text-slate-500">{formatChicago(touch.at)}</span>
              {touch.slack ? (
                <a href={touch.slack} target="_blank" rel="noreferrer" className="ml-2 text-xs text-navy hover:underline">
                  Slack
                </a>
              ) : null}
            </p>
            {touch.note ? <p className="text-slate-600">{touch.note}</p> : null}
          </li>
        ))}
      </ol>
    </details>
  );
}

function Filter({
  period,
  view,
  current,
  label,
}: {
  period: ResolvedPeriod;
  view: "all" | "met" | "late";
  current: string;
  label: string;
}) {
  return (
    <Link
      href={speedHref(period, view)}
      className={`rounded-full px-3 py-1 text-sm ${
        current === view ? "bg-navy text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
      }`}
    >
      {label}
    </Link>
  );
}

function speedHref(period: ResolvedPeriod, view: "all" | "met" | "late"): string {
  const params = new URLSearchParams({ period: period.id });
  if (period.id === "custom") {
    params.set("from", period.start);
    params.set("to", period.end);
  }
  if (view !== "all") params.set("view", view);
  return `/speed?${params}`;
}

function homeHref(period: ResolvedPeriod): string {
  if (period.id === "l7" || period.id === "custom") return "/";
  return `/?period=${period.id as PeriodId}`;
}
