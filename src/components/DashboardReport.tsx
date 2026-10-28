import Link from "next/link";
import { PERIODS, type CountMetric, type NavTiles, type PeriodId, type RateMetric, type ResolvedPeriod } from "@/lib/dashboard";

const TONE = {
  met: "border-emerald-600",
  short: "border-red-700",
  open: "border-slate-300",
  empty: "border-slate-200",
} as const;

const TONE_TEXT = {
  met: "text-emerald-700",
  short: "text-red-700",
  open: "text-slate-600",
  empty: "text-slate-400",
} as const;

export function DashboardReport({
  period,
  tiles,
  rates,
  counts,
}: {
  period: ResolvedPeriod;
  tiles: NavTiles;
  rates: RateMetric[];
  counts: CountMetric[];
}) {
  const tilesView = [
    { href: "/work", label: "Open leads", value: tiles.open, note: "Still in the work queue" },
    { href: "/work?focus=priority", label: "Open priority leads", value: tiles.priority, note: "Contract out, flagged, or suggested" },
    { href: "/work?focus=desired", label: "Open desired cases", value: tiles.desired, note: "Desired and still open" },
    { href: "/work?focus=contact", label: "Leads that need contacted", value: tiles.contact, note: "Call sequence, not called yet" },
  ];

  const answerRates = rates.filter((rate) => ANSWER_LABELS.has(rate.label));
  const otherRates = rates.filter((rate) => !ANSWER_LABELS.has(rate.label));

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-3 xl:px-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-tight text-navy">Intake</h1>
          <p className="text-xs text-slate-600">{period.label}</p>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {PERIODS.map((item) => (
          <Link
            key={item.id}
            href={periodHref(item.id)}
            title={item.hint}
            className={`rounded-full px-3 py-1 text-sm ${
              period.id === item.id ? "bg-navy text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
            }`}
          >
            {item.label}
          </Link>
        ))}
        <form action="/" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="period" value="custom" />
          <input
            type="date"
            name="from"
            defaultValue={period.start}
            aria-label="From"
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
          />
          <span className="text-sm text-slate-500">to</span>
          <input
            type="date"
            name="to"
            defaultValue={period.end}
            aria-label="To"
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
          />
          <button
            type="submit"
            className={`rounded-full px-3 py-1 text-sm ${
              period.id === "custom" ? "bg-navy text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
            }`}
          >
            Apply
          </button>
        </form>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-3 lg:grid-cols-6">
        {counts.map((count) => (
          <div key={count.label} className="bg-white px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{count.label}</p>
              <Tip text={count.definition} />
            </div>
            <p className="mt-0.5 text-xl font-semibold tabular-nums text-navy">{count.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {tilesView.map((tile) => (
          <Link
            key={tile.href}
            href={tile.href}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm transition hover:border-navy"
          >
            <p className="text-2xl font-semibold tabular-nums tracking-tight text-navy">{tile.value}</p>
            <p className="text-xs font-medium text-slate-900">{tile.label}</p>
            <p className="text-[11px] text-slate-500">{tile.note}</p>
          </Link>
        ))}
      </div>

      <section className="mt-3">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Performance</h2>
          <Tip text="Rates follow leads that arrived in this period. Answer rate uses the call lines. Speed to lead uses each lead's first contact." />
        </div>
        <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {answerRates.length ? <AnswerRates rates={answerRates} /> : null}
          {otherRates.map((rate) => {
            const href = rate.label === "<2 Minute Contact: Missed Calls & Form Fills" ? speedHref(period) : null;
            return (
              <article key={rate.label} className={`rounded-lg border border-slate-200 border-l-4 bg-white px-3 py-2 ${TONE[rate.tone]}`}>
                <div className="flex items-start gap-2">
                  {href ? (
                    <Link href={href} className="min-w-0 flex-1 rounded-md hover:text-navy">
                      <RateBody rate={rate} linked />
                    </Link>
                  ) : (
                    <div className="min-w-0 flex-1">
                      <RateBody rate={rate} />
                    </div>
                  )}
                  <Tip text={rate.definition} />
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}

const ANSWER_LABELS = new Set(["Total answer rate", "Leads answer rate"]);

function AnswerRates({ rates }: { rates: RateMetric[] }) {
  const tone = rates.some((rate) => rate.tone === "short")
    ? "short"
    : rates.some((rate) => rate.tone === "empty")
      ? "empty"
      : rates.some((rate) => rate.tone === "open")
        ? "open"
        : "met";
  return (
    <article className={`rounded-lg border border-slate-200 border-l-4 bg-white px-3 py-2 ${TONE[tone]}`}>
      <div className="grid grid-cols-2 gap-3">
        {rates.map((rate) => (
          <div key={rate.label} className="min-w-0">
            <div className="flex items-start gap-1">
              <h3 className="text-xs font-medium leading-4 text-slate-800">{rate.label}</h3>
              <Tip text={rate.definition} />
            </div>
            <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-navy">{rate.display}</p>
            <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">{rate.goal}</p>
            <p className={`mt-1 line-clamp-2 text-[11px] leading-4 ${TONE_TEXT[rate.tone]}`}>{rate.detail}</p>
          </div>
        ))}
      </div>
    </article>
  );
}

function RateBody({ rate, linked }: { rate: RateMetric; linked?: boolean }) {
  return (
    <>
      <h3 className="text-xs font-medium leading-4 text-slate-800">{rate.label}</h3>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-navy">{rate.display}</p>
      <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">{rate.goal}</p>
      <p className={`mt-1 line-clamp-2 text-[11px] leading-4 ${TONE_TEXT[rate.tone]}`}>
        {rate.detail}
        {linked ? " · Open the log" : ""}
      </p>
    </>
  );
}

function speedHref(period: ResolvedPeriod): string {
  const params = new URLSearchParams({ period: period.id });
  if (period.id === "custom") {
    params.set("from", period.start);
    params.set("to", period.end);
  }
  return `/speed?${params}`;
}

function periodHref(id: PeriodId): string {
  if (id === "l7" || id === "custom") return "/";
  return `/?period=${id}`;
}

function Tip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex shrink-0">
      <button
        type="button"
        aria-label={text}
        className="inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded-full border border-slate-300 text-[10px] leading-none font-semibold text-slate-500 hover:border-navy hover:text-navy"
      >
        i
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute top-full right-0 z-20 mt-2 hidden w-64 rounded-md bg-navy px-3 py-2 text-left text-xs leading-5 font-normal tracking-normal text-white normal-case shadow-lg group-hover:block group-focus-within:block"
      >
        {text}
      </span>
    </span>
  );
}
