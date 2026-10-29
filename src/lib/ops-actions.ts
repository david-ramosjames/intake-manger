"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { callrailConfigured, fetchCallrailTags, pushCallrailTags } from "./callrail";
import { DATA_ERROR_CLASS, DATA_ERROR_TAG, EXCLUDED_CALLER_CLASSES, NON_LEAD_TAG, type ExcludedCallerClass } from "./caller-class";
import { DECLINE_TAGS, MANAGED_CALLRAIL_TAGS, NOT_A_LEAD_TAGS, QUALIFIED_NO, QUALIFIED_YES, declineReasonFromTag, injuryTagForCaseType, selectedDecline, tagsFromSelection } from "./tags";
import { dispatchDue } from "./dispatch";
import { callOutcomeLabel, isCallOutcome } from "./calls";
import { loadStaff, matchStaff } from "./identity";
import { firmUserId } from "./staff";
import { canonicalTextSequence, textSequenceLabel } from "./queue";
import { contractSent } from "./desired";
import { enrollFollowUp, enrollMissingFollowUps, stopFollowUp } from "./followup";
import { clockToMinutes, delayMinutes, isCallSequence, isCallbackWindow, type CadenceDay, type CallSequenceId } from "./sequences";
import { chicagoDay, chicagoLocalToIso } from "./time";
import { isPiCaseType, isSourceType, nameIsUnavailable, officialCaseType, standardLeadEmail } from "./leads";
import { isSourceCategory, leadSourceChoice } from "./source-options";
import { toE164 } from "./phone";
import { isPracticeTestPhone } from "./test-phone";
import { CLOSE_READY_COLUMNS, assertCloseReady, closeGaps, closeIncompleteMessage, referralCloseMessage, type ClosePath } from "./close-ready";
import { caseTypeIsLead, isLostLeadReason, LOST_LEAD_REASONS } from "./funnel";
import { referralAwaitingSend } from "./next-step";
import { isPlaceholderOwner } from "./talked-with";
import { requireAdmin, requireStaff } from "./session";
import { createSupabaseServiceClient } from "./supabase/service";
import { loadStoredPropertyDamageGuides } from "./property-damage-guides";
import { sendQuoText } from "./quo";
import { listQuoLines } from "./quo-settings";
import {
  DEFAULT_REFERRAL_SMS,
  isGuideReferral,
  isPracticeArea,
  renderPropertyDamageSms,
  renderReferralSms,
} from "./referrals";
import { LEAD_CHANNEL_ID, postToSlack, slackThreadParent } from "./slack";
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

export async function startTextSequence(
  _prev: { error: string } | null,
  formData: FormData,
): Promise<{ error: string } | null> {
  try {
    const { supabase, email } = await requireStaff();
    const leadId = text(formData, "lead_id");
    const sequence = canonicalTextSequence(text(formData, "sequence")) ?? "more-info";
    if (!leadId) return { error: "Missing the lead." };
    if (!canonicalTextSequence(sequence)) return { error: "Choose a text sequence." };
    const { data: lead, error } = await supabase
      .from("leads")
      .select("id, phone, phone_e164, lead_name, case_type, signed_case, case_id, lead_status, sequence, text_sequence_status, owner_name, slack_channel_id, slack_thread_ts, slack_message_ts, email")
      .eq("id", leadId)
      .maybeSingle();
    if (error || !lead) return { error: error?.message ?? "Lead not found" };
    if ((lead.text_sequence_status || "").toLowerCase() === "active") return { error: "A text sequence is already running." };
    const practiceTest = isPracticeTestPhone(lead.phone_e164 || lead.phone);
    if (!practiceTest && (lead.signed_case || lead.case_id || ["Lost", "Referred", "Promoted", "Signed"].includes(lead.lead_status) || lead.sequence === "stop")) {
      return { error: "This lead is closed, so a text sequence stays off." };
    }
    const phone = lead.phone_e164 || lead.phone;
    if (!phone) return { error: "This lead has no phone number." };
    const staff = await loadStaff(supabase);
    const owner = matchStaff(lead.owner_name, staff);
    const usableName = nameIsUnavailable(lead.lead_name) ? "" : (lead.lead_name || "").trim();
    const [first, ...rest] = usableName.split(/\s+/).filter(Boolean);
    const result = await askSmsFollowUp({
      phone,
      sequence_slug: sequence,
      first_name: first || null,
      last_name: rest.join(" ") || null,
      case_type: lead.case_type,
      assigned_slack_user_id: owner?.slackUserId || null,
      assigned_slack_user_name: owner?.slackUserId ? owner.name : null,
      slack_channel_id: lead.slack_channel_id,
      slack_thread_ts: lead.slack_thread_ts || lead.slack_message_ts,
      lead_detail: { email: lead.email, started_by: email },
    });
    if (!result.ok) return { error: textSequenceError(result.reason) };
    const slug = canonicalTextSequence(result.sequence?.slug) || sequence;
    if (slug !== sequence) {
      const started = textSequenceLabel(result.sequence?.slug) ?? "a different sequence";
      const stopped = await askSmsFollowUpStop(phone, email);
      if (stopped.ok || stopped.reason === "no_active_enrollment") {
        return { error: `That started ${started} instead of ${textSequenceLabel(sequence)}. It was stopped.` };
      }
      return { error: `SMS Follow-Up started ${started} instead of ${textSequenceLabel(sequence)}.` };
    }
    const { error: updateError } = await supabase
      .from("leads")
      .update({
        text_sequence_slug: slug,
        text_sequence_status: "active",
        text_next_at: result.next_run_at ?? null,
      })
      .eq("id", leadId);
    if (updateError) return { error: updateError.message };
    await supabase.from("lead_events").insert({
      lead_id: leadId,
      event_type: "text_sequence_started",
      actor: email,
      payload: { sequence: slug, label: textSequenceLabel(slug) },
    });
    revalidatePath("/");
    revalidatePath("/priority");
    revalidatePath(`/leads/${leadId}`);
    return null;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "The text sequence could not be started." };
  }
}

export async function stopTextSequence(
  _prev: { error: string } | null,
  formData: FormData,
): Promise<{ error: string } | null> {
  try {
    const { supabase, email } = await requireStaff();
    const leadId = text(formData, "lead_id");
    if (!leadId) return { error: "Missing the lead." };
    const { data: lead, error } = await supabase
      .from("leads")
      .select("id, phone, phone_e164")
      .eq("id", leadId)
      .maybeSingle();
    if (error || !lead) return { error: error?.message ?? "Lead not found" };
    const phone = lead.phone_e164 || lead.phone;
    if (!phone) return { error: "This lead has no phone number." };
    const result = await askSmsFollowUpStop(phone, email);
    if (!result.ok && result.reason !== "no_active_enrollment") return { error: textSequenceError(result.reason) };
    const { error: updateError } = await supabase
      .from("leads")
      .update({ text_sequence_status: "stopped", text_next_at: null })
      .eq("id", leadId);
    if (updateError) return { error: updateError.message };
    await supabase.from("lead_events").insert({
      lead_id: leadId,
      event_type: "text_sequence_stopped",
      actor: email,
      payload: { stopped: result.stopped ?? 0 },
    });
    revalidatePath("/");
    revalidatePath("/priority");
    revalidatePath(`/leads/${leadId}`);
    return null;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "The text sequences could not be stopped." };
  }
}

async function askSmsFollowUp(body: Record<string, unknown>): Promise<{
  ok: boolean;
  reason?: string;
  next_run_at?: string | null;
  sequence?: { slug?: string };
}> {
  const base = process.env.SMS_FOLLOWUP_URL?.replace(/\/$/, "");
  const token = process.env.SMS_FOLLOWUP_TOKEN || process.env.INTAKE_ENROLL_TOKEN;
  if (!base || !token) return { ok: false, reason: "not_configured" };
  const response = await fetch(`${base}/api/intake/enroll`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => null)) as {
    ok?: boolean;
    reason?: string;
    next_run_at?: string | null;
    sequence?: { slug?: string };
  } | null;
  if (!data) return { ok: false, reason: "unreachable" };
  return { ok: Boolean(data.ok), reason: data.reason, next_run_at: data.next_run_at, sequence: data.sequence };
}

async function askSmsFollowUpStop(phone: string, actor: string): Promise<{ ok: boolean; reason?: string; stopped?: number }> {
  const base = process.env.SMS_FOLLOWUP_URL?.replace(/\/$/, "");
  const token = process.env.SMS_FOLLOWUP_TOKEN || process.env.INTAKE_ENROLL_TOKEN;
  if (!base || !token) return { ok: false, reason: "not_configured" };
  const response = await fetch(`${base}/api/intake/stop`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ phone, actor }),
  });
  const data = (await response.json().catch(() => null)) as { ok?: boolean; reason?: string; stopped?: number } | null;
  if (!data) return { ok: false, reason: "unreachable" };
  return { ok: Boolean(data.ok), reason: data.reason, stopped: data.stopped };
}

function textSequenceError(reason: string | undefined): string {
  if (reason === "not_configured") return "SMS Follow-Up is not connected yet.";
  if (reason === "unreachable" || reason === "unauthorized" || reason === "no_firm") return "SMS Follow-Up did not accept the sequence.";
  if (reason === "invalid_phone") return "That phone number cannot take a text sequence.";
  if (reason === "already_active") return "A text sequence is already running for this number.";
  if (reason === "opted_out") return "This number has opted out of texts.";
  if (reason === "sequence_not_found") return "That sequence is not set up.";
  if (reason === "sequence_inactive") return "That sequence is switched off.";
  if (reason === "no_steps") return "That sequence has no texts yet.";
  if (reason === "missing_assignee") return "Set who owns automatic texts in SMS Follow-Up before starting one.";
  if (reason?.startsWith("lead_decision:")) return "This lead is closed, so a text sequence stays off.";
  return "The text sequence could not be started.";
}

export async function setQualified(formData: FormData) {
  const decision = text(formData, "decision");
  if (decision !== "yes" && decision !== "no") throw new Error("Choose yes or no.");
  const qualified = decision === "yes";
  await saveQueueMilestone(formData, {
    event: "qualified_set",
    payload: qualified ? { qualified } : { qualified, desired: false },
    patch: qualified ? { qualified } : { qualified, desired_case: false, desired_source: "staff" },
    tags(current) {
      const tags = current.filter((tag) => tag !== "QUALIFIED YES" && tag !== "QUALIFIED NO" && (qualified || tag !== "CVR DESIRED"));
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
  const declined = text(formData, "consulted") === "no";
  const consultationDate = !declined && raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
  const { error } = await supabase
    .from("leads")
    .update({
      consultation_date: consultationDate,
      consultation: consultationDate ? "staff" : declined ? "no" : null,
    })
    .eq("id", leadId);
  if (error) throw new Error(error.message);
  await supabase.from("lead_events").insert({
    lead_id: leadId,
    event_type: "consultation_set",
    actor: email,
    payload: { consultation_date: consultationDate, consultation: consultationDate ? "staff" : declined ? "no" : null },
  });
  revalidatePath("/");
  revalidatePath("/priority");
  revalidatePath("/review");
  revalidatePath(`/leads/${leadId}`);
}

export async function setNextAction(formData: FormData) {
  const { supabase, email } = await requireStaff();
  const leadId = text(formData, "lead_id");
  if (!leadId) throw new Error("Missing the lead.");
  const callJobId = text(formData, "call_job_id");
  const callAt = text(formData, "call_at");
  const reminderAt = text(formData, "reminder_at");
  const tag = text(formData, "tag");

  if (callAt) {
    const due = chicagoLocalToIso(callAt);
    const assigned = tag || "Outbound";
    const detail = !tag || tag === "Outbound" ? "Tag Slack Outbound." : `Tag ${tag}.`;
    let jobId = callJobId;
    if (!jobId) {
      const { data: existing } = await supabase
        .from("lead_jobs")
        .select("id")
        .eq("lead_id", leadId)
        .eq("queue", "call")
        .eq("status", "pending")
        .order("position", { ascending: true })
        .limit(1)
        .maybeSingle();
      jobId = existing?.id ?? "";
    }
    if (jobId) {
      const { data: job, error } = await supabase
        .from("lead_jobs")
        .select("id, lead_id, queue, status")
        .eq("id", jobId)
        .maybeSingle();
      if (error || !job || job.lead_id !== leadId || job.queue !== "call" || job.status !== "pending") {
        throw new Error(error?.message ?? "That call is no longer on the schedule.");
      }
      const { error: updateError } = await supabase
        .from("lead_jobs")
        .update({ due_at: due, assigned_name: assigned, mention: null, detail })
        .eq("id", jobId);
      if (updateError) throw new Error(updateError.message);
    } else {
      const { data: lead } = await supabase
        .from("leads")
        .select("sequence, consultation_date, lead_status, signed_case, case_id")
        .eq("id", leadId)
        .maybeSingle();
      if (!lead) throw new Error("Lead not found");
      if (lead.signed_case || lead.case_id || ["Lost", "Referred", "Promoted", "Signed"].includes(String(lead.lead_status))) {
        throw new Error("Reopen this lead before scheduling Slack call reminders.");
      }
      // lead_jobs.sequence uses first_talk/more_info; leads.sequence only allows null/stop/legacy labels.
      const jobSequence = lead.consultation_date ? "more_info" : "first_talk";
      const { error: insertError } = await supabase.from("lead_jobs").insert({
        lead_id: leadId,
        queue: "call",
        sequence: jobSequence,
        position: 1,
        due_at: due,
        body: lead.consultation_date ? "Call to reconnect after the consultation." : "Call the lead.",
        status: "pending",
        assigned_name: assigned,
        detail,
      });
      if (insertError) throw new Error(insertError.message);
      await supabase
        .from("leads")
        .update({ follow_up: true, sequence: lead.sequence === "stop" ? null : lead.sequence })
        .eq("id", leadId);
    }
    await supabase.from("lead_events").insert({
      lead_id: leadId,
      event_type: "next_action",
      actor: email,
      payload: { queue: "call", due_at: due, assigned_name: assigned },
    });
  }

  if (reminderAt) {
    const due = chicagoLocalToIso(reminderAt);
    const { error } = await supabase.from("leads").update({ agreement_next_reminder_at: due }).eq("id", leadId);
    if (error) throw new Error(error.message);
    await supabase.from("lead_events").insert({
      lead_id: leadId,
      event_type: "next_action",
      actor: email,
      payload: { queue: "reminder", due_at: due },
    });
  }

  revalidatePath("/");
  revalidatePath("/work");
  revalidatePath("/priority");
  revalidatePath("/open-calls");
  revalidatePath(`/leads/${leadId}`);
}

export async function setTalkedWith(formData: FormData) {
  const { supabase, email } = await requireStaff();
  const leadId = text(formData, "lead_id");
  if (!leadId) throw new Error("Missing the lead.");
  const written = text(formData, "owner_name");
  const name = !written || isPlaceholderOwner(written) ? "Outbound" : written;
  const { data: lead, error } = await supabase
    .from("leads")
    .select("id, consultation_date")
    .eq("id", leadId)
    .maybeSingle();
  if (error || !lead) throw new Error(error?.message ?? "Lead not found");
  const { error: updateError } = await supabase.from("leads").update({ owner_name: name }).eq("id", leadId);
  if (updateError) throw new Error(updateError.message);
  if (lead.consultation_date) {
    await supabase
      .from("lead_jobs")
      .update({
        assigned_name: name,
        mention: null,
        detail: name ? `Tag ${name}.` : "Choose who handled this.",
      })
      .eq("lead_id", leadId)
      .eq("queue", "call")
      .eq("status", "pending");
  }
  await supabase.from("lead_events").insert({
    lead_id: leadId,
    event_type: "talked_with",
    actor: email,
    payload: { owner_name: name },
  });
  revalidatePath("/");
  revalidatePath("/priority");
  revalidatePath("/review");
  revalidatePath("/open-calls");
  revalidatePath(`/leads/${leadId}`);
}

export async function saveLeadDetails(formData: FormData) {
  const { supabase, email: actor, admin } = await requireStaff();
  const leadId = text(formData, "lead_id");
  if (!leadId) throw new Error("Missing the lead.");
  const caseType = text(formData, "case_type") || null;
  const writtenSource = leadSourceChoice(text(formData, "lead_source"));
  const leadSource = writtenSource.source || null;
  const chosenType = text(formData, "source_type");
  const sourceType = isSourceType(chosenType) ? chosenType : writtenSource.type || null;
  const leadName = text(formData, "lead_name");
  const phone = text(formData, "phone");
  const contactEmail = standardLeadEmail(text(formData, "email"));
  const leadDate = text(formData, "lead_date");
  const phoneE164 = phone ? toE164(phone) : null;
  const keepPhone = formData.get("keep_phone") === "1";
  if (!keepPhone && phone && !phoneE164) throw new Error("Enter a 10-digit phone number.");
  const consulted = text(formData, "consulted");
  const consultationDate = text(formData, "consultation_date");
  if (consulted === "yes" && !/^\d{4}-\d{2}-\d{2}$/.test(consultationDate ?? "")) {
    throw new Error("Enter the consultation date.");
  }
  const signedDecision = text(formData, "signed_decision");
  const signedDate = text(formData, "date_signed");
  if (admin && signedDecision === "yes" && !/^\d{4}-\d{2}-\d{2}$/.test(signedDate ?? "")) {
    throw new Error("Enter the signed date.");
  }
  const { data: before, error: loadError } = await supabase
    .from("leads")
    .select("caller_class, close_suggestion, close_reason, lead_status, signed_case, date_signed, callrail_tags, callrail_call_id, qualified, desired_case")
    .eq("id", leadId)
    .maybeSingle();
  if (loadError || !before) throw new Error(loadError?.message ?? "Lead not found");
  const patch: Record<string, string | null> = {
    lead_name: leadName,
    email: contactEmail,
    case_type: caseType,
    lead_source: leadSource,
    source_type: sourceType,
  };
  if (formData.has("source_category")) {
    const chosenCategory = text(formData, "source_category");
    patch.source_category = isSourceCategory(chosenCategory) ? chosenCategory : null;
  }
  if (!keepPhone) {
    patch.phone = phone;
    patch.phone_e164 = phoneE164;
  }
  if (leadName) {
    patch.identity_status = "confirmed";
    patch.identity_evidence = null;
  }
  if (formData.has("lead_date")) patch.lead_date = leadDate && /^\d{4}-\d{2}-\d{2}$/.test(leadDate) ? leadDate : null;
  if (consulted === "yes") {
    patch.consultation = "staff";
    patch.consultation_date = consultationDate;
  } else if (consulted === "no") {
    patch.consultation = "no";
    patch.consultation_date = null;
  }
  const officialType = officialCaseType(caseType);
  patch.case_type = officialType && officialType !== "Unknown / No Response" ? officialType : caseType ? "TBD" : null;
  const excludedCaller =
    before.caller_class === DATA_ERROR_CLASS ||
    EXCLUDED_CALLER_CLASSES.includes(before.caller_class as ExcludedCallerClass);
  if (officialType === "Non-PI Legal Matter") {
    patch.caller_class = "non_pi";
    patch.close_suggestion = "decline";
  } else if (isPiCaseType(caseType) && before.caller_class === "non_pi") {
    patch.caller_class = null;
    patch.practice_area = "personal_injury";
    if (before.close_suggestion === "decline") patch.close_suggestion = null;
  } else if (caseTypeIsLead(patch.case_type) && excludedCaller) {
    // Open leads require null/non_pi caller_class. Saving a real case type alone used to leave insurance/etc stuck in Non-leads.
    patch.caller_class = null;
  }
  if (patch.close_suggestion !== "decline" && before.close_suggestion === "not_a_lead" && caseTypeIsLead(patch.case_type)) {
    patch.close_suggestion = null;
  }
  const reopenNonLead =
    caseTypeIsLead(patch.case_type) &&
    before.lead_status === "Lost" &&
    (before.close_reason === "not_a_lead" || before.close_reason === DATA_ERROR_CLASS);
  if (reopenNonLead) {
    patch.lead_status = "Working";
    patch.close_reason = null;
    patch.close_suggestion = null;
  }
  const { error } = await supabase.from("leads").update(reopenNonLead ? { ...patch, follow_up: true, sequence: null } : patch).eq("id", leadId);
  if (error) throw new Error(error.message);
  if (reopenNonLead || (caseTypeIsLead(patch.case_type) && excludedCaller)) {
    await supabase.from("lead_events").insert({
      lead_id: leadId,
      event_type: "non_lead_restored",
      actor,
      payload: {
        from_caller_class: before.caller_class,
        from_close_reason: before.close_reason,
        case_type: patch.case_type,
      },
    });
  }
  await supabase.from("lead_events").insert({
    lead_id: leadId,
    event_type: "lead_details",
    actor,
    payload: { case_type: caseType, lead_source: leadSource, source_type: sourceType, lead_name: leadName },
  });
  // Close as Lost first so CallRail / revalidate failures cannot leave the lead open.
  const lostDecision = text(formData, "lost_decision");
  const lostReasonValue = text(formData, "lost_reason");
  let closed = false;
  // Staff choosing Lost = No means reopen — do not auto-close again as undesired on this Save.
  let skipAutoClose = lostDecision === "no";
  if (lostDecision === "yes" || lostDecision === "no") {
    closed = await applyLostLeadDecision(supabase, leadId, actor, lostDecision, lostReasonValue);
  }
  let qualifiedDecision = text(formData, "qualified_decision");
  let desiredDecision = text(formData, "desired_decision");
  let declineTag = text(formData, "decline_tag") ?? "";
  if (officialType === "Non-PI Legal Matter") {
    qualifiedDecision = "no";
    desiredDecision = "no";
    declineTag = "DEC: Non-PI Legal Matter";
  } else if (qualifiedDecision === "no") {
    desiredDecision = "no";
  }
  if (!closed && (qualifiedDecision === "yes" || qualifiedDecision === "no" || desiredDecision === "yes" || desiredDecision === "no" || desiredDecision === "tbd")) {
    const qualifiedTag = qualifiedDecision === "yes" ? QUALIFIED_YES : qualifiedDecision === "no" ? QUALIFIED_NO : "";
    const desired = desiredDecision === "yes";
    const tagged = tagsFromSelection({
      qualified: qualifiedTag,
      coverage: ["CVR DESIRED", "CVR SIGNED"].filter((tag) => (before.callrail_tags ?? []).includes(tag)),
      decline: declineTag,
      desired,
      signed: Boolean(before.signed_case),
      nonPi: officialType === "Non-PI Legal Matter",
      size: text(formData, "size_tag") ?? "",
      injuryType: injuryTagForCaseType(patch.case_type),
      requireQualified: Boolean(qualifiedTag),
    });
    const milestone: Record<string, unknown> = {
      callrail_tags: tagged.tags,
      decline_reason: tagged.decline_reason,
    };
    if (tagged.qualified === true || tagged.qualified === false) milestone.qualified = tagged.qualified;
    if (desiredDecision === "yes" || desiredDecision === "no" || desiredDecision === "tbd") {
      milestone.desired_case = desiredDecision === "yes" ? true : desiredDecision === "no" ? false : null;
      milestone.desired_source = "staff";
    }
    if (qualifiedDecision === "yes" && before.close_suggestion === "not_a_lead") milestone.close_suggestion = null;
    const { error: milestoneError } = await supabase.from("leads").update(milestone).eq("id", leadId);
    if (milestoneError) throw new Error(milestoneError.message);
    if (callrailConfigured() && before.callrail_call_id) {
      try {
        await pushCallrailTags(before.callrail_call_id, tagged.tags, MANAGED_CALLRAIL_TAGS);
      } catch (err) {
        const message = err instanceof Error ? err.message : "CallRail did not take the tags.";
        throw new Error(`Saved on the lead. CallRail did not take the tags. ${message}`);
      }
    }
  }
  if (!closed && admin && (signedDecision === "yes" || signedDecision === "no")) {
    const wantSigned = signedDecision === "yes";
    const nextDate = wantSigned ? signedDate : null;
    const same = Boolean(before.signed_case) === wantSigned && (before.date_signed ?? null) === nextDate;
    if (!same) {
      const signedPatch: { signed_case: boolean; date_signed: string | null; signed_at?: string | null } = {
        signed_case: wantSigned,
        date_signed: nextDate,
      };
      if (!wantSigned) signedPatch.signed_at = null;
      else if (!before.signed_case) signedPatch.signed_at = new Date().toISOString();
      const { error: signedError } = await supabase.from("leads").update(signedPatch).eq("id", leadId);
      if (signedError) throw new Error(signedError.message);
      await supabase.from("lead_events").insert({
        lead_id: leadId,
        event_type: "signed_override",
        actor,
        payload: signedPatch,
      });
    }
  }
  const signedNow = admin && signedDecision === "yes";
  if (!closed && signedNow) await markSignedQualified(supabase, leadId);
  if (!closed && !skipAutoClose) {
    closed = signedNow
      ? await closeSignedLead(supabase, leadId, actor)
      : officialCaseType(caseType) === "Non-PI Legal Matter"
        ? await settleNonPiLead(supabase, leadId, actor)
        : await closeUndesiredLead(supabase, leadId, actor);
  }
  revalidatePath("/work");
  revalidatePath("/");
  revalidatePath("/priority");
  revalidatePath("/review");
  revalidatePath("/open-calls");
  revalidatePath(`/leads/${leadId}`);
  return { closed };
}

/** Signing makes the lead qualified and desired. Size is still required before it can close. */
async function markSignedQualified(
  supabase: Awaited<ReturnType<typeof requireStaff>>["supabase"],
  leadId: string,
) {
  const { data: lead, error } = await supabase.from("leads").select("callrail_tags").eq("id", leadId).maybeSingle();
  if (error || !lead) throw new Error(error?.message ?? "Lead not found");
  const tags = (lead.callrail_tags ?? []).filter((tag: string) => tag !== QUALIFIED_NO && tag !== QUALIFIED_YES && !tag.startsWith("DEC:"));
  tags.push(QUALIFIED_YES, "CVR DESIRED");
  if (!tags.includes("CVR SIGNED")) tags.push("CVR SIGNED");
  const { error: updateError } = await supabase
    .from("leads")
    .update({ qualified: true, desired_case: true, desired_source: "staff", callrail_tags: tags, decline_reason: null })
    .eq("id", leadId);
  if (updateError) throw new Error(updateError.message);
}

async function closeSignedLead(
  supabase: Awaited<ReturnType<typeof requireStaff>>["supabase"],
  leadId: string,
  actor: string,
): Promise<boolean> {
  const { data: lead, error } = await supabase
    .from("leads")
    .select(`lead_status, case_id, text_sequence_status, ${CLOSE_READY_COLUMNS}`)
    .eq("id", leadId)
    .maybeSingle();
  if (error || !lead) throw new Error(error?.message ?? "Lead not found");
  if (lead.lead_status === "Signed" || lead.lead_status === "Promoted") return false;
  if (lead.signed_case !== true) return false;
  if (closeGaps(lead, "signed").length) return false;
  await closeLead(supabase, leadId, actor, { lead_status: "Signed", close_reason: "signed", event: "signed", path: "signed" });
  if (lead.text_sequence_status === "active") {
    await supabase.from("leads").update({ text_sequence_status: "stopped" }).eq("id", leadId);
  }
  return true;
}

/** Non-PI stays open until the file is complete and a referral has been recorded. */
async function settleNonPiLead(
  supabase: Awaited<ReturnType<typeof requireStaff>>["supabase"],
  leadId: string,
  actor: string,
): Promise<boolean> {
  const { data: lead, error } = await supabase
    .from("leads")
    .select(`lead_status, case_id, close_reason, text_sequence_status, ${CLOSE_READY_COLUMNS}`)
    .eq("id", leadId)
    .maybeSingle();
  if (error || !lead) throw new Error(error?.message ?? "Lead not found");
  const { count, error: sendError } = await supabase
    .from("referral_sends")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", leadId);
  if (sendError) throw new Error(sendError.message);
  const recorded = (count ?? 0) > 0 || lead.lead_status === "Referred" || lead.close_reason === "referred" || lead.close_reason === "declined";
  const gaps = closeGaps(lead, "declined");
  const finished = lead.close_reason === "declined" ? gaps.length === 0 : recorded && gaps.length === 0;
  if (!finished) {
    if (lead.lead_status === "Lost" || lead.lead_status === "Referred" || lead.close_reason) {
      const { error: reopenError } = await supabase
        .from("leads")
        .update({
          lead_status: "Working",
          close_reason: null,
          close_suggestion: "decline",
          follow_up: false,
        })
        .eq("id", leadId);
      if (reopenError) throw new Error(reopenError.message);
      await supabase.from("lead_events").insert({
        lead_id: leadId,
        event_type: "lost_lead_reopened",
        actor,
        payload: { reason: "non_pi_file_open" },
      });
    }
    return false;
  }
  if (lead.lead_status === "Referred" || lead.close_reason === "referred") {
    if (lead.lead_status !== "Referred" || lead.close_reason !== "referred") {
      await closeLead(supabase, leadId, actor, { lead_status: "Referred", close_reason: "referred", event: "referred", path: "declined" });
    } else {
      await supabase.from("leads").update({ close_suggestion: null }).eq("id", leadId);
    }
    return true;
  }
  if (lead.close_reason === "declined") return true;
  await closeLead(supabase, leadId, actor, { lead_status: "Referred", close_reason: "referred", event: "referred", path: "declined" });
  if (lead.text_sequence_status === "active") {
    await supabase.from("leads").update({ text_sequence_status: "stopped" }).eq("id", leadId);
  }
  return true;
}

/** A finished lead that is not desired has reached the end of the path, so saving closes it. */
async function closeUndesiredLead(
  supabase: Awaited<ReturnType<typeof requireStaff>>["supabase"],
  leadId: string,
  actor: string,
): Promise<boolean> {
  const { data: lead, error } = await supabase
    .from("leads")
    .select(`lead_status, case_id, text_sequence_status, ${CLOSE_READY_COLUMNS}`)
    .eq("id", leadId)
    .maybeSingle();
  if (error || !lead) throw new Error(error?.message ?? "Lead not found");
  if (lead.signed_case || lead.case_id) return false;
  if (lead.lead_status === "Signed" || lead.lead_status === "Promoted" || lead.lead_status === "Lost" || lead.lead_status === "Referred") return false;
  if (lead.desired_case !== false) return false;
  if (closeGaps(lead, "declined").length) return false;
  if (referralAwaitingSend(lead)) return false;
  const referred = (lead.callrail_tags ?? []).includes("DEC: Referred");
  await closeLead(
    supabase,
    leadId,
    actor,
    referred
      ? { lead_status: "Referred", close_reason: "referred", event: "referred", path: "declined" }
      : { lead_status: "Lost", close_reason: "declined", event: "declined", path: "declined" },
  );
  if (lead.text_sequence_status === "active") {
    await supabase.from("leads").update({ text_sequence_status: "stopped" }).eq("id", leadId);
  }
  return true;
}

export async function setDesired(formData: FormData) {
  const decision = text(formData, "decision");
  if (decision !== "yes" && decision !== "no") throw new Error("Choose yes or no.");
  const { supabase } = await requireStaff();
  const leadId = text(formData, "lead_id");
  if (!leadId) throw new Error("Missing the lead.");
  const { data: before, error } = await supabase
    .from("leads")
    .select("agreement_status, agreement_sent_at, signed_case, qualified")
    .eq("id", leadId)
    .maybeSingle();
  if (error || !before) throw new Error(error?.message ?? "Lead not found");
  if (decision === "yes" && before.qualified === false) throw new Error("A lead that is not qualified is not desired.");
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
      await pushCallrailTags(before.callrail_call_id, tags, MANAGED_CALLRAIL_TAGS);
    } catch (err) {
      const message = err instanceof Error ? err.message : "CallRail did not take the tags.";
      throw new Error(`Saved on the lead. CallRail did not take the tags. ${message}`);
    }
  }
  revalidatePath("/");
  revalidatePath("/priority");
  revalidatePath("/review");
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
    .select("id, kind, follow_up, lead_name, case_type, signed_case, case_id, lead_status, arrival, owner_name, agreement_status, agreement_sent_at, priority, created_at, consultation_date, lead_date, phone, phone_e164")
    .eq("id", leadId)
    .maybeSingle();
  if (error || !lead) throw new Error(error?.message ?? "Lead not found");
  if (!isPracticeTestPhone(lead.phone_e164 || lead.phone) && (lead.signed_case || lead.case_id || ["Lost", "Referred", "Promoted", "Signed"].includes(lead.lead_status))) {
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
  const staff = await loadStaff(supabase);
  const person = assigned ? matchStaff(assigned, staff) : null;
  const { data: lead } = await supabase.from("leads").select("consultation_date").eq("id", job.lead_id).maybeSingle();
  const consulted = Boolean(lead?.consultation_date);
  const { error: updateError } = await supabase
    .from("lead_jobs")
    .update({
      due_at: chicagoLocalToIso(due),
      assigned_name: assigned,
      mention: person?.slackUserId || null,
      detail: assigned ? `Tag ${assigned}.` : consulted ? "Choose who handled this." : "Outbound from #lead-calls topic.",
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
  revalidatePath("/open-calls");
  revalidatePath("/priority");
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
  revalidatePath("/");
  revalidatePath("/open-calls");
  revalidatePath("/queues");
}

export async function classifyNonLead(formData: FormData) {
  const { supabase, email } = await requireStaff();
  const leadId = text(formData, "lead_id");
  const callerClass = text(formData, "caller_class");
  if (!leadId) throw new Error("Missing the lead.");
  const dataError = callerClass === DATA_ERROR_CLASS;
  if (!dataError && !EXCLUDED_CALLER_CLASSES.includes(callerClass as ExcludedCallerClass)) {
    throw new Error("Choose why this is not a lead.");
  }
  const { data, error } = await supabase
    .from("leads")
    .select("id, signed_case, case_id, lead_status, text_sequence_status, callrail_call_id, callrail_tags, identity_status, caller_class, case_type")
    .eq("id", leadId)
    .maybeSingle();
  if (error || !data) throw new Error(error?.message ?? "Lead not found");
  if (data.signed_case || data.case_id || data.lead_status === "Signed" || data.lead_status === "Promoted") {
    throw new Error("A signed or promoted matter stays a lead.");
  }
  assertCloseReady(data, "nonlead");
  const stopped = data.text_sequence_status === "active" ? "stopped" : data.text_sequence_status;
  if (dataError) {
    const badCallTags = new Set<string>([
      ...NOT_A_LEAD_TAGS,
      "NQ: Non-PI Legal Matter",
      "DEC: Non-PI Legal Matter",
      "QUALIFIED YES",
      "CVR DESIRED",
    ]);
    const tags = ((data.callrail_tags as string[] | null) ?? []).filter((tag) => !badCallTags.has(tag));
    if (!tags.includes(DATA_ERROR_TAG)) tags.push(DATA_ERROR_TAG);
    const { error: updateError } = await supabase
      .from("leads")
      .update({
        lead_status: "Lost",
        follow_up: false,
        sequence: "stop",
        close_reason: DATA_ERROR_CLASS,
        close_suggestion: null,
        caller_class: DATA_ERROR_CLASS,
        callrail_tags: tags,
        text_sequence_status: stopped,
      })
      .eq("id", leadId);
    if (updateError) throw new Error(updateError.message);
    await stopFollowUp(supabase, leadId, "Data error");
    await supabase.from("lead_events").insert({
      lead_id: leadId,
      event_type: "data_error",
      actor: email,
      payload: { caller_class: DATA_ERROR_CLASS, tag: DATA_ERROR_TAG },
    });
    revalidatePath("/");
    revalidatePath("/priority");
    revalidatePath(`/leads/${leadId}`);
    return;
  }
  const reason = callerClass as ExcludedCallerClass;
  const drop = new Set<string>([
    ...NOT_A_LEAD_TAGS,
    DATA_ERROR_TAG,
    "NQ: Spam / Robo Call",
    "NQ: Outside Service Area",
    "NQ: Non-PI Legal Matter",
    "DEC: Non-PI Legal Matter",
    "QUALIFIED YES",
    "CVR DESIRED",
  ]);
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
      desired_case: false,
      desired_source: "staff",
      callrail_tags: tags,
      text_sequence_status: stopped,
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
      await pushCallrailTags(data.callrail_call_id, tags, MANAGED_CALLRAIL_TAGS);
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
    .select("id, signed_case, case_id, lead_status, text_sequence_status, consultation_date, grade, callrail_tags, decline_reason, qualified, identity_status, caller_class, case_type")
    .eq("id", leadId)
    .maybeSingle();
  if (error || !data) throw new Error(error?.message ?? "Lead not found");
  if (data.signed_case || data.case_id || data.lead_status === "Signed" || data.lead_status === "Promoted") {
    throw new Error("A signed or promoted matter stays open.");
  }
  assertCloseReady(data, "nonlead");
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
  const tags = ((current?.callrail_tags as string[] | null) ?? []).filter((tag) => tag !== "QUALIFIED YES" && tag !== "NQ: Non-PI Legal Matter");
  if (outside) {
    if (!tags.includes("QUALIFIED NO")) tags.push("QUALIFIED NO");
    if (!tags.includes("DEC: Non-PI Legal Matter")) tags.push("DEC: Non-PI Legal Matter");
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

const DECLINE_TAG_SET = new Set<string>(DECLINE_TAGS);

function referralBlockMessage(gaps: string[]): string {
  return referralCloseMessage(gaps);
}

function referralDeclineTag(
  formData: FormData | undefined,
  lead: { callrail_tags?: string[] | null },
  area: string | null,
  infer: boolean,
): string {
  const chosen = formData ? text(formData, "decline_tag") : null;
  if (chosen && DECLINE_TAG_SET.has(chosen)) return chosen;
  const existing = selectedDecline(lead.callrail_tags ?? []);
  if (existing) return existing;
  if (!infer) return "";
  if (area === "workers_comp") return "DEC: Workers Comp";
  if (area === "medmal") return "DEC: Medmal";
  if (area === "property_damage") return "DEC: Minor Injury / Property Damage";
  return "";
}

async function stampReferralDecision(
  supabase: Awaited<ReturnType<typeof requireStaff>>["supabase"],
  leadId: string,
  lead: { desired_case?: boolean | null; callrail_tags?: string[] | null },
  input: { desiredNo: boolean; declineTag: string },
): Promise<string | null> {
  const update: { desired_case?: boolean; desired_source?: string; callrail_tags?: string[]; decline_reason?: string | null } = {};
  if (input.desiredNo) {
    update.desired_case = false;
    update.desired_source = "staff";
    lead.desired_case = false;
  }
  if (input.declineTag) {
    const tags = (lead.callrail_tags ?? []).filter((tag) => !tag.startsWith("DEC:"));
    tags.push(input.declineTag);
    update.callrail_tags = tags;
    update.decline_reason = declineReasonFromTag(input.declineTag);
    lead.callrail_tags = tags;
  }
  if (!("desired_case" in update) && !update.callrail_tags) return null;
  const { error } = await supabase.from("leads").update(update).eq("id", leadId);
  return error?.message ?? null;
}

export async function sendReferral(leadId: string, formData: FormData): Promise<{ error?: string; gaps?: string[] }> {
  const { supabase, email } = await requireStaff();
  const destinationId = text(formData, "destination_id");
  const language = text(formData, "language") === "es" ? "es" : "en";
  const area = text(formData, "practice_area");
  const edited = text(formData, "message");
  const attorneyName = text(formData, "attorney_name");
  const attorneyPhone = text(formData, "attorney_phone");
  const guide = isGuideReferral(area);
  if (edited && edited.length > 2000) return { error: "Shorten the text before sending." };
  if (edited && edited.includes("{{")) {
    return { error: guide ? "Fill in the guide link in the text." : "Fill in the attorney and phone in the text." };
  }
  if (!guide && !destinationId && !attorneyName) return { error: "Enter the attorney." };
  if (!guide && !destinationId && !edited) return { error: "Write the text before sending." };
  if (!isPracticeArea(area)) return { error: "Choose the legal practice area." };
  let destination: {
    id: string;
    name: string;
    phone: string | null;
    address: string | null;
    email: string | null;
    website: string | null;
    practice_areas: string[] | null;
  } | null = null;
  if (!guide && destinationId) {
    const { data, error: loadError } = await supabase
      .from("referral_destinations")
      .select("id, name, phone, address, email, website, practice_areas, spanish, notes")
      .eq("id", destinationId)
      .maybeSingle();
    if (loadError || !data) return { error: loadError?.message ?? "That referral destination is missing." };
    if (!(data.practice_areas ?? []).includes(area)) return { error: "That attorney is not listed for this practice area." };
    destination = data;
  }

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select(`summary, slack_channel_id, slack_thread_ts, slack_message_ts, slack_permalink, ${CLOSE_READY_COLUMNS}`)
    .eq("id", leadId)
    .maybeSingle();
  if (leadError || !lead) return { error: leadError?.message ?? "Lead not found" };
  const declineTag = referralDeclineTag(formData, lead, area, true);
  const stampError = await stampReferralDecision(supabase, leadId, lead, {
    desiredNo: true,
    declineTag,
  });
  if (stampError) return { error: stampError };
  const stamped = {
    ...lead,
    desired_case: false as boolean,
    callrail_tags: declineTag
      ? Array.from(new Set([...(lead.callrail_tags ?? []).filter((tag: string) => !tag.startsWith("DEC:")), declineTag]))
      : lead.callrail_tags,
  };
  const gaps = closeGaps(stamped, "declined");
  if (gaps.length) return { error: referralBlockMessage(gaps), gaps };
  const to = lead.phone_e164 || toE164(lead.phone);
  if (!to) return { error: "This lead needs a phone number before the text can go out." };

  const [{ data: templates }, guides] = await Promise.all([
    supabase.from("referral_templates").select("language, body"),
    loadStoredPropertyDamageGuides(),
  ]);
  const stored = (templates ?? []).find((row) => row.language === language)?.body;
  if (guide && !(language === "es" ? guides.es.trim() : guides.en.trim())) {
    return { error: "Save the property damage guide links on the Referrals page first." };
  }
  const message =
    edited ||
    (guide
      ? renderPropertyDamageSms({ language, leadName: lead.lead_name, guides })
      : destination
        ? renderReferralSms({
            language,
            template: stored || DEFAULT_REFERRAL_SMS[language],
            leadName: lead.lead_name,
            area,
            destination,
          })
        : "");
  if (!message) return { error: "Write the text before sending." };
  const sent = await sendQuoText(to, message);
  if (!sent.ok) return { error: `${sent.error} The lead is still open.` };

  const note = text(formData, "note");
  const outside = area !== "personal_injury";
  const threadTs = slackThreadParent(lead);
  const guideLabel = "Property damage guide";
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
      ...(lead.slack_thread_ts || !threadTs ? {} : { slack_thread_ts: threadTs }),
    })
    .eq("id", leadId);
  if (updateError) return { error: `The text was sent. The lead did not close: ${updateError.message}` };
  await stopFollowUp(supabase, leadId, "Referred out.");
  const { error } = await supabase.from("referral_sends").insert({
    lead_id: leadId,
    destination_id: destination?.id ?? null,
    attorney_name: destination ? null : guide ? guideLabel : attorneyName,
    actor: email,
    note,
    language,
    message,
  });
  if (error) return { error: `The text was sent and the lead was closed. The referral log did not save: ${error.message}` };
  await supabase.from("lead_events").insert({
    lead_id: leadId,
    event_type: "referred",
    actor: email,
    payload: {
      destination: destination?.name ?? (guide ? guideLabel : attorneyName) ?? null,
      phone: destination?.phone ?? attorneyPhone ?? null,
      language,
      message,
      guide: guide || undefined,
    },
  });

  const who = lead.lead_name || "Unnamed lead";
  const slack = await loadSlackSettings();
  const namedAttorney = destination?.name || (guide ? guideLabel : attorneyName);
  const namedPhone = destination?.phone || attorneyPhone;
  const attorneyLine = guide
    ? `${language === "es" ? "Spanish" : "English"} property damage guide text to the lead.`
    : namedAttorney
      ? `${language === "es" ? "Spanish" : "English"} text to the lead with ${namedAttorney}${namedPhone ? ` ${namedPhone}` : ""}.`
      : `${language === "es" ? "Spanish" : "English"} text to the lead.`;
  if (slack.posting) {
    await postToSlack({
      token: slack.token,
      channel: lead.slack_channel_id || slack.channelId || LEAD_CHANNEL_ID,
      threadTs,
      text: [`Referral sent: ${who}${lead.phone ? ` ${lead.phone}` : ""}`, attorneyLine, message].join("\n"),
    });
  }

  revalidatePath("/");
  revalidatePath("/review");
  revalidatePath(`/leads/${leadId}`);
  return {};
}

export async function markReferralSent(leadId: string, formData?: FormData): Promise<{ error?: string }> {
  return recordReferralOutcome(leadId, "sent", formData);
}

export async function markReferralDeclined(leadId: string, formData?: FormData): Promise<{ error?: string; gaps?: string[] }> {
  return recordReferralOutcome(leadId, "declined", formData);
}

async function recordReferralOutcome(leadId: string, outcome: "sent" | "declined", formData?: FormData): Promise<{ error?: string; gaps?: string[] }> {
  const { supabase, email } = await requireStaff();
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select(`text_sequence_status, ${CLOSE_READY_COLUMNS}`)
    .eq("id", leadId)
    .maybeSingle();
  if (leadError || !lead) return { error: leadError?.message ?? "Lead not found" };
  const sent = outcome === "sent";
  const declineTag = referralDeclineTag(formData, lead, formData ? text(formData, "practice_area") : null, sent);
  const stampError = await stampReferralDecision(supabase, leadId, lead, {
    desiredNo: true,
    declineTag,
  });
  if (stampError) return { error: stampError };
  const stamped = {
    ...lead,
    desired_case: false as boolean,
    callrail_tags: declineTag
      ? Array.from(new Set([...(lead.callrail_tags ?? []).filter((tag: string) => !tag.startsWith("DEC:")), declineTag]))
      : lead.callrail_tags,
  };
  try {
    await closeLead(supabase, leadId, email, sent
      ? { lead_status: "Referred", close_reason: "referred", event: "referred", path: "declined" }
      : { lead_status: "Lost", close_reason: "declined", event: "referral_declined", path: "declined" });
  } catch (err) {
    const gaps = closeGaps(stamped, "declined");
    return { error: gaps.length ? referralBlockMessage(gaps) : err instanceof Error ? err.message : "Could not record the referral.", gaps: gaps.length ? gaps : undefined };
  }
  await stopFollowUp(supabase, leadId, sent ? "Referred out." : "Referral declined.");
  if (lead.text_sequence_status === "active") {
    await supabase.from("leads").update({ text_sequence_status: "stopped" }).eq("id", leadId);
  }
  revalidatePath("/");
  revalidatePath("/review");
  revalidatePath(`/leads/${leadId}`);
  return {};
}

export async function markReferralAlreadySent(leadId: string, formData: FormData): Promise<{ error?: string; gaps?: string[] }> {
  const { supabase, email } = await requireStaff();
  const destinationId = text(formData, "destination_id");
  const attorneyName = text(formData, "attorney_name");
  const chosenLanguage = text(formData, "language");
  const language = chosenLanguage === "es" || chosenLanguage === "en" ? chosenLanguage : null;
  const area = text(formData, "practice_area");
  const guide = isGuideReferral(area);
  if (!guide && !destinationId && !attorneyName) return { error: "Enter the attorney." };
  if (!isPracticeArea(area)) return { error: "Choose the referral type." };
  let destination: { id: string; name: string; phone: string | null; practice_areas: string[] | null } | null = null;
  if (!guide && destinationId) {
    const { data, error: loadError } = await supabase
      .from("referral_destinations")
      .select("id, name, phone, practice_areas")
      .eq("id", destinationId)
      .maybeSingle();
    if (loadError || !data) return { error: loadError?.message ?? "That firm is missing." };
    if (!(data.practice_areas ?? []).includes(area)) return { error: "That firm is not listed for this practice area." };
    destination = data;
  }
  const guideLabel = "Property damage guide";
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select(CLOSE_READY_COLUMNS)
    .eq("id", leadId)
    .maybeSingle();
  if (leadError || !lead) return { error: leadError?.message ?? "Lead not found" };
  const declineTag = referralDeclineTag(formData, lead, area, true);
  const stampError = await stampReferralDecision(supabase, leadId, lead, {
    desiredNo: true,
    declineTag,
  });
  if (stampError) return { error: stampError };
  const stamped = {
    ...lead,
    desired_case: false as boolean,
    callrail_tags: declineTag
      ? Array.from(new Set([...(lead.callrail_tags ?? []).filter((tag: string) => !tag.startsWith("DEC:")), declineTag]))
      : lead.callrail_tags,
  };
  const gaps = closeGaps(stamped, "declined");
  if (gaps.length) return { error: referralBlockMessage(gaps), gaps };
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
  if (updateError) return { error: updateError.message };
  await stopFollowUp(supabase, leadId, "Referred out.");
  const { error } = await supabase.from("referral_sends").insert({
    lead_id: leadId,
    destination_id: destination?.id ?? null,
    attorney_name: destination ? null : guide ? guideLabel : attorneyName,
    actor: email,
    note: guide ? "Property damage guide already sent" : "Already sent outside Intake Manager",
    language,
    message: null,
  });
  if (error) return { error: error.message };
  await supabase.from("lead_events").insert({
    lead_id: leadId,
    event_type: "referred",
    actor: email,
    payload: {
      destination: destination?.name ?? (guide ? guideLabel : attorneyName) ?? null,
      language,
      recorded: true,
      guide: guide || undefined,
    },
  });
  revalidatePath("/");
  revalidatePath("/review");
  revalidatePath(`/leads/${leadId}`);
  return {};
}

export async function saveReferralFromNumber(formData: FormData) {
  const { email } = await requireStaff();
  const supabase = createSupabaseServiceClient();
  const chosen = toE164(String(formData.get("quo_from_number") ?? ""));
  if (!chosen) throw new Error("Choose the number referral texts send from.");
  const { data: current } = await supabase.from("intake_settings").select("quo_api_key").eq("id", "default").maybeSingle();
  const key = (typeof current?.quo_api_key === "string" ? current.quo_api_key.trim() : "") || process.env.QUO_API_KEY?.trim() || null;
  const { lines } = await listQuoLines(key);
  if (!lines.some((line) => line.number === chosen)) throw new Error("That number is not one of the Quo lines.");
  const { error } = await supabase
    .from("intake_settings")
    .update({
      quo_from_number: chosen,
      updated_at: new Date().toISOString(),
      updated_by: email,
    })
    .eq("id", "default");
  if (error) throw new Error(error.message);
  revalidatePath("/referrals");
  revalidatePath("/how-it-fits");
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

function guideUrlOrEmpty(raw: string | null): string {
  const value = (raw ?? "").trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("bad");
    return value;
  } catch {
    throw new Error("Enter a full http or https link for each guide PDF.");
  }
}

export async function savePropertyDamageGuides(formData: FormData) {
  const { email } = await requireStaff();
  const supabase = createSupabaseServiceClient();
  const en = guideUrlOrEmpty(text(formData, "property_damage_guide_url_en"));
  const es = guideUrlOrEmpty(text(formData, "property_damage_guide_url_es"));
  if (!en || !es) throw new Error("Save both the English and Spanish guide links.");
  const { data, error } = await supabase
    .from("intake_settings")
    .update({
      property_damage_guide_url_en: en,
      property_damage_guide_url_es: es,
      updated_at: new Date().toISOString(),
      updated_by: email,
    })
    .eq("id", "default")
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Could not save the guide links.");
  revalidatePath("/referrals");
  revalidatePath("/work");
  revalidatePath("/open-calls");
}

export async function saveDestination(formData: FormData) {
  const { supabase } = await requireAdmin();
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
    .select("slack_bot_token, quo_api_key, quo_from_number")
    .eq("id", "default")
    .maybeSingle();
  const token = pasted || (typeof current?.slack_bot_token === "string" ? current.slack_bot_token : null);
  const limitToTest = formData.getAll("slack_test_only").includes("yes");
  const testRaw = String(formData.get("slack_test_phone") ?? "").trim();
  const testPhone = limitToTest ? toE164(testRaw) : null;
  if (limitToTest && !testPhone) throw new Error("Enter a 10-digit test number.");
  const { error } = await supabase.from("intake_settings").upsert({
    id: "default",
    slack_posting: posting,
    slack_bot_token: token,
    slack_channel_id: channel || "C026G89PPSS",
    slack_test_phone: testPhone,
    quo_api_key: typeof current?.quo_api_key === "string" ? current.quo_api_key : null,
    quo_from_number: typeof current?.quo_from_number === "string" ? current.quo_from_number : null,
    updated_at: new Date().toISOString(),
    updated_by: email,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/how-it-fits");
}

export async function saveQuoSettings(formData: FormData) {
  const { email } = await requireStaff();
  const supabase = createSupabaseServiceClient();
  const pasted = String(formData.get("quo_api_key") ?? "").trim();
  const { data: current } = await supabase
    .from("intake_settings")
    .select("quo_api_key")
    .eq("id", "default")
    .maybeSingle();
  const key = pasted || (typeof current?.quo_api_key === "string" ? current.quo_api_key : null) || process.env.QUO_API_KEY?.trim() || null;
  const chosen = toE164(String(formData.get("quo_from_number") ?? ""));
  if (!chosen) throw new Error("Choose the Quo number.");
  const { lines } = await listQuoLines(key);
  if (!lines.some((line) => line.number === chosen)) throw new Error("That number is not one of the Quo lines.");
  const { error } = await supabase
    .from("intake_settings")
    .update({
      quo_api_key: key,
      quo_from_number: chosen,
      updated_at: new Date().toISOString(),
      updated_by: email,
    })
    .eq("id", "default");
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
  if (suggestion === "decline" && (decision === "refer" || decision === "decline")) {
    const { data: current, error: currentError } = await supabase
      .from("leads")
      .select("caller_class, case_type")
      .eq("id", leadId)
      .maybeSingle();
    if (currentError || !current) throw new Error(currentError?.message ?? "Lead not found");
    if (current.caller_class === "non_pi" || officialCaseType(current.case_type) === "Non-PI Legal Matter") {
      throw new Error("A non-PI legal matter stays open until the file is filled in and the referral is recorded.");
    }
  }
  if (decision === "dismiss") {
    const { error } = await supabase.from("leads").update({ close_suggestion: null }).eq("id", leadId);
    if (error) throw new Error(error.message);
  } else if (suggestion === "decline" && decision === "refer") {
    await closeLead(supabase, leadId, email, { lead_status: "Referred", close_reason: "referred", event: "referred", path: "declined" });
  } else if (suggestion === "decline" && decision === "decline") {
    await closeLead(supabase, leadId, email, { lead_status: "Lost", close_reason: "declined", event: "declined", path: "declined" });
  } else if (suggestion === "not_interested" && decision === "confirm") {
    await closeLead(supabase, leadId, email, { lead_status: "Lost", close_reason: "not_interested", event: "not_interested", path: "lost" });
  } else if (suggestion === "not_a_lead" && decision === "confirm") {
    await closeLead(supabase, leadId, email, { lead_status: "Lost", close_reason: "not_a_lead", event: "not_a_lead", path: "nonlead" });
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
  change: { lead_status: string; close_reason: string; event: string; path: ClosePath },
) {
  const { data: lead, error: loadError } = await supabase
    .from("leads")
    .select(CLOSE_READY_COLUMNS)
    .eq("id", leadId)
    .maybeSingle();
  if (loadError || !lead) throw new Error(loadError?.message ?? "Lead not found");
  assertCloseReady(lead, change.path);
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

/** Mark a pursued lead lost (signed elsewhere / no longer interested / unresponsive), or reopen that close. */
export async function setLostLead(formData: FormData) {
  const { supabase, email } = await requireStaff();
  const leadId = text(formData, "lead_id");
  const decision = text(formData, "decision");
  const reason = text(formData, "reason");
  if (!leadId) throw new Error("Missing the lead.");
  if (decision !== "yes" && decision !== "no") throw new Error("Choose yes or no for lost lead.");
  await applyLostLeadDecision(supabase, leadId, email, decision as "yes" | "no", reason);
  revalidatePath("/work");
  revalidatePath("/");
  revalidatePath("/priority");
  revalidatePath("/review");
  revalidatePath("/open-calls");
  revalidatePath(`/leads/${leadId}`);
}

/** Clear close outcomes so Desired / Qualified / Lost are editable again after reopen. */
function clearClosedMilestones(tags: string[] | null | undefined) {
  const drop = new Set<string>([
    QUALIFIED_YES,
    QUALIFIED_NO,
    "CVR DESIRED",
    "CVR SIGNED",
    ...NOT_A_LEAD_TAGS,
    ...DECLINE_TAGS,
    "DEC: Referred",
    "NQ: Unresponsive",
    "NQ: Spam / Robo Call",
    "NQ: Outside Service Area",
    "NQ: Non-PI Legal Matter",
  ]);
  return {
    qualified: null as null,
    desired_case: null as null,
    desired_source: null as null,
    decline_reason: null as null,
    callrail_tags: (tags ?? []).filter((tag) => !drop.has(tag) && !tag.startsWith("DEC:") && !tag.startsWith("NQ:") && !tag.startsWith("NL:")),
  };
}

/**
 * An exhausted / cancelled Sign Flow series must not keep auto-closing a reopened lead.
 * Status "reopened" is ignored by the funnel close job and by Sign Flow's Lost sync.
 */
function clearExhaustedAgreement(lead: {
  agreement_status?: string | null;
  agreement_reminder_count?: number | null;
  agreement_next_reminder_at?: string | null;
}) {
  const status = (lead.agreement_status || "").toLowerCase();
  const exhausted =
    ["cancelled", "expired", "failed"].includes(status) ||
    ((lead.agreement_reminder_count ?? 0) >= 6 && !lead.agreement_next_reminder_at && ["sent", "viewed", "cancelled", "expired"].includes(status));
  if (!exhausted) return {};
  return {
    agreement_status: "reopened",
    agreement_next_reminder_at: null as null,
  };
}

/** Reopen a Lost / Referred / declined file so staff can work it and schedule Slack reminders again. */
export async function reopenClosedLead(formData: FormData) {
  const { supabase, email } = await requireStaff();
  const leadId = text(formData, "lead_id");
  if (!leadId) throw new Error("Missing the lead.");
  const { data: before, error } = await supabase
    .from("leads")
    .select(
      "id, kind, follow_up, lead_name, case_type, signed_case, case_id, lead_status, close_reason, arrival, owner_name, agreement_status, agreement_sent_at, agreement_reminder_count, agreement_next_reminder_at, priority, created_at, consultation_date, lead_date, phone, phone_e164, text_sequence_status, callrail_tags",
    )
    .eq("id", leadId)
    .maybeSingle();
  if (error || !before) throw new Error(error?.message ?? "Lead not found");
  if (before.signed_case || before.case_id || before.lead_status === "Signed" || before.lead_status === "Promoted") {
    throw new Error("A signed or promoted case cannot be reopened here.");
  }
  const closed =
    before.lead_status === "Lost" ||
    before.lead_status === "Referred" ||
    Boolean(before.close_reason);
  if (!closed) throw new Error("This lead is already open.");

  const { error: updateError } = await supabase
    .from("leads")
    .update({
      lead_status: "Working",
      close_reason: null,
      close_suggestion: null,
      follow_up: true,
      sequence: null,
      ...clearClosedMilestones(before.callrail_tags as string[] | null),
      ...clearExhaustedAgreement(before),
    })
    .eq("id", leadId);
  if (updateError) throw new Error(updateError.message);
  await supabase.from("lead_events").insert({
    lead_id: leadId,
    event_type: "lost_lead_reopened",
    actor: email,
    payload: { from: before.close_reason || before.lead_status, path: "reopen_closed_lead", cleared_milestones: true },
  });
  await enrollFollowUp(
    supabase,
    { ...before, lead_status: "Working", follow_up: true },
    undefined,
    before.consultation_date ? "post_consult" : "auto",
  );
  revalidatePath("/work");
  revalidatePath("/");
  revalidatePath("/priority");
  revalidatePath("/review");
  revalidatePath("/open-calls");
  revalidatePath(`/leads/${leadId}`);
}

/** Returns true when the lead is closed as lost. */
export async function applyLostLeadDecision(
  supabase: Awaited<ReturnType<typeof requireStaff>>["supabase"],
  leadId: string,
  email: string,
  decision: "yes" | "no",
  reason: string | null,
): Promise<boolean> {
  const { data: before, error: loadError } = await supabase
    .from("leads")
    .select(`id, case_id, lead_status, close_reason, follow_up, text_sequence_status, ${CLOSE_READY_COLUMNS}`)
    .eq("id", leadId)
    .maybeSingle();
  if (loadError || !before) throw new Error(loadError?.message ?? "Lead not found");
  if (before.signed_case || before.lead_status === "Signed" || before.case_id) {
    throw new Error("A signed or promoted case cannot be marked lost.");
  }
  if (decision === "yes" && (before.qualified === false || officialCaseType(before.case_type) === "Non-PI Legal Matter")) {
    throw new Error("A lead that is not qualified cannot be marked lost.");
  }

  if (decision === "yes") {
    if (!isLostLeadReason(reason)) throw new Error("Choose why the lead was lost.");
    const same = before.lead_status === "Lost" && before.close_reason === reason;
    if (!same) {
      await closeLead(supabase, leadId, email, {
        lead_status: "Lost",
        close_reason: reason,
        event: "lost_lead",
        path: "lost",
      });
    }
    const stopped = before.text_sequence_status === "active" ? "stopped" : before.text_sequence_status;
    if (stopped !== before.text_sequence_status || before.follow_up !== false) {
      const { error: stopError } = await supabase
        .from("leads")
        .update({
          text_sequence_status: stopped,
          text_next_at: null,
          follow_up: false,
          sequence: "stop",
        })
        .eq("id", leadId);
      if (stopError) throw new Error(stopError.message);
    }
    await stopFollowUp(supabase, leadId, LOST_LEAD_REASONS[reason]);
    return true;
  }

  if (before.lead_status === "Lost" && isLostLeadReason(before.close_reason)) {
    const { data: agreement } = await supabase
      .from("leads")
      .select("agreement_status, agreement_reminder_count, agreement_next_reminder_at")
      .eq("id", leadId)
      .maybeSingle();
    const { error } = await supabase
      .from("leads")
      .update({
        lead_status: "Working",
        close_reason: null,
        close_suggestion: null,
        follow_up: true,
        sequence: null,
        ...clearClosedMilestones(before.callrail_tags as string[] | null),
        ...clearExhaustedAgreement(agreement ?? {}),
      })
      .eq("id", leadId);
    if (error) throw new Error(error.message);
    await supabase.from("lead_events").insert({
      lead_id: leadId,
      event_type: "lost_lead_reopened",
      actor: email,
      payload: { from: before.close_reason, cleared_milestones: true },
    });
    const { data: reopened } = await supabase
      .from("leads")
      .select(
        "id, kind, follow_up, lead_name, case_type, signed_case, case_id, lead_status, arrival, owner_name, agreement_status, agreement_sent_at, priority, created_at, consultation_date, lead_date, phone, phone_e164",
      )
      .eq("id", leadId)
      .maybeSingle();
    if (reopened) {
      await enrollFollowUp(
        supabase,
        { ...reopened, follow_up: true },
        undefined,
        reopened.consultation_date ? "post_consult" : "auto",
      );
    }
  }
  return false;
}

export async function confirmSigned(formData: FormData) {
  const { supabase, email } = await requireStaff();
  const leadId = text(formData, "lead_id");
  if (!leadId) throw new Error("Missing the lead.");
  const { data: before, error } = await supabase
    .from("leads")
    .select(`id, callrail_call_id, desired_source, ${CLOSE_READY_COLUMNS}`)
    .eq("id", leadId)
    .maybeSingle();
  if (error || !before) throw new Error(error?.message ?? "Lead not found");
  const tags = Array.from(new Set([...((before.callrail_tags ?? []) as string[]).filter((tag) => tag !== QUALIFIED_NO && !tag.startsWith("DEC:")), QUALIFIED_YES, "CVR DESIRED", "CVR SIGNED"]));
  const now = new Date().toISOString();
  const dateSigned = before.date_signed ?? chicagoDay(new Date());
  const gaps = closeGaps({
    ...before,
    signed_case: true,
    qualified: true,
    desired_case: true,
    date_signed: dateSigned,
    callrail_tags: tags,
  }, "signed");
  const { error: updateError } = await supabase
    .from("leads")
    .update({
      signed_case: true,
      signed_at: now,
      date_signed: dateSigned,
      qualified: true,
      desired_case: true,
      desired_source: before.desired_source === "staff" ? "staff" : "contract",
      decline_reason: null,
      callrail_tags: tags,
      ...(gaps.length
        ? {}
        : {
            lead_status: "Signed",
            close_reason: "signed",
            close_suggestion: null,
            follow_up: false,
            sequence: "stop",
          }),
    })
    .eq("id", leadId);
  if (updateError) throw new Error(updateError.message);
  if (gaps.length) throw new Error(closeIncompleteMessage(gaps));
  await supabase.from("lead_jobs").update({ status: "skipped", detail: "Signed" }).eq("lead_id", leadId).eq("status", "pending");
  await supabase.from("lead_events").insert({
    lead_id: leadId,
    event_type: "signed",
    actor: email,
    payload: { confirmed: true },
  });
  if (callrailConfigured() && before.callrail_call_id) {
    try {
      await pushCallrailTags(before.callrail_call_id, tags, MANAGED_CALLRAIL_TAGS);
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
    .select("id, signed_case, desired_case, caller_class, callrail_call_id, callrail_tags, qualified, decline_reason, consultation_date, grade, close_reason, lead_status, case_type")
    .eq("id", leadId)
    .maybeSingle();
  if (error || !before) throw new Error(error?.message ?? "Lead not found");

  const signed = Boolean(before.signed_case);
  const qualifiedNo =
    String(formData.get("qualified_tag") ?? "") === "QUALIFIED NO" ||
    Boolean(String(formData.get("not_qualified_tag") ?? "")) ||
    before.caller_class === "non_pi";
  const coverage = ["CVR DESIRED", "CVR SIGNED"].filter((tag) => (before.callrail_tags ?? []).includes(tag));
  const tagged = tagsFromSelection({
    qualified: String(formData.get("qualified_tag") ?? ""),
    coverage,
    decline: String(formData.get("decline_tag") ?? ""),
    signed,
    desired: qualifiedNo ? false : Boolean(before.desired_case) || signed,
    nonPi: before.caller_class === "non_pi",
    size: String(formData.get("size_tag") ?? ""),
    injuryType: injuryTagForCaseType(before.case_type) || String(formData.get("injury_type") ?? ""),
    notQualified: String(formData.get("not_qualified_tag") ?? ""),
    requireQualified: false,
  });
  const hadSpam = (before.callrail_tags ?? []).some((tag: string) => tag === "NQ: Spam / Robo Call" || tag === "NL: Spam / Robo Call");
  if (hadSpam && String(formData.get("qualified_tag") ?? "") !== "QUALIFIED YES" && !tagged.tags.includes("NL: Spam / Robo Call")) {
    tagged.tags.push("NL: Spam / Robo Call");
  }
  if ((before.callrail_tags ?? []).includes("NQ: Unresponsive") && !tagged.tags.includes("NQ: Unresponsive")) {
    tagged.tags.push("NQ: Unresponsive");
  }
  const { error: updateError } = await supabase
    .from("leads")
    .update({
      callrail_tags: tagged.tags,
      qualified: tagged.qualified ?? before.qualified,
      decline_reason: tagged.decline_reason,
      ...(tagged.qualified === false ? { desired_case: false, desired_source: "staff" } : {}),
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
      await pushCallrailTags(before.callrail_call_id, tagged.tags, MANAGED_CALLRAIL_TAGS);
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
  revalidatePath("/review");
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
  revalidatePath("/open-calls");
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
  revalidatePath("/open-calls");
  revalidatePath(`/leads/${job.lead_id}`);
  revalidatePath("/priority");
}

export async function completeOpenCall(formData: FormData) {
  const { supabase, email } = await requireStaff();
  const jobId = text(formData, "job_id");
  if (!jobId) throw new Error("Choose a call to complete.");
  const { data: job, error } = await supabase
    .from("lead_jobs")
    .select("id, lead_id, queue, status")
    .eq("id", jobId)
    .maybeSingle();
  if (error || !job) throw new Error(error?.message ?? "That call is not on the queue.");
  if (job.queue !== "call") throw new Error("That step is not a call.");
  if (job.status !== "pending" && job.status !== "failed") throw new Error("That call is already finished.");
  const now = new Date().toISOString();
  const { error: doneError } = await supabase
    .from("lead_jobs")
    .update({
      status: "completed",
      outcome: "answered",
      completed_at: now,
      completed_by: email,
      assigned_email: email,
      detail: `Marked complete on Open calls by ${email}.`,
    })
    .eq("id", jobId);
  if (doneError) throw new Error(doneError.message);
  await supabase.from("leads").update({ last_action: "Call completed" }).eq("id", job.lead_id);
  await supabase.from("lead_events").insert({
    lead_id: job.lead_id,
    event_type: "call_outcome",
    actor: email,
    payload: { job_id: jobId, outcome: "answered", source: "open-calls" },
  });
  revalidatePath("/open-calls");
  revalidatePath("/queues");
  revalidatePath("/");
  revalidatePath(`/leads/${job.lead_id}`);
}

function slackUserId(value: string | null): { id: string | null; error?: string } {
  if (!value) return { id: null };
  const id = value.toUpperCase().match(/[UW][A-Z0-9]{8,}/)?.[0] ?? "";
  if (!id) return { id: null, error: "A Slack ID looks like U05JBLVM3TM. Paste the member ID from their Slack profile." };
  return { id };
}

function staffSaveError(message: string): string {
  if (message.includes("contacts_slack_user_id")) return "That Slack ID is already saved on someone else.";
  return message;
}

export async function saveStaffContact(
  _prev: { error: string } | null,
  formData: FormData,
): Promise<{ error: string } | null> {
  try {
    const { supabase } = await requireStaff();
    const id = text(formData, "id");
    const name = text(formData, "name");
    if (!id || !name) return { error: "Enter the person's name." };
    const slack = slackUserId(text(formData, "slack_user_id"));
    if (slack.error) return { error: slack.error };
    const listed = formData.get("listed") === "yes";
    const { data: before, error } = await supabase.from("contacts").select("id, name").eq("id", id).maybeSingle();
    if (error || !before) return { error: error?.message ?? "That person was not found." };
    const { error: updateError } = await supabase
      .from("contacts")
      .update({
        name,
        slack_user_id: slack.id,
        slack_display_name: slack.id ? name.split(/\s+/)[0] : null,
        listed,
        updated_at: Date.now(),
      })
      .eq("id", id);
    if (updateError) return { error: staffSaveError(updateError.message) };
    if (before.name !== name) {
      const { error: leadError } = await supabase.from("leads").update({ owner_name: name }).eq("owner_name", before.name);
      if (leadError) return { error: leadError.message };
      const { error: jobError } = await supabase.from("lead_jobs").update({ assigned_name: name }).eq("assigned_name", before.name);
      if (jobError) return { error: jobError.message };
    }
    revalidatePath("/staff");
    revalidatePath("/");
    revalidatePath("/priority");
    revalidatePath("/review");
    return null;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save." };
  }
}

export async function addStaffContact(
  _prev: { error: string } | null,
  formData: FormData,
): Promise<{ error: string } | null> {
  try {
    const { supabase } = await requireStaff();
    const email = text(formData, "email")?.toLowerCase() ?? "";
    const name = text(formData, "name");
    if (!/^[a-z0-9._+-]+@ramosjames\.com$/.test(email)) return { error: "Use their Ramos James email." };
    if (!name) return { error: "Enter the person's name." };
    const slack = slackUserId(text(formData, "slack_user_id"));
    if (slack.error) return { error: slack.error };
    const userId = await firmUserId(email);
    if (!userId) return { error: "That email does not have a firm login yet." };
    const { data: existing, error: existingError } = await supabase
      .from("contacts")
      .select("id, email")
      .ilike("email", email)
      .limit(1);
    if (existingError) return { error: existingError.message };
    if (existing?.length) return { error: "That email is already on the list. Add the Slack ID on their row." };
    const now = Date.now();
    const { error } = await supabase.from("contacts").insert({
      user_id: userId,
      name,
      email,
      role: "other",
      created_at: now,
      updated_at: now,
      slack_user_id: slack.id,
      slack_display_name: slack.id ? name.split(/\s+/)[0] : null,
      listed: true,
    });
    if (error) return { error: staffSaveError(error.message) };
    revalidatePath("/staff");
    revalidatePath("/");
    return null;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not add that person." };
  }
}

export async function runDueWork() {
  await requireStaff();
  const supabase = createSupabaseServiceClient();
  await enrollMissingFollowUps(supabase);
  const result = await dispatchDue(supabase);
  redirect(`/queues?texts=${result.texts}&calls=${result.calls}&slack=${result.slack}&failed=${result.failed}`);
}
