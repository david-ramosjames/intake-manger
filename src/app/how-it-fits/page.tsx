import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "How it fits · Intake",
  description: "Which service owns each part of Ramos James Law intake",
};

const ROWS: { capability: string; owner: string; here: string }[] = [
  {
    capability: "Automated lead capture",
    owner: "Intake Engine, Site-chat, the CallRail Slack app, and Quo Router all post into #lead-calls.",
    here: "Intake Manager saves a lead from that channel when the Slack app is connected. Qualified call intakes already in Docket are imported. The website and chat apps still keep their own databases.",
  },
  {
    capability: "AI intake extraction",
    owner: "Quo Router reads the call summary and fills the Docket intake for a qualified personal-injury call.",
    here: "Intake Manager links to that intake. It does not extract the call.",
  },
  {
    capability: "AI lead summaries",
    owner: "Quo Router writes the call summary onto the Slack post and the intake.",
    here: "That summary is stored on the lead. Anyone can correct it, and the correction is kept.",
  },
  {
    capability: "Automated SMS follow-up",
    owner: "SMS Follow-Up sends the text sequence. It reads the lead decision before it starts, and skips a lead that needs more info, is signed, or has follow-up turned off.",
    here: "The decision is follow-up on or off, and the kind of lead. This app's own text queue stays off so it does not send a second copy.",
  },
  {
    capability: "Contract sending and follow-up",
    owner: "Sign Flow sends the contract and the signing reminders. SMS Follow-Up stops when Slack says the contract was sent.",
    here: "Signed on the lead means the client signed. Promote in Docket is a later step and does not happen on its own.",
  },
  {
    capability: "Centralized lead pipeline",
    owner: "The lead row lives in the same Supabase database as Docket. Slack is the notification, not the database.",
    here: "This screen is where the team sees and corrects that row.",
  },
  {
    capability: "Human call queue",
    owner: "A person dials. The outbound caller is a separate service and is not placing these calls.",
    here: "The call sequence creates the due calls and posts them to the lead’s Slack thread.",
  },
  {
    capability: "Intake tasks and accountability",
    owner: "The team works from the Slack thread.",
    here: "You can schedule a Slack note on a lead, and @mention the person who should handle it.",
  },
  {
    capability: "Lead ownership and activity history",
    owner: "Quo Router writes who handled a call on the Slack post.",
    here: "Handled by is on the lead. History keeps edits, confirmation, grade changes, referrals, and later Slack posts.",
  },
  {
    capability: "AI lead viability scoring",
    owner: "Quo Router scores A, B, or C from the call and revises it when a later call adds facts.",
    here: "The grade is the decision on the lead. A person can correct it, and that correction holds until the next call.",
  },
  {
    capability: "AI sentiment analysis",
    owner: "Quo Router scores the lead positive, neutral, or negative from the same call. Quo reporting still scores clients after they have signed.",
    here: "Sentiment sits next to the grade. A person can correct it the same way.",
  },
  {
    capability: "Referral tracking and follow-up",
    owner: "SMS Follow-Up has a referral text track when the Slack post itself says Referral.",
    here: "The referral tree picks where a case we cannot take should go, posts that to Slack, and stops follow-up.",
  },
  {
    capability: "Marketing attribution and ROI",
    owner: "CallRail holds the call tags. Intake Engine and Site-chat forward form fills to CallRail.",
    here: "Lead source, source type, and CallRail tags are fields on the lead. Tags write back to CallRail when the call id and API key are set. There is no ROI report here.",
  },
  {
    capability: "Intake conversion analytics",
    owner: "The spreadsheet and Docket still hold the historical counts.",
    here: "The list can show want-to-sign, need-more-info, signed, and promoted. A funnel report is not built.",
  },
  {
    capability: "Stage deadlines and escalations",
    owner: "Case Tracker owns the stage after a lead is promoted to a case.",
    here: "Intake Manager does not time out a stage or escalate it.",
  },
];

const QUESTIONS: { q: string; a: string }[] = [
  {
    q: "Who decides, and who does the work?",
    a: "Intake Manager holds the decision: what kind of lead this is, the grade, the sentiment, whether follow-up is on, and whether it was referred or signed. Quo Router, SMS Follow-Up, and Sign Flow keep running on their own and read that decision. They do not each invent a different answer.",
  },
  {
    q: "Did Intake Manager replace the other servers?",
    a: "No. Quo Router, SMS Follow-Up, Sign Flow, Intake Engine, Site-chat, Docket, and Case Tracker each still do their own job. Intake Manager is the lead record the team works from.",
  },
  {
    q: "What are the two kinds of lead?",
    a: "Want to sign covers a form fill, a missed call, or a Sona call: we still need the first real conversation, and the text sequence applies. Need more info means we already spoke and are not ready to decide. That lead gets calls only.",
  },
  {
    q: "Where does a new lead first appear?",
    a: "Calls and form fills are posted in #lead-calls. Quo Router posts qualified and unqualified call summaries. Intake Engine and Site-chat post form fills. The CallRail app posts the call. Intake Manager reads that channel and keeps one lead per open matter.",
  },
  {
    q: "Who sends the texts?",
    a: "SMS Follow-Up sends them. Before it starts a series it reads the lead. A need-more-info lead, a signed lead, or a lead with follow-up turned off is not texted. That check runs when LEADS_DATABASE_URL points at the Docket database. Until then, SMS Follow-Up keeps its current rules.",
  },
  {
    q: "Who places the follow-up calls?",
    a: "A person does. When a call step is due, Intake Manager posts it in the lead’s Slack thread. The outbound caller can take that job later. It is not doing it now.",
  },
  {
    q: "What happens when the client signs?",
    a: "Mark the lead signed. Quo Router should stop adding facts to the intake form. Sign Flow owns any remaining signing reminders. Someone still reviews the intake in Docket and promotes it to a case. Promoting is not automatic, and it is not what closes follow-up. Signed, lost, or referred out closes follow-up.",
  },
  {
    q: "What if we cannot take the case?",
    a: "Use the referral tree on the lead. It matches the case type to a destination, posts the handoff in Slack, and stops texts and calls. The two starting destinations are Texas Lawyer Referral Service and Central Texas Lawyer Referral. Add or change destinations on the Referrals page.",
  },
  {
    q: "Why do Intake Engine and Site-chat have their own databases?",
    a: "Those databases store the website journey and the chat session. They are not the firm’s lead list. Both apps publish into Slack. The lead list is the leads table in the Docket Supabase database.",
  },
];

export default function HowItFitsPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">How the intake services fit</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Each row is a capability the firm needs. The middle column is the service that owns the
        work. The last column is what this app does with it.
      </p>

      <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Capability</th>
              <th className="px-3 py-2 font-medium">Who owns it</th>
              <th className="px-3 py-2 font-medium">In Intake Manager</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.capability} className="border-b border-slate-100 align-top last:border-0">
                <th className="px-3 py-3 font-medium text-slate-900">{row.capability}</th>
                <td className="px-3 py-3 text-slate-700">{row.owner}</td>
                <td className="px-3 py-3 text-slate-700">{row.here}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-10 text-lg font-semibold tracking-tight">Questions</h2>
      <div className="mt-4 space-y-3">
        {QUESTIONS.map((item) => (
          <details key={item.q} className="rounded-lg border border-slate-200 bg-white px-4 py-3" open>
            <summary className="cursor-pointer text-sm font-medium text-slate-900">{item.q}</summary>
            <p className="mt-2 text-sm leading-6 text-slate-700">{item.a}</p>
          </details>
        ))}
      </div>
    </main>
  );
}
