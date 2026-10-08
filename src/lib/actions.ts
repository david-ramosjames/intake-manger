"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { callrailConfigured, pushCallrailTags } from "./callrail";
import { enrollFollowUp, stopFollowUp } from "./followup";
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

function tagsFromForm(formData: FormData): string[] {
  return [
    ...new Set(
      String(formData.get("callrail_tags") ?? "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
}

function fieldsFromForm(formData: FormData) {
  const signed = String(formData.get("signed_case") ?? "") === "yes";
  return {
    lead_date: dateOrNull(formData, "lead_date"),
    lead_name: text(formData, "lead_name"),
    phone: text(formData, "phone"),
    phone_e164: toE164(text(formData, "phone")),
    email: text(formData, "email"),
    lead_source: text(formData, "lead_source"),
    source_type: text(formData, "source_type"),
    source_channel: text(formData, "source_channel"),
    source_note: text(formData, "source_note"),
    case_type: text(formData, "case_type"),
    lead_status: text(formData, "lead_status") ?? "New",
    consultation: text(formData, "consultation"),
    consultation_date: dateOrNull(formData, "consultation_date"),
    desired_case: triBool(formData, "desired_case"),
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
    callrail_tags: tagsFromForm(formData),
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

export async function createLead(formData: FormData) {
  const { supabase, email } = await requireStaff();
  const fields = fieldsFromForm(formData);
  const now = new Date().toISOString();
  const signedExtras = fields.signed_case
    ? {
        signed_at: now,
        form_fill_closed_at: now,
        date_signed: fields.date_signed ?? now.slice(0, 10),
        lead_status: fields.lead_status === "New" ? "Signed" : fields.lead_status,
      }
    : {};

  const { data, error } = await supabase
    .from("leads")
    .insert({ ...fields, arrival: fields.arrival ?? "manual", ...signedExtras })
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
  const changes = changedFields(before, fields);
  if (Object.keys(changes).length === 0) {
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
  patch.confirmed_at = null;
  patch.confirmed_by = null;

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
    });
  } else if (before.follow_up) {
    await stopFollowUp(supabase, leadId, "Follow-up was turned off.");
  }

  if (changes.callrail_tags && callrailConfigured() && before.callrail_call_id) {
    try {
      await pushCallrailTags(before.callrail_call_id, fields.callrail_tags);
    } catch (err) {
      await supabase.from("lead_events").insert({
        lead_id: leadId,
        event_type: "callrail_tags",
        actor: email,
        payload: { error: err instanceof Error ? err.message : "CallRail did not take the tags." },
      });
    }
  }

  revalidatePath("/");
  revalidatePath(`/leads/${leadId}`);
  redirect(`/leads/${leadId}`);
}
