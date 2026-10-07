function Card({
  title,
  host,
  children,
  tone = "plain",
}: {
  title: string;
  host: string;
  children: string;
  tone?: "plain" | "notice" | "decision";
}) {
  const shell =
    tone === "decision"
      ? "bg-slate-900 text-white"
      : tone === "notice"
        ? "border border-slate-300 bg-slate-50 text-slate-900"
        : "border border-slate-200 bg-white text-slate-900";
  const hostClass = tone === "decision" ? "text-slate-300" : "text-slate-400";
  const bodyClass = tone === "decision" ? "text-slate-200" : "text-slate-600";

  return (
    <div className={`rounded-lg px-3 py-3 ${shell}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className={`shrink-0 text-[10px] font-medium uppercase tracking-wide ${hostClass}`}>{host}</span>
      </div>
      <p className={`mt-1 text-xs leading-5 ${bodyClass}`}>{children}</p>
    </div>
  );
}

function Arrow({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 py-2 text-slate-400">
      <span className="text-[11px] font-medium tracking-wide text-slate-500">{label}</span>
      <svg width="20" height="18" viewBox="0 0 20 18" aria-hidden="true">
        <path d="M10 1v12M4 9l6 7 6-7" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

export function LeadFlow() {
  return (
    <figure className="mt-6" aria-labelledby="lead-flow-title">
      <figcaption id="lead-flow-title" className="text-lg font-semibold tracking-tight text-slate-900">
        How a lead moves
      </figcaption>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Calls and form fills are announced in #lead-calls. Intake Manager and Quo Router write one
        lead row in the Docket database. The other services read that row and keep doing their own
        work.
      </p>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Arrives from</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Card title="Intake Engine" host="Railway">
            Website form fill. Posts into #lead-calls.
          </Card>
          <Card title="Site-chat" host="Railway">
            On-site chat. Posts into #lead-calls.
          </Card>
          <Card title="CallRail" host="CallRail">
            The phone call. The CallRail Slack app posts it into #lead-calls.
          </Card>
          <Card title="Quo Router" host="Railway">
            Sona, missed, and human calls. Posts the summary into #lead-calls.
          </Card>
        </div>

        <Arrow label="Announced in Slack" />

        <Card title="#lead-calls" host="Slack" tone="notice">
          The team sees the call or form fill here. Slack is the announcement. The lead list is the
          database row below.
        </Card>

        <Arrow label="Written onto one lead" />

        <div className="grid gap-2 sm:grid-cols-2">
          <Card title="Intake Manager" host="Vercel">
            Reads the channel and keeps one open lead per matter. The team sets kind, follow-up,
            signed, and referred, and can correct the grade and sentiment.
          </Card>
          <Card title="Quo Router" host="Railway">
            On a call, writes kind, grade, and sentiment on that same lead. A later call can revise
            the scores. A staff correction holds until the next call adds facts.
          </Card>
        </div>

        <Arrow label="The decision" />

        <Card title="Lead row" host="Docket database" tone="decision">
          Kind, grade, sentiment, follow-up, signed, and referred. This is the record SMS Follow-Up,
          Quo Router, and the team read.
        </Card>

        <Arrow label="Each service does its job" />

        <div className="grid gap-2 sm:grid-cols-2">
          <Card title="SMS Follow-Up" host="Railway">
            Sends the text sequence, or skips a lead that needs more info, is signed, or has
            follow-up turned off.
          </Card>
          <Card title="Sign Flow" host="Railway">
            Sends the contract and the signing reminders. Signed means the client signed.
          </Card>
          <Card title="A person" host="Staff">
            Dials when Intake Manager posts a due call in the lead’s Slack thread.
          </Card>
          <Card title="Docket" host="Vercel">
            Staff review the intake and promote it to a case. Case Tracker starts after that.
            Promoting does not close follow-up.
          </Card>
        </div>
      </div>
    </figure>
  );
}
