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

const ENVS: { service: string; name: string; why: string }[] = [
  {
    service: "Intake Manager",
    name: "NEXT_PUBLIC_SUPABASE_URL",
    why: "Same Docket Flow Supabase project. Required to sign in and read leads.",
  },
  {
    service: "Intake Manager",
    name: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    why: "Public key for the signed-in staff session.",
  },
  {
    service: "Intake Manager",
    name: "SUPABASE_SERVICE_ROLE_KEY",
    why: "Server only. Slack capture and the queue runner write leads with this.",
  },
  {
    service: "Intake Manager",
    name: "NEXT_PUBLIC_SITE_URL",
    why: "Origin for Google sign-in. Local is http://localhost:3002. Add that origin plus /auth/callback in Supabase redirect URLs.",
  },
  {
    service: "Intake Manager",
    name: "NEXT_PUBLIC_DOCKET_URL",
    why: "Where the signed-lead promote link goes. Production is https://rjl-docket-flow.vercel.app.",
  },
  {
    service: "Intake Manager",
    name: "SLACK_BOT_TOKEN",
    why: "Posts due calls and scheduled notes into #lead-calls.",
  },
  {
    service: "Intake Manager",
    name: "SLACK_SIGNING_SECRET",
    why: "Verifies the Slack events request at /api/slack/events.",
  },
  {
    service: "Intake Manager",
    name: "SLACK_APP_ID",
    why: "Lets this app ignore its own Slack posts.",
  },
  {
    service: "Intake Manager",
    name: "SLACK_LEAD_CHANNEL_ID",
    why: "The leads channel. Use C026G89PPSS.",
  },
  {
    service: "Intake Manager",
    name: "CRON_SECRET",
    why: "Bearer token for /api/cron/queues.",
  },
  {
    service: "Intake Manager",
    name: "CALLRAIL_API_KEY",
    why: "Optional. Writes the lead’s tags back onto the CallRail call.",
  },
  {
    service: "Intake Manager",
    name: "CALLRAIL_ACCOUNT_ID",
    why: "Optional. The CallRail account those tags belong to.",
  },
  {
    service: "Intake Manager",
    name: "TEXT_SENDING",
    why: "Leave off. SMS Follow-Up sends the texts. Set live only if that service is no longer texting the same people.",
  },
  {
    service: "Intake Manager",
    name: "QUO_API_KEY",
    why: "Only if TEXT_SENDING is live.",
  },
  {
    service: "Intake Manager",
    name: "QUO_FROM_NUMBER",
    why: "Only if TEXT_SENDING is live. The Quo number the text is sent from.",
  },
  {
    service: "Quo Router",
    name: "QUO_API_KEY",
    why: "Reads calls and summaries. For this firm it can be FIRM_RAMOSJAMES_QUO_API_KEY.",
  },
  {
    service: "Quo Router",
    name: "SLACK_BOT_TOKEN",
    why: "Posts into the lead channel. Per-firm prefix is allowed, same as the other Quo Router secrets.",
  },
  {
    service: "Quo Router",
    name: "SLACK_LEAD_CALLS_CHANNEL_ID",
    why: "Channel id for #lead-calls.",
  },
  {
    service: "Quo Router",
    name: "SLACK_LEAD_CALLS_WEBHOOK_URL",
    why: "Incoming webhook for the lead post.",
  },
  {
    service: "Quo Router",
    name: "SLACK_MISSED_CALLS_WEBHOOK_URL",
    why: "Incoming webhook for missed calls.",
  },
  {
    service: "Quo Router",
    name: "SLACK_HUMAN_CALLS_WEBHOOK_URL",
    why: "Incoming webhook for human-answered calls.",
  },
  {
    service: "Quo Router",
    name: "SLACK_SONA_CALLS_WEBHOOK_URL",
    why: "Incoming webhook for Sona calls.",
  },
  {
    service: "Quo Router",
    name: "SLACK_TEXT_MESSAGES_WEBHOOK_URL",
    why: "Incoming webhook for text messages.",
  },
  {
    service: "Quo Router",
    name: "SLACK_LEGAL_ASSISTANT_WEBHOOK_URL",
    why: "Incoming webhook for the legal-assistant phone channel.",
  },
  {
    service: "Quo Router",
    name: "SLACK_LEGAL_ASSISTANT_CHANNEL_ID",
    why: "Channel id for that legal-assistant phone channel.",
  },
  {
    service: "Quo Router",
    name: "CASE_DB_URL",
    why: "Supabase Postgres connection for Docket. This is what writes the lead grade, sentiment, and intake. Same database as LEADS_DATABASE_URL.",
  },
  {
    service: "Quo Router",
    name: "ANTHROPIC_API_KEY or OPENAI_API_KEY",
    why: "One of these. Scores the call and extracts the intake. Set OPENAI_MODEL or ANTHROPIC_MODEL only to override the default.",
  },
  {
    service: "SMS Follow-Up",
    name: "DATABASE_URL",
    why: "Its own Railway Postgres. Not the Docket database.",
  },
  {
    service: "SMS Follow-Up",
    name: "LEADS_DATABASE_URL",
    why: "Docket Postgres connection, same value as Quo Router’s CASE_DB_URL. Without it, texts do not read the lead decision.",
  },
  {
    service: "SMS Follow-Up",
    name: "QUO_API_KEY",
    why: "Sends the texts.",
  },
  {
    service: "SMS Follow-Up",
    name: "QUO_WEBHOOK_SECRET",
    why: "Verifies Quo call and message webhooks. A comma-separated list is allowed.",
  },
  {
    service: "SMS Follow-Up",
    name: "SLACK_BOT_TOKEN",
    why: "Reads #lead-calls and posts the follow-up card.",
  },
  {
    service: "SMS Follow-Up",
    name: "SLACK_SIGNING_SECRET",
    why: "Verifies Slack events.",
  },
  {
    service: "SMS Follow-Up",
    name: "SLACK_APP_ID",
    why: "Optional. Skips the app’s own posts.",
  },
  {
    service: "SMS Follow-Up",
    name: "OPENAI_API_KEY or ANTHROPIC_API_KEY",
    why: "Chooses the text track. LEAD_LLM_PROVIDER picks which one when both are set.",
  },
  {
    service: "SMS Follow-Up",
    name: "GOOGLE_CLIENT_ID",
    why: "Dashboard sign-in.",
  },
  {
    service: "SMS Follow-Up",
    name: "GOOGLE_CLIENT_SECRET",
    why: "Dashboard sign-in.",
  },
  {
    service: "SMS Follow-Up",
    name: "PUBLIC_URL",
    why: "The deployed origin, used for the Google redirect.",
  },
  {
    service: "SMS Follow-Up",
    name: "BOOTSTRAP_ADMIN_EMAIL",
    why: "Work Google address allowed into the dashboard on boot.",
  },
  {
    service: "Sign Flow",
    name: "SIGNFLOW_INTAKE_TOKEN",
    why: "Shared bearer token. The same value goes in Intake Engine and Site-chat.",
  },
  {
    service: "Sign Flow",
    name: "DOCUSEAL_API_URL",
    why: "DocuSeal host that creates the contract.",
  },
  {
    service: "Sign Flow",
    name: "DOCUSEAL_API_KEY",
    why: "DocuSeal API key.",
  },
  {
    service: "Sign Flow",
    name: "DOCUSEAL_WEBHOOK_SECRET",
    why: "Verifies DocuSeal signing events.",
  },
  {
    service: "Sign Flow",
    name: "QUO_API_KEY",
    why: "Sends signing reminders by text.",
  },
  {
    service: "Sign Flow",
    name: "QUO_FROM_NUMBER",
    why: "Quo number those reminders come from. QUO_PHONE_NUMBER_ID can be used instead.",
  },
  {
    service: "Sign Flow",
    name: "SLACK_BOT_TOKEN",
    why: "Sends a contract from Slack.",
  },
  {
    service: "Sign Flow",
    name: "SLACK_SIGNING_SECRET",
    why: "Verifies the Slack request.",
  },
  {
    service: "Sign Flow",
    name: "CRON_SECRET",
    why: "Protects the reminder cron.",
  },
  {
    service: "Intake Engine",
    name: "DATABASE_URL",
    why: "Its own Railway Postgres for the website journey.",
  },
  {
    service: "Intake Engine",
    name: "AUTH_SECRET",
    why: "Signs the admin session.",
  },
  {
    service: "Intake Engine",
    name: "GOOGLE_CLIENT_ID",
    why: "Admin sign-in. GOOGLE_CLIENT_SECRET is the pair.",
  },
  {
    service: "Intake Engine",
    name: "SIGNFLOW_BASE_URL",
    why: "Sign Flow origin used when the visitor reaches a contract step.",
  },
  {
    service: "Intake Engine",
    name: "SIGNFLOW_INTAKE_TOKEN",
    why: "Must match Sign Flow’s SIGNFLOW_INTAKE_TOKEN.",
  },
  {
    service: "Site-chat",
    name: "DATABASE_URL",
    why: "Its own Railway Postgres for the chat widget.",
  },
  {
    service: "Site-chat",
    name: "NEXT_PUBLIC_APP_URL",
    why: "Public origin of the widget.",
  },
  {
    service: "Site-chat",
    name: "NEXTAUTH_URL",
    why: "Admin origin. NEXTAUTH_SECRET signs the session.",
  },
  {
    service: "Site-chat",
    name: "GOOGLE_CLIENT_ID",
    why: "Admin sign-in. GOOGLE_CLIENT_SECRET is the pair.",
  },
  {
    service: "Site-chat",
    name: "SIGNFLOW_BASE_URL",
    why: "Sign Flow origin for a contract started from chat.",
  },
  {
    service: "Site-chat",
    name: "SIGNFLOW_INTAKE_TOKEN",
    why: "Must match Sign Flow’s SIGNFLOW_INTAKE_TOKEN.",
  },
  {
    service: "Docket Flow",
    name: "NEXT_PUBLIC_SUPABASE_URL",
    why: "Same Supabase project as Intake Manager.",
  },
  {
    service: "Docket Flow",
    name: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    why: "Staff session.",
  },
  {
    service: "Docket Flow",
    name: "SUPABASE_SERVICE_ROLE_KEY",
    why: "Server writes for intakes and cases.",
  },
  {
    service: "Docket Flow",
    name: "NEXT_PUBLIC_SITE_URL",
    why: "Docket’s own origin, not Intake Manager’s.",
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

      <h2 className="mt-10 text-lg font-semibold tracking-tight">Environment</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        These are the variables the lead path needs. Quo Router accepts the same names with a
        FIRM_RAMOSJAMES_ prefix. Intake Engine and Site-chat keep CallRail, and Site-chat keeps its
        Slack webhook, in each app’s settings rather than in the environment. Sign Flow also needs
        its Firebase and Gmail variables to send mail; those are on that service’s own env example.
      </p>
      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Service</th>
              <th className="px-3 py-2 font-medium">Variable</th>
              <th className="px-3 py-2 font-medium">What it is for</th>
            </tr>
          </thead>
          <tbody>
            {ENVS.map((row) => (
              <tr key={`${row.service}-${row.name}`} className="border-b border-slate-100 align-top last:border-0">
                <td className="px-3 py-3 text-slate-500">{row.service}</td>
                <td className="px-3 py-3 font-mono text-xs text-slate-900">{row.name}</td>
                <td className="px-3 py-3 text-slate-700">{row.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
