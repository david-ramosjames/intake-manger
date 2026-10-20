import Link from "next/link";
import { consultationWhen, desiredWord, milestoneDesired, milestoneQualified } from "@/lib/desired";
import { priorityReasonText, daysSince, leadTitle, listAccident, slackMessageUrl, type Lead } from "@/lib/leads";
import { nextActionLines, type CallStep } from "@/lib/next-action";
import { reviewPrioritySuggestion } from "@/lib/ops-actions";
import { sequenceDayOne } from "@/lib/followup";
import { leadSequenceId } from "@/lib/sequences";
import { leadCycle, openLeadAction, outreachSequence, PRIORITY_PLACE_LABEL, priorityPlace, type PriorityPlace } from "@/lib/next-step";
import { phoneTail } from "@/lib/phone";
import { requireStaff } from "@/lib/session";
import { formatCallWhen } from "@/lib/time";

const COLUMNS =
  "id, lead_name, phone, grade, kind, sequence, follow_up, arrival, source_channel, lead_date, created_at, case_type, case_detail, lead_status, signed_case, case_id, close_reason, consultation_date, desired_case, desired_source, qualified, callrail_tags, agreement_status, agreement_sent_at, agreement_next_reminder_at, agreement_reminder_count, agreement_via_sms, agreement_via_email, priority, priority_reason, priority_suggestion, last_action, next_action, text_sequence_status, text_next_at, quo_link, slack_permalink, slack_channel_id, slack_message_ts, slack_thread_ts";

type PriorityLead = Pick<
  Lead,
  | "id"
  | "lead_name"
  | "phone"
  | "grade"
  | "kind"
  | "sequence"
  | "follow_up"
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
  | "consultation_date"
  | "desired_case"
  | "desired_source"
  | "qualified"
  | "callrail_tags"
  | "agreement_status"
  | "agreement_sent_at"
  | "agreement_next_reminder_at"
  | "agreement_reminder_count"
  | "agreement_via_sms"
  | "agreement_via_email"
  | "priority"
  | "priority_reason"
  | "priority_suggestion"
  | "last_action"
  | "next_action"
  | "text_sequence_status"
  | "text_next_at"
  | "quo_link"
  | "slack_permalink"
  | "slack_channel_id"
  | "slack_message_ts"
  | "slack_thread_ts"
>;

type Touch = {
  id: string;
  lead_id: string | null;
  phone: string | null;
  phone_e164: string | null;
  type: string | null;
  direction: string | null;
  occurred_at: string | null;
  content: string | null;
};

function phoneKey(value: string | null | undefined): string {
  const tail = phoneTail(value);
  return tail.length >= 10 ? tail : "";
}

function touchKind(touch: Touch): string {
  return String(touch.type || "").toLowerCase();
}

function isCallTouch(touch: Touch): boolean {
  const type = touchKind(touch);
  return type === "call" || type === "sona_call" || type === "missed_call" || type === "voicemail";
}

function spokeOnCall(touch: Touch): boolean {
  return Boolean((touch.content || "").replace(/\s+/g, " ").trim());
}

/** A second log of the same call arrives a few seconds later with no summary. */
function sameCall(left: Touch, right: Touch): boolean {
  if (!isCallTouch(left) || !isCallTouch(right)) return false;
  if ((left.direction || "").toLowerCase() !== (right.direction || "").toLowerCase()) return false;
  const a = Date.parse(left.occurred_at || "");
  const b = Date.parse(right.occurred_at || "");
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return Math.abs(a - b) < 2 * 60 * 1000;
}

function distinctTouches(list: Touch[]): Touch[] {
  const ordered = [...list].sort((a, b) => (a.occurred_at || "").localeCompare(b.occurred_at || ""));
  const kept: Touch[] = [];
  for (const touch of ordered) {
    const previous = kept[kept.length - 1];
    if (previous && sameCall(previous, touch)) {
      if (spokeOnCall(touch) && !spokeOnCall(previous)) kept[kept.length - 1] = touch;
      continue;
    }
    kept.push(touch);
  }
  return kept;
}

function actionLabel(touch: Touch): string {
  const type = touchKind(touch);
  const direction = (touch.direction || "").toLowerCase();
  if (type === "missed_call" || type === "voicemail") return "Missed call";
  if (type === "text" || type === "email") return direction === "inbound" ? "Text received" : "Text sent";
  if (direction === "outbound" && !spokeOnCall(touch)) return "Call tried";
  return "Call completed";
}

function actionText(touch: Touch | undefined): string {
  if (!touch?.occurred_at) return "No contact yet.";
  return `${actionLabel(touch)} · ${formatCallWhen(touch.occurred_at)}`;
}

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
  const [{ data, error }, { data: stepRows }] = await Promise.all([
    supabase
      .from("leads")
      .select(COLUMNS)
      .not("lead_status", "in", "(Lost,Referred)")
      .eq("signed_case", false)
      .or("and(case_id.is.null,lead_status.not.in.(Promoted,Signed)),agreement_status.in.(sent,viewed,signed,completed)")
      .order("lead_date", { ascending: false, nullsFirst: false })
      .limit(300),
    supabase.from("sequence_steps").select("sequence, position, delay_minutes, callback_window").eq("queue", "call").order("position"),
  ]);
  const callSteps = (stepRows ?? []) as (CallStep & { sequence: string })[];

  const leads = (data ?? []) as PriorityLead[];
  const placed = leads.filter((lead) => priorityPlace(lead));
  const phones = [...new Set(placed.map((lead) => lead.phone).filter((phone): phone is string => Boolean(phone)))];
  const signedSiblings = phones.length
    ? await supabase.from("leads").select("phone, phone_e164").eq("signed_case", true).in("phone", phones)
    : { data: [] };
  const signedPhones = new Set<string>();
  for (const row of signedSiblings.data ?? []) {
    const key = phoneKey(row.phone) || phoneKey(row.phone_e164);
    if (key) signedPhones.add(key);
  }
  const candidates = placed.filter((lead) => !signedPhones.has(phoneKey(lead.phone)));
  const ids = candidates.map((lead) => lead.id);
  const idSet = new Set(ids);
  const idsByPhone = new Map<string, string[]>();
  for (const lead of candidates) {
    const key = phoneKey(lead.phone);
    if (!key) continue;
    const list = idsByPhone.get(key) ?? [];
    list.push(lead.id);
    idsByPhone.set(key, list);
  }
  const tails = [...idsByPhone.keys()];
  const [linked, byPhone] = await Promise.all([loadTouches(supabase, ids), loadTouchesByPhone(supabase, tails)]);
  const seen = new Set<string>();
  const touches: Touch[] = [];
  for (const touch of [...linked, ...byPhone]) {
    if (seen.has(touch.id)) continue;
    seen.add(touch.id);
    touches.push(touch);
  }
  const byLead = new Map<string, Touch[]>();
  for (const touch of touches) {
    const owners = new Set<string>();
    if (touch.lead_id && idSet.has(touch.lead_id)) owners.add(touch.lead_id);
    const key = phoneKey(touch.phone) || phoneKey(touch.phone_e164);
    for (const id of idsByPhone.get(key) ?? []) owners.add(id);
    for (const leadId of owners) {
      const list = byLead.get(leadId) ?? [];
      list.push(touch);
      byLead.set(leadId, list);
    }
  }
  const talked = new Set<string>();
  const calls = new Map<string, number>();
  const lastOutreach = new Map<string, string>();
  const lastTouch = new Map<string, Touch>();
  for (const [leadId, list] of byLead) {
    const unique = distinctTouches(list);
    calls.set(leadId, unique.filter((touch) => isCallTouch(touch)).length);
    for (const touch of unique) {
      const type = touchKind(touch);
      const direction = (touch.direction || "").toLowerCase();
      if (type === "call" || type === "sona_call" || (direction === "inbound" && (type === "text" || type === "email"))) {
        talked.add(leadId);
      }
      if (touch.occurred_at && countsAsContact(type)) {
        const current = lastOutreach.get(leadId);
        if (!current || touch.occurred_at > current) {
          lastOutreach.set(leadId, touch.occurred_at);
          lastTouch.set(leadId, touch);
        }
      }
    }
  }

  const jobsResult = ids.length
    ? await supabase.from("lead_jobs").select("lead_id, due_at").in("lead_id", ids).eq("queue", "call").eq("status", "pending")
    : { data: [] };
  const nextCall = new Map<string, string>();
  const now = Date.now();
  for (const job of jobsResult.data ?? []) {
    if (!job.lead_id || !job.due_at || new Date(job.due_at).getTime() <= now) continue;
    const current = nextCall.get(job.lead_id);
    if (!current || job.due_at < current) nextCall.set(job.lead_id, job.due_at);
  }

  const grouped = new Map<PriorityPlace, { lead: PriorityLead; calls: number; last: string; actionNote: string; wait: number; sequence: ReturnType<typeof outreachSequence>; action: string | null; nextAction: ReturnType<typeof nextActionLines> }[]>();
  for (const place of ["contract", "flagged", "suggested"] as const) grouped.set(place, []);
  for (const lead of candidates) {
    const connected = talked.has(lead.id);
    const cycle = leadCycle(lead, connected ? [{ type: "call", direction: "inbound" }] : []);
    const bucket = priorityPlace(lead);
    if (!bucket) continue;
    const wait = daysSince(lastOutreach.get(lead.id));
    grouped.get(bucket)?.push({
      lead,
      calls: calls.get(lead.id) ?? 0,
      last: lastContacted(wait),
      actionNote: actionText(lastTouch.get(lead.id)),
      wait: wait ?? 99,
      sequence: outreachSequence(lead),
      action: openLeadAction(lead, cycle, calls.get(lead.id) ?? 0),
      nextAction: nextActionLines({
        closed: false,
        sequence: lead.sequence,
        textStatus: lead.text_sequence_status,
        textNextAt: lead.text_next_at,
        reminderAt: lead.agreement_next_reminder_at,
        agreementStatus: lead.agreement_status,
        callStart: (() => {
          const sequence = leadSequenceId({
            closed: false,
            talked: cycle !== "contact",
            kind: lead.kind,
            agreementStatus: lead.agreement_status,
            agreementSentAt: lead.agreement_sent_at,
            signedCase: lead.signed_case,
          });
          return sequence ? sequenceDayOne(sequence, lead).toISOString() : lead.created_at;
        })(),
        callsMade: calls.get(lead.id) ?? 0,
        pendingCallAt: nextCall.get(lead.id) ?? null,
        callSteps: callSteps.filter((step) => step.sequence === leadSequenceId({
          closed: false,
          talked: cycle !== "contact",
          kind: lead.kind,
          agreementStatus: lead.agreement_status,
          agreementSentAt: lead.agreement_sent_at,
          signedCase: lead.signed_case,
        })),
        priority: Boolean(lead.priority) || ["sent", "viewed", "signed", "completed"].includes((lead.agreement_status || "").toLowerCase()) || Boolean(lead.agreement_sent_at),
        contactAt: lead.created_at,
        leadId: lead.id,
      }),
    });
  }
  for (const rows of grouped.values()) {
    rows.sort((a, b) => b.wait - a.wait || gradeRank(a.lead.grade) - gradeRank(b.lead.grade));
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-navy">Priority</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            A lead is priority when a contract is out and unsigned, someone flags it, or Quo recommends it and a person confirms.
            A sent contract stays here until the lead is signed or closed. Every row shows the next action.
          </p>
        </div>
        <Link href="/work" className="text-sm font-medium text-slate-900 underline">
          Work queue
        </Link>
      </div>
      {error ? <p className="mt-4 text-sm text-red-700">{error.message}</p> : null}

      <div className="mt-6 space-y-8">
        {(["contract", "flagged", "suggested"] as const).map((reason) => {
          const rows = grouped.get(reason) ?? [];
          return (
            <section key={reason}>
              <h2 className="text-sm font-semibold text-slate-900">
                {PRIORITY_PLACE_LABEL[reason]}
                <span className="ml-2 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-accent px-1.5 py-0.5 text-xs font-semibold leading-none text-white">
                  {rows.length}
                </span>
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
                        <th className="px-4 py-3 font-medium">Auto sequence</th>
                        <th className="px-4 py-3 font-medium">Last contacted</th>
                        <th className="px-4 py-3 font-medium">Last action</th>
                        <th className="px-4 py-3 font-medium">Next action</th>
                        {reason === "suggested" ? <th className="px-4 py-3 font-medium">Priority list</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const slack = slackMessageUrl(row.lead);
                        return (
                          <tr key={row.lead.id} className="border-b border-slate-100 last:border-0">
                            <td className="px-4 py-3">
                              <Link href={`/leads/${row.lead.id}`} className="font-medium text-navy hover:underline">
                                {leadTitle(row.lead)}
                              </Link>
                              <p className="mt-0.5 text-xs text-slate-500">
                                {listAccident(row.lead) !== "—" ? listAccident(row.lead) : "Accident not captured"}
                                {row.lead.phone ? ` · ${row.lead.phone}` : ""}
                                {` · Consult ${consultationWhen(row.lead.consultation_date)}`}
                                {` · Qualified ${desiredWord(milestoneQualified(row.lead))}`}
                                {` · Desired ${desiredWord(milestoneDesired(row.lead))}`}
                                {` · Signed ${row.lead.signed_case ? "Yes" : "—"}`}
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
                            <td className={`px-4 py-3 ${row.sequence.on ? "font-medium text-slate-900" : "text-slate-500"}`}>
                              {row.sequence.label}
                            </td>
                            <td className="px-4 py-3 text-slate-700">{row.last}</td>
                            <td className="max-w-xs px-4 py-3 text-slate-700">{row.actionNote}</td>
                            <td className="px-4 py-3 text-slate-800">
                              <p className="font-medium text-slate-900">{row.action ?? "Choose the next step"}</p>
                              {priorityReasonText(row.lead.priority_reason) && reason === "flagged" ? (
                                <p className="text-xs text-slate-500">{priorityReasonText(row.lead.priority_reason)}</p>
                              ) : null}
                              {row.lead.priority_suggestion && reason === "suggested" ? (
                                <p className="text-xs text-slate-500">{row.lead.priority_suggestion}</p>
                              ) : null}
                              {row.nextAction
                                .filter((line) => line.when !== "None")
                                .map((line) => (
                                  <p key={line.label} className="whitespace-nowrap text-slate-600">
                                    <span className="text-slate-500">{line.label}</span> {line.when}
                                  </p>
                                ))}
                            </td>
                            {reason === "suggested" ? (
                              <td className="px-4 py-3">
                                <form action={reviewPrioritySuggestion} className="flex flex-col items-start gap-2">
                                  <input type="hidden" name="lead_id" value={row.lead.id} />
                                  <button name="decision" value="confirm" className="whitespace-nowrap rounded-md bg-navy px-2.5 py-1 text-xs font-medium text-white">
                                    Add to priority
                                  </button>
                                  <button name="decision" value="dismiss" className="whitespace-nowrap rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs">
                                    Not a priority
                                  </button>
                                </form>
                              </td>
                            ) : null}
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

function groupDetail(reason: PriorityPlace): string {
  if (reason === "contract") return "The contract has been sent and it is not signed. It stays here until the lead is signed or closed.";
  if (reason === "flagged") return "Someone marked this lead. Promising web forms and high-quality referrals belong here.";
  return "Quo recommended this lead. Add it to the priority list, or leave it off.";
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
      .select("id, lead_id, phone, phone_e164, type, direction, occurred_at, content")
      .in("lead_id", ids)
      .order("occurred_at", { ascending: false })
      .range(from, from + page - 1);
    const batch = (data ?? []) as Touch[];
    rows.push(...batch);
    if (batch.length < page) break;
  }
  return rows;
}

async function loadTouchesByPhone(
  supabase: Awaited<ReturnType<typeof requireStaff>>["supabase"],
  phones: string[],
): Promise<Touch[]> {
  if (!phones.length) return [];
  const [byDigits, byE164] = await Promise.all([
    loadTouchPage(supabase, "phone", phones),
    loadTouchPage(supabase, "phone_e164", phones.map((phone) => `+1${phone}`)),
  ]);
  return [...byDigits, ...byE164];
}

async function loadTouchPage(
  supabase: Awaited<ReturnType<typeof requireStaff>>["supabase"],
  column: "phone" | "phone_e164",
  values: string[],
): Promise<Touch[]> {
  const rows: Touch[] = [];
  const page = 1000;
  for (let from = 0; from < 20000; from += page) {
    const { data } = await supabase
      .from("intake_interactions")
      .select("id, lead_id, phone, phone_e164, type, direction, occurred_at, content")
      .in(column, values)
      .order("occurred_at", { ascending: false })
      .range(from, from + page - 1);
    const batch = (data ?? []) as Touch[];
    rows.push(...batch);
    if (batch.length < page) break;
  }
  return rows;
}
