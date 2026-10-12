"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { callrailConfigured, fetchCallrailTags } from "./callrail";
import { dispatchDue } from "./dispatch";
import { callOutcomeLabel, isCallOutcome } from "./calls";
import { loadStaff, matchStaff } from "./identity";
import { enrollFollowUp, enrollMissingFollowUps, stopFollowUp } from "./followup";
import { isPriorityReason } from "./leads";
import { chicagoLocalToIso } from "./time";
import { requireStaff } from "./session";
import { createSupabaseServiceClient } from "./supabase/service";
import { LEAD_CHANNEL_ID, postToSlack } from "./slack";

function text(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value.length ? value : null;
}

export async function savePriority(leadId: string, formData: FormData) {
  const { supabase, email } = await requireStaff();
  const priority = formData.getAll("priority").includes("yes");
  const reason = text(formData, "priority_reason");
  if (priority && !isPriorityReason(reason)) {
    throw new Error("Choose why this lead is on Jon's list.");
  }
  const { error } = await supabase
    .from("leads")
    .update({
      priority,
      priority_reason: priority ? reason : null,
      last_action: text(formData, "last_action"),
      next_action: text(formData, "next_action"),
    })
    .eq("id", leadId);
  if (error) throw new Error(error.message);
  await supabase.from("lead_events").insert({
    lead_id: leadId,
    event_type: priority ? "priority_set" : "priority_cleared",
    actor: email,
    payload: { reason },
  });
  revalidatePath("/");
  revalidatePath("/priority");
  revalidatePath(`/leads/${leadId}`);
}

export async function confirmLead(leadId: string) {
  const { supabase, email } = await requireStaff();
  const { data: lead, error: loadError } = await supabase
    .from("leads")
    .select("lead_name, phone")
    .eq("id", leadId)
    .maybeSingle();
  if (loadError || !lead) throw new Error(loadError?.message ?? "Lead not found");
  if (!String(lead.lead_name ?? "").trim() || !String(lead.phone ?? "").trim()) {
    throw new Error("Add a name and a phone before confirming this record.");
  }
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("leads")
    .update({ confirmed_at: now, confirmed_by: email, needs_verification: false })
    .eq("id", leadId);
  if (error) throw new Error(error.message);
  await supabase.from("lead_events").insert({
    lead_id: leadId,
    event_type: "confirmed",
    actor: email,
    payload: {},
  });
  revalidatePath("/");
  revalidatePath("/verify");
  revalidatePath(`/leads/${leadId}`);
}

export async function startFollowUp(leadId: string) {
  const { supabase, email } = await requireStaff();
  const { data: lead, error } = await supabase
    .from("leads")
    .select("id, kind, follow_up, lead_name, case_type, signed_case, case_id, lead_status")
    .eq("id", leadId)
    .maybeSingle();
  if (error || !lead) throw new Error(error?.message ?? "Lead not found");
  if (!lead.follow_up) throw new Error("Turn follow-up on and save before starting the steps.");
  await enrollFollowUp(supabase, lead);
  await supabase.from("lead_events").insert({
    lead_id: leadId,
    event_type: "enrolled",
    actor: email,
    payload: {},
  });
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/queues");
}

export async function mergeIntoLead(formData: FormData) {
  const { supabase, email } = await requireStaff();
  const keeperId = text(formData, "keeper_id");
  const duplicateId = text(formData, "duplicate_id");
  if (!keeperId || !duplicateId || keeperId === duplicateId) {
    throw new Error("Choose the lead to keep and the duplicate to close.");
  }
  const { data: rows, error } = await supabase
    .from("leads")
    .select("id, phone_e164, lead_name, email, summary, quo_link, owner_name, lead_status")
    .in("id", [keeperId, duplicateId]);
  if (error) throw new Error(error.message);
  const keeper = rows?.find((row) => row.id === keeperId);
  const duplicate = rows?.find((row) => row.id === duplicateId);
  if (!keeper || !duplicate) throw new Error("One of those leads is missing.");
  if (!keeper.phone_e164 || keeper.phone_e164 !== duplicate.phone_e164) {
    throw new Error("Those leads do not share a phone number.");
  }

  const patch: Record<string, string> = {};
  if (!keeper.lead_name && duplicate.lead_name) patch.lead_name = duplicate.lead_name;
  if (!keeper.email && duplicate.email) patch.email = duplicate.email;
  if (!keeper.summary && duplicate.summary) patch.summary = duplicate.summary;
  if (!keeper.quo_link && duplicate.quo_link) patch.quo_link = duplicate.quo_link;
  if (!keeper.owner_name && duplicate.owner_name) patch.owner_name = duplicate.owner_name;
  if (Object.keys(patch).length) {
    const { error: fillError } = await supabase.from("leads").update(patch).eq("id", keeperId);
    if (fillError) throw new Error(fillError.message);
  }

  const { error: closeError } = await supabase
    .from("leads")
    .update({ lead_status: "Lost", follow_up: false, needs_verification: false })
    .eq("id", duplicateId);
  if (closeError) throw new Error(closeError.message);
  await stopFollowUp(supabase, duplicateId, "Merged into another lead with the same phone.");
  await supabase.from("lead_events").insert([
    {
      lead_id: keeperId,
      event_type: "merged",
      actor: email,
      payload: { duplicate_id: duplicateId },
    },
    {
      lead_id: duplicateId,
      event_type: "merged",
      actor: email,
      payload: { keeper_id: keeperId },
    },
  ]);
  revalidatePath("/verify");
  revalidatePath("/");
  revalidatePath(`/leads/${keeperId}`);
  revalidatePath(`/leads/${duplicateId}`);
}

export async function scheduleSlackPost(leadId: string, formData: FormData) {
  const { supabase, email } = await requireStaff();
  const body = text(formData, "body");
  const when = text(formData, "due_at");
  if (!body) throw new Error("Write the Slack message first.");
  const due = when ? new Date(when) : new Date();
  if (Number.isNaN(due.getTime())) throw new Error("That time is not valid.");
  const { error } = await supabase.from("slack_posts").insert({
    lead_id: leadId,
    body,
    due_at: due.toISOString(),
    mention: text(formData, "mention"),
    created_by: email,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/queues");
}

export async function sendReferral(leadId: string, formData: FormData) {
  const { supabase, email } = await requireStaff();
  const destinationId = text(formData, "destination_id");
  if (!destinationId) throw new Error("Pick where this lead should go.");
  const { data: destination, error: loadError } = await supabase
    .from("referral_destinations")
    .select("id, name, phone")
    .eq("id", destinationId)
    .maybeSingle();
  if (loadError || !destination) throw new Error(loadError?.message ?? "That referral destination is missing.");

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("lead_name, phone, case_type, summary, slack_channel_id, slack_thread_ts")
    .eq("id", leadId)
    .maybeSingle();
  if (leadError || !lead) throw new Error(leadError?.message ?? "Lead not found");

  const note = text(formData, "note");
  const { error } = await supabase.from("referral_sends").insert({
    lead_id: leadId,
    destination_id: destination.id,
    actor: email,
    note,
  });
  if (error) throw new Error(error.message);

  await supabase
    .from("leads")
    .update({ lead_status: "Referred", follow_up: false })
    .eq("id", leadId);
  await stopFollowUp(supabase, leadId, "Referred out.");
  await supabase.from("lead_events").insert({
    lead_id: leadId,
    event_type: "referred",
    actor: email,
    payload: { destination: destination.name, phone: destination.phone, note },
  });

  const who = lead.lead_name || "Unnamed lead";
  await postToSlack({
    channel: lead.slack_channel_id || LEAD_CHANNEL_ID,
    threadTs: lead.slack_thread_ts,
    text: [
      `Referral: ${who}${lead.phone ? ` ${lead.phone}` : ""}`,
      lead.case_type ? `Case type: ${lead.case_type}` : null,
      `Send to ${destination.name}${destination.phone ? ` ${destination.phone}` : ""}.`,
      note,
      lead.summary ? `Summary: ${lead.summary}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  });

  revalidatePath("/");
  revalidatePath(`/leads/${leadId}`);
}

export async function saveDestination(formData: FormData) {
  const { supabase } = await requireStaff();
  const name = text(formData, "name");
  if (!name) throw new Error("Name the referral destination.");
  const caseTypes = String(formData.get("case_types") ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const { error } = await supabase.from("referral_destinations").insert({
    name,
    phone: text(formData, "phone"),
    notes: text(formData, "notes"),
    case_types: caseTypes,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/referrals");
}

export async function saveSequenceStep(formData: FormData) {
  const { supabase } = await requireStaff();
  const id = text(formData, "id");
  const body = text(formData, "body");
  const delay = Number(formData.get("delay_minutes"));
  if (!id || !body || !Number.isFinite(delay) || delay < 0) {
    throw new Error("Each step needs a message and a delay.");
  }
  const { error } = await supabase
    .from("sequence_steps")
    .update({ body, delay_minutes: Math.round(delay) })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/sequences");
}

export async function syncCallrailCatalog() {
  const { supabase } = await requireStaff();
  if (!callrailConfigured()) throw new Error("Set CALLRAIL_API_KEY and CALLRAIL_ACCOUNT_ID first.");
  const tags = await fetchCallrailTags();
  const now = new Date().toISOString();
  if (tags.length) {
    const { error } = await supabase.from("callrail_tags").upsert(
      tags.map((tag) => ({ name: tag.name, callrail_id: tag.id, synced_at: now })),
      { onConflict: "name" },
    );
    if (error) throw new Error(error.message);
  }
  revalidatePath("/sequences");
}

export async function resolveIdentity(leadId: string, formData: FormData) {
  const { supabase, email } = await requireStaff();
  const decision = text(formData, "decision");
  const clientName = text(formData, "client_name");
  const { data: lead, error } = await supabase
    .from("leads")
    .select("id, lead_name, email")
    .eq("id", leadId)
    .maybeSingle();
  if (error || !lead) throw new Error(error?.message ?? "Lead not found");

  if (decision === "replace") {
    if (!clientName) throw new Error("Enter the client’s name before saving it.");
    const staff = await loadStaff(supabase);
    const matched = matchStaff(clientName, staff);
    if (matched) {
      throw new Error(`${clientName} is ${matched.name} in the staff directory. Enter the prospective client, or keep the current name.`);
    }
    const { error: updateError } = await supabase
      .from("leads")
      .update({
        lead_name: clientName,
        identity_status: "confirmed",
        identity_evidence: null,
      })
      .eq("id", leadId);
    if (updateError) throw new Error(updateError.message);
    await supabase.from("lead_events").insert({
      lead_id: leadId,
      event_type: "identity_corrected",
      actor: email,
      payload: { from: lead.lead_name, to: clientName },
    });
  } else if (decision === "keep") {
    const { error: updateError } = await supabase
      .from("leads")
      .update({ identity_status: "confirmed" })
      .eq("id", leadId);
    if (updateError) throw new Error(updateError.message);
    await supabase.from("lead_events").insert({
      lead_id: leadId,
      event_type: "identity_kept",
      actor: email,
      payload: { lead_name: lead.lead_name },
    });
  } else {
    throw new Error("Choose whether to keep the name or replace it.");
  }
  revalidatePath("/verify");
  revalidatePath("/");
  revalidatePath(`/leads/${leadId}`);
}

export async function claimCall(formData: FormData) {
  const { supabase, email } = await requireStaff();
  const jobId = text(formData, "job_id");
  if (!jobId) throw new Error("Choose a call to claim.");
  const { data: job, error } = await supabase
    .from("lead_jobs")
    .select("id, lead_id, queue, status, assigned_email")
    .eq("id", jobId)
    .maybeSingle();
  if (error || !job) throw new Error(error?.message ?? "That call is not on the queue.");
  if (job.queue !== "call") throw new Error("Only calls can be claimed.");
  if (job.status !== "pending" && job.status !== "failed") throw new Error("That call is already finished.");
  const { error: updateError } = await supabase
    .from("lead_jobs")
    .update({ assigned_email: email })
    .eq("id", jobId);
  if (updateError) throw new Error(updateError.message);
  await supabase.from("lead_events").insert({
    lead_id: job.lead_id,
    event_type: "call_claimed",
    actor: email,
    payload: { job_id: jobId },
  });
  revalidatePath("/queues");
  revalidatePath(`/leads/${job.lead_id}`);
}

export async function recordCallOutcome(formData: FormData) {
  const { supabase, email } = await requireStaff();
  const jobId = text(formData, "job_id");
  const outcome = text(formData, "outcome");
  const note = text(formData, "note");
  if (!jobId || !isCallOutcome(outcome)) throw new Error("Choose what happened on the call.");
  const { data: job, error } = await supabase
    .from("lead_jobs")
    .select("id, lead_id, queue, status")
    .eq("id", jobId)
    .maybeSingle();
  if (error || !job) throw new Error(error?.message ?? "That call is not on the queue.");
  if (job.queue !== "call") throw new Error("That step is not a call.");
  if (job.status !== "pending" && job.status !== "failed") throw new Error("That call is already finished.");

  const callbackRaw = text(formData, "callback_at");
  const nextDue = outcome === "callback" ? chicagoLocalToIso(callbackRaw ?? "") : null;
  const now = new Date().toISOString();
  const label = callOutcomeLabel(outcome);
  const stopRest = formData.get("stop_rest") === "yes" || outcome === "wrong_number" || outcome === "not_interested";

  const { error: attemptError } = await supabase.from("call_attempts").insert({
    lead_id: job.lead_id,
    job_id: jobId,
    outcome,
    note,
    actor: email,
    attempted_at: now,
    next_due_at: nextDue,
  });
  if (attemptError) throw new Error(attemptError.message);

  if (outcome === "callback") {
    const { error: moveError } = await supabase
      .from("lead_jobs")
      .update({
        due_at: nextDue,
        status: "pending",
        outcome: "callback",
        outcome_note: note,
        assigned_email: email,
        detail: `Callback ${label.toLowerCase()} set by ${email}.`,
      })
      .eq("id", jobId);
    if (moveError) throw new Error(moveError.message);
  } else {
    const { error: doneError } = await supabase
      .from("lead_jobs")
      .update({
        status: "completed",
        outcome,
        outcome_note: note,
        completed_at: now,
        completed_by: email,
        assigned_email: email,
        detail: `${label} recorded by ${email}.`,
      })
      .eq("id", jobId);
    if (doneError) throw new Error(doneError.message);
  }

  if (stopRest && outcome !== "callback") {
    await stopFollowUp(supabase, job.lead_id, `${label}. Remaining calls were stopped.`);
  }

  await supabase
    .from("leads")
    .update({ last_action: note ? `${label}. ${note}` : label })
    .eq("id", job.lead_id);
  await supabase.from("lead_events").insert({
    lead_id: job.lead_id,
    event_type: "call_outcome",
    actor: email,
    payload: { job_id: jobId, outcome, note, next_due_at: nextDue, stopped: stopRest },
  });
  revalidatePath("/queues");
  revalidatePath(`/leads/${job.lead_id}`);
  revalidatePath("/priority");
}

export async function runDueWork() {
  await requireStaff();
  const supabase = createSupabaseServiceClient();
  await enrollMissingFollowUps(supabase);
  const result = await dispatchDue(supabase);
  redirect(`/queues?texts=${result.texts}&calls=${result.calls}&slack=${result.slack}&failed=${result.failed}`);
}
