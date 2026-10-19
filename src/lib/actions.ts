"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { callrailConfigured, pushCallrailTags } from "./callrail";
import { enrollFollowUp, stopFollowUp } from "./followup";
import { contractSent } from "./desired";
import { canonicalLeadSource, displayContact, isSourceType } from "./leads";
import { LEAD_TAGS, injuryTagForCaseType, tagsFromSelection } from "./tags";
import { toE164 } from "./phone";
import type { Lead, LeadArrival, LeadGrade, LeadKind, LeadSentiment } from "./leads";
import { requireStaff } from "./session";

const EDITABLE = [
  "lead_date",
  "lead_name",
  "phone",
  "email",
  "lead_source",
  "source_type",
  "source_channel",
  "source_note",
  "case_type",
  "lead_status",
  "consultation",
  "consultation_date",
  "desired_case",
  "desired_source",
  "signed_case",
  "case_number",
  "date_signed",
  "grade",
  "grade_reason",
  "sentiment",
  "sentiment_reason",
  "summary",
  "owner_name",
  "kind",
  "arrival",
  "callrail_tags",
  "qualified",
  "decline_reason",
  "follow_up",
] as const;

type EditableKey = (typeof EDITABLE)[number];

function text(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value.length ? value : null;
}

function dateOrNull(formData: FormData, key: string): string | null {
  const value = text(formData, key);
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function triBool(formData: FormData, key: string): boolean | null {
  const value = String(formData.get(key) ?? "");
  if (value === "yes") return true;
  if (value === "no") return false;
  return null;
}

function gradeOrNull(formData: FormData): LeadGrade | null {
  const value = String(formData.get("grade") ?? "");
  return value === "A" || value === "B" || value === "C" ? value : null;
}

function sentimentOrNull(formData: FormData): LeadSentiment | null {
  const value = String(formData.get("sentiment") ?? "");
  return value === "positive" || value === "neutral" || value === "negative" ? value : null;
}

function kindFromForm(formData: FormData): LeadKind {
  return String(formData.get("kind") ?? "") === "needs_info" ? "needs_info" : "pursue";
}

function arrivalFromForm(formData: FormData): LeadArrival | null {
  const value = String(formData.get("arrival") ?? "");
  if (
    value === "form" ||
    value === "missed" ||
    value === "sona" ||
    value === "human_call" ||
    value === "qualified_call" ||
    value === "manual"
  ) {
    return value;
  }
  return null;
}

function tagsFromForm(formData: FormData) {
  const signed = String(formData.get("signed_case") ?? "") === "yes";
  return tagsFromSelection({
    qualified: String(formData.get("qualified_tag") ?? ""),
    coverage: [],
    decline: String(formData.get("decline_tag") ?? ""),
    signed,
    desired: String(formData.get("desired_case") ?? "") === "yes" || signed,
    nonPi: formData.get("non_pi") === "yes",
    size: String(formData.get("size_tag") ?? ""),
    injuryType: injuryTagForCaseType(text(formData, "case_type")) || String(formData.get("injury_type") ?? ""),
    notQualified: String(formData.get("not_qualified_tag") ?? ""),
    requireQualified: false,
  });
}

function triState(formData: FormData, name: string): boolean | null {
  const value = String(formData.get(name) ?? "");
  if (value === "yes") return true;
  if (value === "no") return false;
  return null;
}

function fieldsFromForm(formData: FormData) {
  const signed = String(formData.get("signed_case") ?? "") === "yes";
  const tagged = tagsFromForm(formData);
  return {
    lead_date: dateOrNull(formData, "lead_date"),
    lead_name: text(formData, "lead_name"),
    phone: text(formData, "phone"),
    phone_e164: toE164(text(formData, "phone")),
    email: displayContact(text(formData, "email")),
    lead_source: canonicalLeadSource(text(formData, "lead_source")).source || null,
    source_type: isSourceType(text(formData, "source_type"))
      ? text(formData, "source_type")
      : canonicalLeadSource(text(formData, "lead_source")).type || null,
    source_channel: text(formData, "source_channel"),
    source_note: text(formData, "source_note"),
    case_type: text(formData, "case_type"),
    lead_status: text(formData, "lead_status") ?? "New",
    consultation: null as string | null,
    consultation_date: dateOrNull(formData, "consultation_date"),
    desired_case: triState(formData, "desired_case"),
    desired_source: null as "staff" | "contract" | null,
    signed_case: signed,
    case_number: text(formData, "case_number"),
    date_signed: dateOrNull(formData, "date_signed"),
    grade: gradeOrNull(formData),
    grade_reason: text(formData, "grade_reason"),
    sentiment: sentimentOrNull(formData),
    sentiment_reason: text(formData, "sentiment_reason"),
    summary: text(formData, "summary"),
    owner_name: text(formData, "owner_name"),
    kind: kindFromForm(formData),
    arrival: arrivalFromForm(formData),
    callrail_tags: tagged.tags,
    qualified: tagged.qualified,
    decline_reason: tagged.decline_reason,
    follow_up: String(formData.get("follow_up") ?? "") === "yes",
  };
}

function changedFields(before: Lead, after: ReturnType<typeof fieldsFromForm>) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of EDITABLE) {
    const prev = before[key as EditableKey];
    const next = after[key];
    const same = Array.isArray(prev) || Array.isArray(next)
      ? JSON.stringify(prev ?? []) === JSON.stringify(next ?? [])
      : (prev ?? null) === (next ?? null);
    if (!same) {
      changes[key] = { from: prev ?? null, to: next ?? null };
    }
  }
  return changes;
}

function applyMilestones(fields: ReturnType<typeof fieldsFromForm>, before: Lead | null) {
  const previousDate = before?.consultation_date?.slice(0, 10) ?? null;
  if (!fields.consultation_date) fields.consultation = before?.consultation === "no" ? "no" : null;
  else if (!before || fields.consultation_date !== previousDate) fields.consultation = "staff";
  else fields.consultation = before.consultation;

  const contract = before ? contractSent(before) : false;
  if (fields.qualified === false) {
    fields.desired_case = false;
    fields.desired_source = "staff";
  } else if (fields.signed_case || contract) {
    fields.desired_case = true;
    fields.desired_source = before?.desired_source === "staff" ? "staff" : contract ? "contract" : "staff";
  } else if (fields.desired_case === true || fields.desired_case === false) {
    fields.desired_source = "staff";
  } else {
    fields.desired_case = null;
    fields.desired_source = null;
  }

  const tags = fields.callrail_tags.filter((tag) => tag !== "CVR DESIRED" && tag !== "CVR SIGNED");
  if (fields.desired_case) tags.push("CVR DESIRED");
  if (fields.signed_case) tags.push("CVR SIGNED");
  fields.callrail_tags = tags;
}

export async function createLead(formData: FormData) {
  const { supabase, email } = await requireStaff();
  const fields = fieldsFromForm(formData);
  applyMilestones(fields, null);
  const now = new Date().toISOString();
  const signedExtras = fields.signed_case
    ? {
        signed_at: now,
        form_fill_closed_at: now,
        date_signed: fields.date_signed ?? now.slice(0, 10),
        lead_status: fields.lead_status === "New" ? "Signed" : fields.lead_status,
      }
    : {};

  if (fields.phone_e164) {
    const { data: existingRows, error: existingError } = await supabase
      .from("leads")
      .select("id, lead_name")
      .eq("phone_e164", fields.phone_e164)
      .limit(1);
    if (existingError) throw new Error(existingError.message);
    const existing = existingRows?.[0];
    if (existing) {
      throw new Error(
        `${existing.lead_name || "A lead"} already uses this phone. Open that lead instead of adding another.`,
      );
    }
  }

  const { data, error } = await supabase
    .from("leads")
    .insert({ ...fields, arrival: fields.arrival ?? "manual", needs_verification: !fields.lead_name || !fields.phone, ...signedExtras })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Could not create the lead");
  }

  await supabase.from("lead_events").insert({
    lead_id: data.id,
    event_type: "created",
    actor: email,
    payload: { lead_name: fields.lead_name, lead_status: signedExtras.lead_status ?? fields.lead_status },
  });

  if (fields.follow_up && !fields.signed_case) {
    await enrollFollowUp(supabase, {
      id: data.id,
      kind: fields.kind,
      follow_up: true,
      lead_name: fields.lead_name,
      case_type: fields.case_type,
      signed_case: false,
      case_id: null,
      lead_status: signedExtras.lead_status ?? fields.lead_status,
      arrival: fields.arrival ?? "manual",
      owner_name: fields.owner_name,
      created_at: new Date().toISOString(),
    });
  }

  revalidatePath("/");
  redirect(`/leads/${data.id}`);
}

export async function updateLead(leadId: string, formData: FormData) {
  const { supabase, email } = await requireStaff();
  const { data: existing, error: loadError } = await supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .maybeSingle();
  if (loadError || !existing) {
    throw new Error(loadError?.message ?? "Lead not found");
  }

  const before = existing as Lead;
  const fields = fieldsFromForm(formData);
  applyMilestones(fields, before);
  const changes = changedFields(before, fields);
  const statusNow = fields.lead_status;
  const closed =
    fields.signed_case ||
    Boolean(before.case_id) ||
    statusNow === "Lost" ||
    statusNow === "Referred" ||
    statusNow === "Promoted";
  if (Object.keys(changes).length === 0) {
    if (fields.follow_up && !closed) {
      const { count } = await supabase
        .from("lead_jobs")
        .select("id", { count: "exact", head: true })
        .eq("lead_id", leadId);
      if (!count) {
        await enrollFollowUp(supabase, {
          id: leadId,
          kind: fields.kind,
          follow_up: true,
          lead_name: fields.lead_name,
          case_type: fields.case_type,
          signed_case: fields.signed_case,
          case_id: before.case_id,
          lead_status: statusNow,
          arrival: fields.arrival ?? before.arrival,
          owner_name: fields.owner_name ?? before.owner_name,
          agreement_status: before.agreement_status,
          agreement_sent_at: before.agreement_sent_at,
          priority: before.priority,
          created_at: before.created_at,
          consultation_date: fields.consultation_date ?? before.consultation_date,
          lead_date: fields.lead_date ?? before.lead_date,
        });
        revalidatePath(`/leads/${leadId}`);
        revalidatePath("/queues");
      }
    }
    redirect(`/leads/${leadId}`);
  }

  const patch: Record<string, unknown> = { ...fields };
  if (!before.signed_case && fields.signed_case) {
    const now = new Date().toISOString();
    patch.signed_at = before.signed_at ?? now;
    patch.form_fill_closed_at = before.form_fill_closed_at ?? now;
    if (!fields.date_signed) patch.date_signed = now.slice(0, 10);
    if (fields.lead_status === "New" || fields.lead_status === "Working") {
      patch.lead_status = "Signed";
    }
  }
  if (before.signed_case && !fields.signed_case) {
    patch.signed_at = null;
    patch.form_fill_closed_at = null;
  }
  if (typeof patch.lead_status === "string" && patch.lead_status !== fields.lead_status) {
    changes.lead_status = { from: before.lead_status, to: patch.lead_status };
  }
  if (before.grade !== fields.grade || before.grade_reason !== fields.grade_reason) {
    patch.grade_source = "staff";
  }
  if (before.sentiment !== fields.sentiment || before.sentiment_reason !== fields.sentiment_reason) {
    patch.sentiment_source = "staff";
  }
  if (statusNow !== "Lost" && before.close_reason) {
    patch.close_reason = null;
  }
  patch.confirmed_at = null;
  patch.confirmed_by = null;
  if (!fields.lead_name || !fields.phone) patch.needs_verification = true;
  else if (changes.lead_name || changes.phone) patch.needs_verification = false;

  const { error } = await supabase.from("leads").update(patch).eq("id", leadId);
  if (error) throw new Error(error.message);

  const events: {
    lead_id: string;
    event_type: string;
    actor: string | null;
    payload: Record<string, unknown>;
  }[] = [
    {
      lead_id: leadId,
      event_type: "updated",
      actor: email,
      payload: changes,
    },
  ];
  if (before.grade !== fields.grade || before.grade_reason !== fields.grade_reason) {
    events.push({
      lead_id: leadId,
      event_type: "grade_changed",
      actor: email,
      payload: {
        from: before.grade,
        to: fields.grade,
        reason: fields.grade_reason,
      },
    });
  }
  if (!before.signed_case && fields.signed_case) {
    events.push({
      lead_id: leadId,
      event_type: "signed",
      actor: email,
      payload: { date_signed: patch.date_signed ?? fields.date_signed },
    });
  }
  if (before.sentiment !== fields.sentiment || before.sentiment_reason !== fields.sentiment_reason) {
    events.push({
      lead_id: leadId,
      event_type: "sentiment_changed",
      actor: email,
      payload: {
        from: before.sentiment,
        to: fields.sentiment,
        reason: fields.sentiment_reason,
      },
    });
  }

  await supabase.from("lead_events").insert(events);

  const status = String(patch.lead_status ?? fields.lead_status);
  const signed = Boolean(patch.signed_case ?? fields.signed_case);
  if (signed || before.case_id || status === "Lost" || status === "Referred" || status === "Promoted") {
    await stopFollowUp(supabase, leadId, "Lead is no longer in follow-up.");
  } else if (fields.follow_up) {
    await enrollFollowUp(supabase, {
      id: leadId,
      kind: fields.kind,
      follow_up: true,
      lead_name: fields.lead_name,
      case_type: fields.case_type,
      signed_case: signed,
      case_id: before.case_id,
      lead_status: status,
      arrival: fields.arrival ?? before.arrival,
      owner_name: fields.owner_name ?? before.owner_name,
      agreement_status: before.agreement_status,
      agreement_sent_at: before.agreement_sent_at,
      priority: Boolean(patch.priority ?? before.priority),
      created_at: before.created_at,
      consultation_date: fields.consultation_date ?? before.consultation_date,
      lead_date: fields.lead_date ?? before.lead_date,
    });
  } else if (before.follow_up) {
    await stopFollowUp(supabase, leadId, "Follow-up was turned off.");
  }

  if (changes.callrail_tags && callrailConfigured() && before.callrail_call_id) {
    try {
      await pushCallrailTags(before.callrail_call_id, fields.callrail_tags, LEAD_TAGS);
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
  redirect(`/leads/${leadId}`);
}
