import Link from "next/link";
import {
  daysSince,
  leadTitle,
  listAccident,
  PRIORITY_REASON_LABEL,
  PRIORITY_REASONS,
  slackMessageUrl,
  type Lead,
  type PriorityReason,
} from "@/lib/leads";
import { leadCycle, priorityBucket } from "@/lib/next-step";
import { requireStaff } from "@/lib/session";
import { formatCallWhen } from "@/lib/time";

const COLUMNS =
  "id, lead_name, phone, grade, kind, arrival, source_channel, lead_date, created_at, case_type, case_detail, lead_status, signed_case, case_id, close_reason, agreement_status, agreement_sent_at, priority_reason, last_action, next_action, quo_link, slack_permalink, slack_channel_id, slack_message_ts, slack_thread_ts";

type PriorityLead = Pick<
  Lead,
  | "id"
  | "lead_name"
  | "phone"
  | "grade"
  | "kind"
  | "arrival"
  | "source_channel"
  | "lead_date"
  | "created_at"
  | "case_type"
  | "case_detail"
  | "lead_status"
  | "signed_case"
  | "case_id"
  | "close_reason"
  | "agreement_status"
  | "agreement_sent_at"
  | "priority_reason"
  | "last_action"
  | "next_action"
  | "quo_link"
  | "slack_permalink"
  | "slack_channel_id"
  | "slack_message_ts"
  | "slack_thread_ts"
>;

type Touch = { lead_id: string | null; type: string | null; direction: string | null; occurred_at: string | null };

function lastContacted(days: number | null): string {
  if (days == null) return "Never";
  if (days === 0) return "Today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

function countsAsContact(type: string): boolean {
  return type === "call" || type === "sona_call" || type === "text" || type === "voicemail";
}

export default async function PriorityPage() {
  const { supabase } = await requireStaff();
  const { data, error } = await supabase
    .from("leads")
    .select(COLUMNS)
    .eq("signed_case", false)
    .is("case_id", null)
    .not("lead_status", "in", "(Lost,Referred,Promoted,Signed)")
    .order("lead_date", { ascending: false, nullsFirst: false })
    .limit(500);

  const leads = (data ?? []) as PriorityLead[];
  const candidates = leads.filter(mightBePriority);
  const ids = candidates.map((lead) => lead.id);
  const touches = await loadTouches(supabase, ids);
  const talked = new Set<string>();
  const calls = new Map<string, number>();
  const lastOutreach = new Map<string, string>();
  for (const touch of touches) {
    if (!touch.lead_id) continue;
    const type = String(touch.type || "").toLowerCase();
    const direction = String(touch.direction || "").toLowerCase();
    if (type === "call" || type === "sona_call" || type === "missed_call") {
      calls.set(touch.lead_id, (calls.get(touch.lead_id) ?? 0) + 1);
    }
    if (type === "call" || type === "sona_call" || (direction === "inbound" && (type === "text" || type === "email"))) {
      talked.add(touch.lead_id);
    }
    if (touch.occurred_at && countsAsContact(type)) {
      const current = lastOutreach.get(touch.lead_id);
      if (!current || touch.occurred_at > current) lastOutreach.set(touch.lead_id, touch.occurred_at);
    }
  }

  const jobsResult = ids.length
    ? await supabase.from("lead_jobs").select("lead_id, due_at").in("lead_id", ids).eq("queue", "call").eq("status", "pending")
    : { data: [] };
  const nextCall = new Map<string, string>();
  for (const job of jobsResult.data ?? []) {
    if (!job.lead_id || !job.due_at) continue;
    const current = nextCall.get(job.lead_id);
    if (!current || job.due_at < current) nextCall.set(job.lead_id, job.due_at);
  }

  const grouped = new Map<PriorityReason, { lead: PriorityLead; calls: number; last: string; wait: number; nextCall: string }[]>();
  for (const reason of PRIORITY_REASONS) grouped.set(reason, []);
  for (const lead of candidates) {
    const cycle = leadCycle(lead, talked.has(lead.id) ? [{ type: "call", direction: "inbound" }] : []);
    const bucket = priorityBucket(lead, cycle);
    if (!bucket) continue;
    const wait = daysSince(lastOutreach.get(lead.id));
    grouped.get(bucket)?.push({
      lead,
      calls: calls.get(lead.id) ?? 0,
      last: lastContacted(wait),
      wait: wait ?? 99,
      nextCall: formatCallWhen(nextCall.get(lead.id)),
    });
  }
  for (const rows of grouped.values()) {
    rows.sort((a, b) => b.wait - a.wait || gradeRank(a.lead.grade) - gradeRank(b.lead.grade));
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Priority</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            The highest-priority leads. A contract that went out and is still unsigned, a lead we already
            want to send a contract, and a strong lead we have not finished — including a good web form we
            have not reached, or one that may need a drop letter.
          </p>
        </div>
        <Link href="/" className="text-sm font-medium text-slate-900 underline">
          Work queue
        </Link>
      </div>
      {error ? <p className="mt-4 text-sm text-red-700">{error.message}</p> : null}

      <div className="mt-6 space-y-8">
        {PRIORITY_REASONS.map((reason) => {
          const rows = grouped.get(reason) ?? [];
          return (
            <section key={reason}>
              <h2 className="text-sm font-semibold text-slate-900">
                {PRIORITY_REASON_LABEL[reason]}
                <span className="ml-2 font-normal text-slate-500">{rows.length}</span>
              </h2>
              <p className="mt-1 text-sm text-slate-500">{groupDetail(reason)}</p>
              {rows.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">None right now.</p>
              ) : (
                <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">Lead</th>
                        <th className="px-4 py-3 font-medium">Grade</th>
                        <th className="px-4 py-3 font-medium">Calls</th>
                        <th className="px-4 py-3 font-medium">Last contacted</th>
                        <th className="px-4 py-3 font-medium">Last action</th>
                        <th className="px-4 py-3 font-medium">Next action</th>
                        <th className="px-4 py-3 font-medium">Next call</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const slack = slackMessageUrl(row.lead);
                        return (
                          <tr key={row.lead.id} className="border-b border-slate-100 last:border-0">
                            <td className="px-4 py-3">
                              <Link href={`/leads/${row.lead.id}`} className="font-medium text-slate-900 hover:underline">
                                {leadTitle(row.lead)}
                              </Link>
                              <p className="mt-0.5 text-xs text-slate-500">
                                {listAccident(row.lead) !== "—" ? listAccident(row.lead) : "Accident not captured"}
                                {row.lead.phone ? ` · ${row.lead.phone}` : ""}
                              </p>
                              <p className="mt-1 flex gap-3 text-xs">
                                {row.lead.quo_link ? (
                                  <a href={row.lead.quo_link} className="font-medium text-slate-700 underline" target="_blank" rel="noreferrer">
                                    Quo
                                  </a>
                                ) : null}
                                {slack ? (
                                  <a href={slack} className="font-medium text-slate-700 underline" target="_blank" rel="noreferrer">
                                    Slack
                                  </a>
                                ) : null}
                              </p>
                            </td>
                            <td className="px-4 py-3 font-medium text-slate-800">{row.lead.grade ?? "—"}</td>
                            <td className="px-4 py-3 tabular-nums text-slate-700">{row.calls}</td>
                            <td className="px-4 py-3 text-slate-700">{row.last}</td>
                            <td className="max-w-xs px-4 py-3 text-slate-700">{row.lead.last_action || "No note yet."}</td>
                            <td className="max-w-xs px-4 py-3 text-slate-700">{row.lead.next_action || "No note yet."}</td>
                            <td className="px-4 py-3 text-slate-700">{row.nextCall}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}

function gradeRank(grade: string | null): number {
  if (grade === "A") return 0;
  if (grade === "B") return 1;
  if (grade === "C") return 2;
  return 3;
}

function groupDetail(reason: PriorityReason): string {
  if (reason === "contract_out") return "The contract has been sent and it is not signed yet.";
  if (reason === "send_contract") return "We already know this lead should get a contract.";
  return "A strong lead that is not fully triaged. A good web form we have not reached, or a lead that may need a drop letter.";
}

function mightBePriority(lead: PriorityLead): boolean {
  if (lead.priority_reason) return true;
  const agreement = (lead.agreement_status || "").toLowerCase();
  if (lead.agreement_sent_at || agreement === "sent" || agreement === "viewed" || agreement === "cancelled" || agreement === "expired") {
    return true;
  }
  if (lead.grade === "A" || lead.grade === "B") return true;
  return lead.source_channel === "Web form" && lead.grade !== "C";
}

async function loadTouches(
  supabase: Awaited<ReturnType<typeof requireStaff>>["supabase"],
  ids: string[],
): Promise<Touch[]> {
  if (!ids.length) return [];
  const rows: Touch[] = [];
  const page = 1000;
  for (let from = 0; from < 20000; from += page) {
    const { data } = await supabase
      .from("intake_interactions")
      .select("lead_id, type, direction, occurred_at")
      .in("lead_id", ids)
      .order("occurred_at", { ascending: false })
      .range(from, from + page - 1);
    const batch = (data ?? []) as Touch[];
    rows.push(...batch);
    if (batch.length < page) break;
  }
  return rows;
}
