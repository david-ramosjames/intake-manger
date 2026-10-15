"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { callrailConfigured, fetchCallrailTags, pushCallrailTags } from "./callrail";
import { EXCLUDED_CALLER_CLASSES, NON_LEAD_TAG, type ExcludedCallerClass } from "./caller-class";
import { LEAD_TAGS, NOT_A_LEAD_TAGS, tagsFromSelection } from "./tags";
import { dispatchDue } from "./dispatch";
import { callOutcomeLabel, isCallOutcome } from "./calls";
import { loadStaff, matchStaff } from "./identity";
import { contractSent } from "./desired";
import { enrollFollowUp, enrollMissingFollowUps, stopFollowUp } from "./followup";
import { clockToMinutes, delayMinutes, isCallSequence, isCallbackWindow, type CadenceDay, type CallSequenceId } from "./sequences";
import { chicagoDay, chicagoLocalToIso } from "./time";
import { requireStaff } from "./session";
import { createSupabaseServiceClient } from "./supabase/service";
import { toE164 } from "./phone";
import { sendQuoText } from "./quo";
import { DEFAULT_REFERRAL_SMS, isPracticeArea, renderReferralSms } from "./referrals";
import { LEAD_CHANNEL_ID, postToSlack } from "./slack";
import { loadSlackSettings } from "./slack-settings";

function text(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value.length ? value : null;
}

export async function savePriority(leadId: string, formData: FormData) {
  const { supabase, email } = await requireStaff();
  const priority = formData.getAll("priority").includes("yes");
  const reason = text(formData, "priority_reason");
  const patch: {
    priority: boolean;
    priority_reason: string | null;
    last_action: string | null;
    next_action: string | null;
    priority_suggestion?: null;
  } = {
    priority,
    priority_reason: priority ? reason : null,
    last_action: text(formData, "last_action"),
    next_action: text(formData, "next_action"),
  };
  if (priority) patch.priority_suggestion = null;
  const { error } = await supabase.from("leads").update(patch).eq("id", leadId);
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

export async function markPriority(formData: FormData) {
  const { supabase, email } = await requireStaff();
  const leadId = text(formData, "lead_id");
  if (!leadId) throw new Error("Missing the lead.");
  const { error } = await supabase
    .from("leads")
    .update({
      priority: true,
      priority_reason: "Marked from the work queue",
      priority_suggestion: null,
    })
    .eq("id", leadId);
  if (error) throw new Error(error.message);
  await supabase.from("lead_events").insert({
    lead_id: leadId,
    event_type: "priority_set",
    actor: email,
    payload: { source: "work-queue" },
  });
  revalidatePath("/");
  revalidatePath("/priority");
  revalidatePath(`/leads/${leadId}`);
}

export async function setQualified(formData: FormData) {
  const decision = text(formData, "decision");
  if (decision !== "yes" && decision !== "no") throw new Error("Choose yes or no.");
  const qualified = decision === "yes";
  await saveQueueMilestone(formData, {
    event: "qualified_set",
    payload: { qualified },
    patch: { qualified },
    tags(current) {
      const tags = current.filter((tag) => tag !== "QUALIFIED YES" && tag !== "QUALIFIED NO");
      tags.push(qualified ? "QUALIFIED YES" : "QUALIFIED NO");
      return tags;
    },
  });
}

export async function setConsultation(formData: FormData) {
  const { supabase, email } = await requireStaff();
  const leadId = text(formData, "lead_id");
  if (!leadId) throw new Error("Missing the lead.");
  const raw = text(formData, "consultation_date");
  const consultationDate = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
  const { error } = await supabase
    .from("leads")
    .update({
      consultation_date: consultationDate,
      consultation: consultationDate ? "staff" : null,
    })
    .eq("id", leadId);
  if (error) throw new Error(error.message);
  await supabase.from("lead_events").insert({
    lead_id: leadId,
    event_type: "consultation_set",
    actor: email,
    payload: { consultation_date: consultationDate },
  });
  revalidatePath("/");
  revalidatePath("/priority");
  revalidatePath(`/leads/${leadId}`);
}

export async function setDesired(formData: FormData) {
  const decision = text(formData, "decision");
  if (decision !== "yes" && decision !== "no") throw new Error("Choose yes or no.");
  const { supabase } = await requireStaff();
  const leadId = text(formData, "lead_id");
  if (!leadId) throw new Error("Missing the lead.");
  const { data: before, error } = await supabase
    .from("leads")
    .select("agreement_status, agreement_sent_at, signed_case")
    .eq("id", leadId)
    .maybeSingle();
  if (error || !before) throw new Error(error?.message ?? "Lead not found");
  if (before.signed_case || contractSent(before)) throw new Error("A sent or signed contract is already a desired case.");
  const desired = decision === "yes";
  await saveQueueMilestone(formData, {
    event: "desired_set",
    payload: { desired },
    patch: { desired_case: desired, desired_source: "staff" },
    tags(current) {
      const tags = current.filter((tag) => tag !== "CVR DESIRED");
      if (desired) tags.push("CVR DESIRED");
      return tags;
    },
  });
}

async function saveQueueMilestone(
  formData: FormData,
  change: {
    event: string;
    payload: Record<string, unknown>;
    patch: Record<string, unknown>;
    tags: (current: string[]) => string[];
  },
) {
  const { supabase, email } = await requireStaff();
  const leadId = text(formData, "lead_id");
  if (!leadId) throw new Error("Missing the lead.");
  const { data: before, error } = await supabase
    .from("leads")
    .select("callrail_call_id, callrail_tags")
    .eq("id", leadId)
    .maybeSingle();
  if (error || !before) throw new Error(error?.message ?? "Lead not found");
  const tags = change.tags(before.callrail_tags ?? []);
  const { error: updateError } = await supabase
    .from("leads")
    .update({ ...change.patch, callrail_tags: tags })
    .eq("id", leadId);
  if (updateError) throw new Error(updateError.message);
  await supabase.from("lead_events").insert({
    lead_id: leadId,
    event_type: change.event,
    actor: email,
    payload: change.payload,
  });
  if (callrailConfigured() && before.callrail_call_id) {
    try {
      await pushCallrailTags(before.callrail_call_id, tags, LEAD_TAGS);
    } catch (err) {
      const message = err instanceof Error ? err.message : "CallRail did not take the tags.";
      throw new Error(`Saved on the lead. CallRail did not take the tags. ${message}`);
    }
  }
  revalidatePath("/");
  revalidatePath("/priority");
  revalidatePath(`/leads/${leadId}`);
}

export async function reviewPrioritySuggestion(formData: FormData) {
  const { supabase, email } = await requireStaff();
  const leadId = text(formData, "lead_id");
  const decision = text(formData, "decision");
  if (!leadId) throw new Error("Missing the lead.");
  if (decision === "dismiss") {
    const { error } = await supabase
      .from("leads")
      .update({ priority_suggestion: null, priority_suggestion_dismissed: true })
      .eq("id", leadId);
    if (error) throw new Error(error.message);
  } else if (decision === "confirm") {
    const { data, error } = await supabase.from("leads").select("priority_suggestion").eq("id", leadId).maybeSingle();
    if (error || !data) throw new Error(error?.message ?? "Lead not found");
    const { error: updateError } = await supabase
      .from("leads")
      .update({
        priority: true,
        priority_reason: data.priority_suggestion,
        priority_suggestion: null,
      })
      .eq("id", leadId);
    if (updateError) throw new Error(updateError.message);
  } else {
    throw new Error("Choose confirm or not now.");
  }
  await supabase.from("lead_events").insert({
    lead_id: leadId,
    event_type: decision === "confirm" ? "priority_set" : "priority_dismissed",
    actor: email,
    payload: { source: "suggestion" },
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
    .select("id, kind, follow_up, lead_name, case_type, signed_case, case_id, lead_status, arrival, owner_name, agreement_status, agreement_sent_at, priority, created_at, consultation_date, lead_date")
    .eq("id", leadId)
    .maybeSingle();
  if (error || !lead) throw new Error(error?.message ?? "Lead not found");
  if (lead.signed_case || lead.case_id || ["Lost", "Referred", "Promoted", "Signed"].includes(lead.lead_status)) {
    throw new Error("This lead is closed.");
  }
  if (contractSent(lead)) {
    throw new Error("The contract follow-up starts on its own.");
  }
  const { error: followError } = await supabase.from("leads").update({ follow_up: true }).eq("id", leadId);
  if (followError) throw new Error(followError.message);
  await enrollFollowUp(supabase, { ...lead, follow_up: true }, undefined, "post_consult");
  await supabase.from("lead_events").insert({
    lead_id: leadId,
    event_type: "enrolled",
    actor: email,
    payload: { sequence: "post_consult" },
  });
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/queues");
}

export async function saveCallbackPlan(formData: FormData) {
  const { supabase, email } = await requireStaff();
  const jobId = text(formData, "job_id");
  const due = text(formData, "due_at");
  const assigned = text(formData, "assigned_name");
  if (!jobId || !due) throw new Error("Choose when the Slack reminder should post.");
  const { data: job, error } = await supabase
    .from("lead_jobs")
    .select("id, lead_id, status, queue")
    .eq("id", jobId)
    .maybeSingle();
  if (error || !job) throw new Error(error?.message ?? "That callback is missing.");
  if (job.queue !== "call" || (job.status !== "pending" && job.status !== "failed")) {
    throw new Error("That reminder already went out.");
  }
  const { error: updateError } = await supabase
    .from("lead_jobs")
    .update({
      due_at: chicagoLocalToIso(due),
      assigned_name: assigned,
      mention: null,
      detail: assigned ? `Tag ${assigned}.` : "Any available intake person.",
    })
    .eq("id", jobId);
  if (updateError) throw new Error(updateError.message);
  await supabase.from("lead_events").insert({
    lead_id: job.lead_id,
    event_type: "callback_edited",
    actor: email,
    payload: { due, assigned },
  });
  revalidatePath(`/leads/${job.lead_id}`);
  revalidatePath("/");
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

export async function classifyNonLead(formData: FormData) {
  const { supabase, email } = await requireStaff();
  const leadId = text(formData, "lead_id");
  const callerClass = text(formData, "caller_class");
  if (!leadId) throw new Error("Missing the lead.");
  if (!callerClass || !EXCLUDED_CALLER_CLASSES.includes(callerClass as ExcludedCallerClass)) {
    throw new Error("Choose why this is not a lead.");
  }
  const reason = callerClass as ExcludedCallerClass;
  const { data, error } = await supabase
    .from("leads")
    .select("id, signed_case, case_id, lead_status, text_sequence_status, callrail_call_id, callrail_tags")
    .eq("id", leadId)
    .maybeSingle();
  if (error || !data) throw new Error(error?.message ?? "Lead not found");
  if (data.signed_case || data.case_id || data.lead_status === "Signed" || data.lead_status === "Promoted") {
    throw new Error("A signed or promoted matter stays a lead.");
  }
  const drop = new Set<string>([...NOT_A_LEAD_TAGS, NON_LEAD_TAG.spam, "QUALIFIED YES"]);
  const tags = ((data.callrail_tags as string[] | null) ?? []).filter((tag) => !drop.has(tag));
  if (!tags.includes("QUALIFIED NO")) tags.push("QUALIFIED NO");
  const reasonTag = NON_LEAD_TAG[reason];
  if (!tags.includes(reasonTag)) tags.push(reasonTag);
  const { error: updateError } = await supabase
    .from("leads")
    .update({
      lead_status: "Lost",
      follow_up: false,
      sequence: "stop",
      close_reason: "not_a_lead",
      close_suggestion: null,
      caller_class: reason,
      qualified: false,
      callrail_tags: tags,
      text_sequence_status: data.text_sequence_status === "active" ? "stopped" : data.text_sequence_status,
    })
    .eq("id", leadId);
  if (updateError) throw new Error(updateError.message);
  await stopFollowUp(supabase, leadId, "Not a lead");
  await supabase.from("lead_events").insert({
    lead_id: leadId,
    event_type: "not_a_lead",
    actor: email,
    payload: { caller_class: reason, tag: reasonTag },
  });
  if (callrailConfigured() && data.callrail_call_id) {
    try {
      await pushCallrailTags(data.callrail_call_id, tags, LEAD_TAGS);
    } catch (err) {
      const message = err instanceof Error ? err.message : "CallRail did not take the tags.";
      throw new Error(`Moved to non-leads. CallRail did not take the tags. ${message}`);
    }
  }
  revalidatePath("/");
  revalidatePath("/priority");
  revalidatePath(`/leads/${leadId}`);
}

export async function markNotALead(leadId: string) {
  const { supabase, email } = await requireStaff();
  const { data, error } = await supabase
    .from("leads")
    .select("id, signed_case, case_id, lead_status, text_sequence_status, consultation_date, grade, callrail_tags, decline_reason, qualified")
    .eq("id", leadId)
    .maybeSingle();
  if (error || !data) throw new Error(error?.message ?? "Lead not found");
  if (data.signed_case || data.case_id || data.lead_status === "Signed" || data.lead_status === "Promoted") {
    throw new Error("A signed or promoted matter stays open.");
  }
  const { error: updateError } = await supabase
    .from("leads")
    .update({
      lead_status: "Lost",
      follow_up: false,
      sequence: "stop",
      close_reason: "not_a_lead",
      text_sequence_status: data.text_sequence_status === "active" ? "stopped" : data.text_sequence_status,
    })
    .eq("id", leadId);
  if (updateError) throw new Error(updateError.message);
  await stopFollowUp(supabase, leadId, "Not a lead");
  await supabase.from("lead_events").insert({
    lead_id: leadId,
    event_type: "not_a_lead",
    actor: email,
    payload: { reason: "Staff marked this as not a lead." },
  });
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/");
  revalidatePath("/queues");
}

export async function markReferralOpportunity(leadId: string, formData: FormData) {
  const { supabase, email } = await requireStaff();
  const area = text(formData, "practice_area");
  if (!isPracticeArea(area)) throw new Error("Choose the legal practice area.");
  const outside = area !== "personal_injury";
  const { data: current } = await supabase.from("leads").select("callrail_tags").eq("id", leadId).maybeSingle();
  const tags = ((current?.callrail_tags as string[] | null) ?? []).filter((tag) => tag !== "QUALIFIED YES");
  if (outside) {
    if (!tags.includes("QUALIFIED NO")) tags.push("QUALIFIED NO");
    if (!tags.includes("NQ: Non-PI Legal Matter")) tags.push("NQ: Non-PI Legal Matter");
  }
  const patch: { practice_area: string; referral_opportunity: boolean; caller_class: string | null; close_suggestion: null; qualified?: boolean; callrail_tags?: string[] } = {
    practice_area: area,
    referral_opportunity: true,
    caller_class: outside ? "non_pi" : null,
    close_suggestion: null,
  };
  if (outside) {
    patch.qualified = false;
    patch.callrail_tags = tags;
  }
  const { error } = await supabase.from("leads").update(patch).eq("id", leadId);
  if (error) throw new Error(error.message);
  await supabase.from("lead_events").insert({
    lead_id: leadId,
    event_type: "referral_opportunity",
    actor: email,
    payload: { practice_area: area },
  });
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/");
}

export async function sendReferral(leadId: string, formData: FormData) {
  const { supabase, email } = await requireStaff();
  const destinationId = text(formData, "destination_id");
  const language = text(formData, "language") === "es" ? "es" : "en";
  const area = text(formData, "practice_area");
  if (!destinationId) throw new Error("Pick the attorney to refer.");
  if (!isPracticeArea(area)) throw new Error("Choose the legal practice area.");
  const { data: destination, error: loadError } = await supabase
    .from("referral_destinations")
    .select("id, name, phone, address, email, website, practice_areas, spanish, notes")
    .eq("id", destinationId)
    .maybeSingle();
  if (loadError || !destination) throw new Error(loadError?.message ?? "That referral destination is missing.");
  if (!(destination.practice_areas ?? []).includes(area)) throw new Error("That attorney is not listed for this practice area.");

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("lead_name, phone, phone_e164, case_type, summary, slack_channel_id, slack_thread_ts")
    .eq("id", leadId)
    .maybeSingle();
  if (leadError || !lead) throw new Error(leadError?.message ?? "Lead not found");
  const to = lead.phone_e164 || toE164(lead.phone);
  if (!to) throw new Error("This lead needs a phone number before the text can go out.");

  const { data: templates } = await supabase.from("referral_templates").select("language, body");
  const stored = (templates ?? []).find((row) => row.language === language)?.body;
  const message = renderReferralSms({
    language,
    template: stored || DEFAULT_REFERRAL_SMS[language],
    leadName: lead.lead_name,
    area,
    destination,
  });
  const sent = await sendQuoText(to, message);
  if (!sent.ok) throw new Error(`${sent.error} The lead is still open.`);

  const note = text(formData, "note");
  const outside = area !== "personal_injury";
  const { error: updateError } = await supabase
    .from("leads")
    .update({
      lead_status: "Referred",
      follow_up: false,
      sequence: "stop",
      close_reason: "referred",
      close_suggestion: null,
      practice_area: area,
      referral_opportunity: true,
      caller_class: outside ? "non_pi" : null,
    })
    .eq("id", leadId);
  if (updateError) throw new Error(`The text was sent. The lead did not close: ${updateError.message}`);
  await stopFollowUp(supabase, leadId, "Referred out.");
  const { error } = await supabase.from("referral_sends").insert({
    lead_id: leadId,
    destination_id: destination.id,
    actor: email,
    note,
    language,
    message,
  });
  if (error) throw new Error(`The text was sent and the lead was closed. The referral log did not save: ${error.message}`);
  await supabase.from("lead_events").insert({
    lead_id: leadId,
    event_type: "referred",
    actor: email,
    payload: { destination: destination.name, phone: destination.phone, language, message },
  });

  const who = lead.lead_name || "Unnamed lead";
  const slack = await loadSlackSettings();
  if (slack.posting) {
    await postToSlack({
      token: slack.token,
      channel: lead.slack_channel_id || slack.channelId || LEAD_CHANNEL_ID,
      threadTs: lead.slack_thread_ts,
      text: [
        `Referral sent: ${who}${lead.phone ? ` ${lead.phone}` : ""}`,
        `${language === "es" ? "Spanish" : "English"} text to the lead with ${destination.name}${destination.phone ? ` ${destination.phone}` : ""}.`,
        message,
      ].join("\n"),
    });
  }

  revalidatePath("/");
  revalidatePath(`/leads/${leadId}`);
}

export async function saveReferralTemplate(formData: FormData) {
  const { supabase } = await requireStaff();
  const language = text(formData, "language");
  const body = text(formData, "body");
  if (language !== "en" && language !== "es") throw new Error("Choose English or Spanish.");
  if (!body) throw new Error("Write the text template.");
  const { error } = await supabase.from("referral_templates").upsert({
    language,
    body,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/referrals");
}

export async function saveDestination(formData: FormData) {
  const { supabase } = await requireStaff();
  const name = text(formData, "name");
  if (!name) throw new Error("Name the referral destination.");
  const caseTypes = String(formData.get("case_types") ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const area = text(formData, "practice_area");
  const { error } = await supabase.from("referral_destinations").insert({
    name,
    phone: text(formData, "phone"),
    notes: text(formData, "notes"),
    case_types: area ? [area] : caseTypes,
    practice_areas: area ? [area] : caseTypes,
    address: text(formData, "address"),
    email: text(formData, "email"),
    website: text(formData, "website"),
    spanish: formData.get("spanish") === "yes",
    matters: text(formData, "matters"),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/referrals");
}

export async function saveSlackSettings(formData: FormData) {
  const { email } = await requireStaff();
  const supabase = createSupabaseServiceClient();
  const posting = formData.getAll("slack_posting").includes("yes");
  const pasted = String(formData.get("slack_bot_token") ?? "").trim();
  const channel = String(formData.get("slack_channel_id") ?? "").trim();
  const { data: current } = await supabase
    .from("intake_settings")
    .select("slack_bot_token")
    .eq("id", "default")
    .maybeSingle();
  const token = pasted || (typeof current?.slack_bot_token === "string" ? current.slack_bot_token : null);
  const { error } = await supabase.from("intake_settings").upsert({
    id: "default",
    slack_posting: posting,
    slack_bot_token: token,
    slack_channel_id: channel || "C026G89PPSS",
    updated_at: new Date().toISOString(),
    updated_by: email,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/how-it-fits");
}

export async function saveSequenceHours(formData: FormData) {
  const { supabase } = await requireStaff();
  const sequence = text(formData, "sequence");
  if (!isCallSequence(sequence)) throw new Error("Choose a sequence.");
  const weekday = dayWindow(formData, "weekday", true);
  const saturday = dayWindow(formData, "saturday", formData.getAll("saturday_open").includes("yes"));
  const sunday = dayWindow(formData, "sunday", formData.getAll("sunday_open").includes("yes"));
  const { error } = await supabase.from("sequence_hours").upsert({
    sequence,
    weekday_start: weekday.start,
    weekday_end: weekday.end,
    saturday_start: saturday.start,
    saturday_end: saturday.end,
    sunday_start: sunday.start,
    sunday_end: sunday.end,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/sequences");
  revalidatePath("/");
  revalidatePath("/priority");
}

function dayWindow(formData: FormData, name: string, open: boolean): { start: number | null; end: number | null } {
  if (!open) return { start: null, end: null };
  const start = clockToMinutes(String(formData.get(`${name}_start`) ?? ""));
  const end = clockToMinutes(String(formData.get(`${name}_end`) ?? ""));
  const label = name === "weekday" ? "Monday through Friday" : name === "saturday" ? "Saturday" : "Sunday";
  if (start == null || end == null || end <= start) {
    throw new Error(`${label} needs an open time and a later close time.`);
  }
  return { start, end };
}

function stepBody(sequence: CallSequenceId, queue: "call" | "text"): string {
  if (queue === "text") return "Text";
  if (sequence === "more_info") return "Call to reconnect after the consultation.";
  if (sequence === "want_to_sign") return "Call to get the contract signed.";
  return "Call to establish first contact.";
}

export async function saveCadence(formData: FormData) {
  const { supabase } = await requireStaff();
  const sequence = text(formData, "sequence");
  if (!isCallSequence(sequence)) throw new Error("Choose a callback sequence.");
  let days: CadenceDay[];
  try {
    days = JSON.parse(String(formData.get("days") ?? "")) as CadenceDay[];
  } catch {
    throw new Error("The cadence could not be read.");
  }
  if (!Array.isArray(days) || days.length < 1 || days.length > 21) {
    throw new Error("Use between 1 and 21 days.");
  }
  const rows: { sequence: string; queue: "call" | "text"; position: number; delay_minutes: number; callback_window: string | null; body: string }[] = [];
  const positions = { call: 0, text: 0 };
  days.forEach((day, index) => {
    for (const queue of ["call", "text"] as const) {
      const slots = queue === "call" ? day?.calls : day?.texts;
      if (!Array.isArray(slots) || slots.length > 3) throw new Error("Each day can have up to three calls and three texts.");
      for (const slot of slots) {
        if (queue === "call" && !isCallbackWindow(slot)) throw new Error("Choose morning, lunch, afternoon, or match last contact.");
        positions[queue] += 1;
        rows.push({
          sequence,
          queue,
          position: positions[queue],
          delay_minutes: index * 1440,
          callback_window: queue === "call" ? slot : null,
          body: stepBody(sequence, queue),
        });
      }
    }
  });
  const { error: deleteError } = await supabase.from("sequence_steps").delete().eq("sequence", sequence);
  if (deleteError) throw new Error(deleteError.message);
  if (rows.length) {
    const { error } = await supabase.from("sequence_steps").insert(rows);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/sequences");
  revalidatePath("/");
  revalidatePath("/priority");
  redirect(`/sequences?sequence=${sequence}&saved=${Date.now()}`);
}

export async function saveSequenceStep(formData: FormData) {
  const { supabase } = await requireStaff();
  const id = text(formData, "id");
  const days = Number(formData.get("days"));
  const hours = Number(formData.get("hours"));
  if (!id || !Number.isInteger(days) || days < 0 || !Number.isInteger(hours) || hours < 0 || hours > 23) {
    throw new Error("Use a day count and hours from 0 to 23.");
  }
  const { error } = await supabase
    .from("sequence_steps")
    .update({ delay_minutes: delayMinutes(days, hours) })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/sequences");
}

export async function addSequenceStep(formData: FormData) {
  const { supabase } = await requireStaff();
  const sequence = text(formData, "sequence");
  const queue = text(formData, "queue");
  if (!isCallSequence(sequence) || (queue !== "call" && queue !== "text")) {
    throw new Error("Choose a sequence and whether this step is a call or a text.");
  }
  const { data: existing, error: loadError } = await supabase
    .from("sequence_steps")
    .select("position")
    .eq("sequence", sequence)
    .eq("queue", queue)
    .order("position", { ascending: false })
    .limit(1);
  if (loadError) throw new Error(loadError.message);
  const position = Number((existing ?? [])[0]?.position ?? 0) + 1;
  const { error } = await supabase.from("sequence_steps").insert({
    sequence,
    queue,
    position,
    delay_minutes: 0,
    body: queue === "call" ? "Call" : "Text",
  });
  if (error) throw new Error(error.message);
  revalidatePath("/sequences");
}

export async function removeSequenceStep(formData: FormData) {
  const { supabase } = await requireStaff();
  const id = text(formData, "id");
  if (!id) throw new Error("Missing step.");
  const { error } = await supabase.from("sequence_steps").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/sequences");
}

export async function confirmCloseSuggestion(formData: FormData) {
  const { supabase, email } = await requireStaff();
  const leadId = text(formData, "lead_id");
  const suggestion = text(formData, "suggestion");
  const decision = text(formData, "decision");
  if (!leadId || !suggestion) throw new Error("Missing the close suggestion.");
  if (decision === "dismiss") {
    const { error } = await supabase.from("leads").update({ close_suggestion: null }).eq("id", leadId);
    if (error) throw new Error(error.message);
  } else if (suggestion === "decline" && decision === "refer") {
    await closeLead(supabase, leadId, email, { lead_status: "Referred", close_reason: "referred", event: "referred" });
  } else if (suggestion === "decline" && decision === "decline") {
    await closeLead(supabase, leadId, email, { lead_status: "Lost", close_reason: "declined", event: "declined" });
  } else if (suggestion === "not_interested" && decision === "confirm") {
    await closeLead(supabase, leadId, email, { lead_status: "Lost", close_reason: "not_interested", event: "not_interested" });
  } else if (suggestion === "not_a_lead" && decision === "confirm") {
    await closeLead(supabase, leadId, email, { lead_status: "Lost", close_reason: "not_a_lead", event: "not_a_lead" });
  } else {
    throw new Error("Choose confirm or keep open.");
  }
  revalidatePath("/");
  revalidatePath(`/leads/${leadId}`);
}

async function closeLead(
  supabase: Awaited<ReturnType<typeof requireStaff>>["supabase"],
  leadId: string,
  email: string,
  change: { lead_status: string; close_reason: string; event: string },
) {
  const { error } = await supabase
    .from("leads")
    .update({
      lead_status: change.lead_status,
      close_reason: change.close_reason,
      close_suggestion: null,
      follow_up: false,
      sequence: "stop",
    })
    .eq("id", leadId);
  if (error) throw new Error(error.message);
  await supabase.from("lead_jobs").update({ status: "skipped", detail: change.close_reason }).eq("lead_id", leadId).eq("status", "pending");
  await supabase.from("lead_events").insert({
    lead_id: leadId,
    event_type: change.event,
    actor: email,
    payload: { close_reason: change.close_reason },
  });
}

export async function confirmSigned(formData: FormData) {
  const { supabase, email } = await requireStaff();
  const leadId = text(formData, "lead_id");
  if (!leadId) throw new Error("Missing the lead.");
  const { data: before, error } = await supabase
    .from("leads")
    .select("id, signed_case, callrail_call_id, callrail_tags, desired_source, date_signed")
    .eq("id", leadId)
    .maybeSingle();
  if (error || !before) throw new Error(error?.message ?? "Lead not found");
  const tags = Array.from(new Set([...(before.callrail_tags ?? []), "CVR DESIRED", "CVR SIGNED"]));
  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("leads")
    .update({
      signed_case: true,
      lead_status: "Signed",
      close_reason: "signed",
      close_suggestion: null,
      follow_up: false,
      sequence: "stop",
      signed_at: now,
      date_signed: before.date_signed ?? chicagoDay(new Date()),
      desired_case: true,
      desired_source: before.desired_source === "staff" ? "staff" : "contract",
      callrail_tags: tags,
    })
    .eq("id", leadId);
  if (updateError) throw new Error(updateError.message);
  await supabase.from("lead_jobs").update({ status: "skipped", detail: "Signed" }).eq("lead_id", leadId).eq("status", "pending");
  await supabase.from("lead_events").insert({
    lead_id: leadId,
    event_type: "signed",
    actor: email,
    payload: { confirmed: true },
  });
  if (callrailConfigured() && before.callrail_call_id) {
    try {
      await pushCallrailTags(before.callrail_call_id, tags, LEAD_TAGS);
    } catch (err) {
      const message = err instanceof Error ? err.message : "CallRail did not take the tags.";
      throw new Error(`Signed on the lead. CallRail did not take the tags. ${message}`);
    }
  }
  revalidatePath("/");
  revalidatePath(`/leads/${leadId}`);
}

export async function saveLeadTags(leadId: string, formData: FormData) {
  const { supabase, email } = await requireStaff();
  const { data: before, error } = await supabase
    .from("leads")
    .select("id, signed_case, desired_case, caller_class, callrail_call_id, callrail_tags, qualified, decline_reason, consultation_date, grade, close_reason, lead_status")
    .eq("id", leadId)
    .maybeSingle();
  if (error || !before) throw new Error(error?.message ?? "Lead not found");

  const signed = Boolean(before.signed_case);
  const coverage = ["CVR DESIRED", "CVR SIGNED"].filter((tag) => (before.callrail_tags ?? []).includes(tag));
  const tagged = tagsFromSelection({
    qualified: String(formData.get("qualified_tag") ?? ""),
    coverage,
    decline: String(formData.get("decline_tag") ?? ""),
    signed,
    desired: Boolean(before.desired_case) || signed,
    nonPi: before.caller_class === "non_pi",
    size: String(formData.get("size_tag") ?? ""),
    injuryType: String(formData.get("injury_type") ?? ""),
    notQualified: String(formData.get("not_qualified_tag") ?? ""),
  });
  const { error: updateError } = await supabase
    .from("leads")
    .update({
      callrail_tags: tagged.tags,
      qualified: tagged.qualified,
      decline_reason: tagged.decline_reason,
    })
    .eq("id", leadId);
  if (updateError) throw new Error(updateError.message);

  await supabase.from("lead_events").insert({
    lead_id: leadId,
    event_type: "callrail_tags",
    actor: email,
    payload: {
      from: before.callrail_tags ?? [],
      to: tagged.tags,
      decline_reason: tagged.decline_reason,
    },
  });

  if (callrailConfigured() && before.callrail_call_id) {
    try {
      await pushCallrailTags(before.callrail_call_id, tagged.tags, LEAD_TAGS);
    } catch (err) {
      const message = err instanceof Error ? err.message : "CallRail did not take the tags.";
      await supabase.from("lead_events").insert({
        lead_id: leadId,
        event_type: "callrail_tags",
        actor: email,
        payload: { error: message },
      });
      throw new Error(`Saved on the lead. CallRail did not take the tags. ${message}`);
    }
  }

  revalidatePath("/");
  revalidatePath(`/leads/${leadId}`);
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
