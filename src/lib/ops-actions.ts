"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { callrailConfigured, fetchCallrailTags } from "./callrail";
import { dispatchDue } from "./dispatch";
import { stopFollowUp } from "./followup";
import { requireStaff } from "./session";
import { createSupabaseServiceClient } from "./supabase/service";
import { LEAD_CHANNEL_ID, postToSlack } from "./slack";

function text(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value.length ? value : null;
}

export async function confirmLead(leadId: string) {
  const { supabase, email } = await requireStaff();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("leads")
    .update({ confirmed_at: now, confirmed_by: email })
    .eq("id", leadId);
  if (error) throw new Error(error.message);
  await supabase.from("lead_events").insert({
    lead_id: leadId,
    event_type: "confirmed",
    actor: email,
    payload: {},
  });
  revalidatePath(`/leads/${leadId}`);
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

export async function runDueWork() {
  await requireStaff();
  const result = await dispatchDue(createSupabaseServiceClient());
  redirect(`/queues?texts=${result.texts}&calls=${result.calls}&slack=${result.slack}&failed=${result.failed}`);
}
