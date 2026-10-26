import type { SupabaseClient } from "@supabase/supabase-js";

const HOST = "ramos-james-law-document.up.railway.app/s/";
const GREETING = /^Hi\s+([A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){1,3}),/;
const LINK = /ramos-james-law-document\.up\.railway\.app\/s\/([A-Za-z0-9]+)/;

type TextRow = { phone_e164: string | null; content: string | null; occurred_at: string | null };

function officialName(content: string): string | null {
  const name = content.match(GREETING)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
  if (name.length < 3 || /ramos|james/i.test(name)) return null;
  return name;
}

function signingSlug(content: string): string | null {
  return content.match(LINK)?.[1] ?? null;
}

function receivedSigned(content: string): boolean {
  return /received your signed documents|documentos firmados/i.test(content);
}

/** The contract text is the official name. A later link for another document does not reopen the contract. */
export async function syncContractsFromTexts(supabase: SupabaseClient): Promise<{ names: number; reopened: number }> {
  const since = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("intake_interactions")
    .select("phone_e164, content, occurred_at")
    .eq("type", "text")
    .gte("occurred_at", since)
    .or(`content.ilike.%${HOST}%,content.ilike.%received your signed documents%`)
    .order("occurred_at", { ascending: false })
    .limit(800);
  if (error) throw new Error(error.message);

  const latest = new Map<string, { name: string | null; openAt: string | null; openSlug: string | null; signedAt: string | null }>();
  for (const row of (data ?? []) as TextRow[]) {
    const phone = row.phone_e164;
    const content = row.content || "";
    if (!phone) continue;
    const signal = latest.get(phone) ?? { name: null, openAt: null, openSlug: null, signedAt: null };
    if (!signal.name) signal.name = officialName(content);
    if (receivedSigned(content)) {
      if (!signal.signedAt) signal.signedAt = row.occurred_at;
    } else if (content.includes("ramos-james-law-document")) {
      const slug = signingSlug(content);
      if (slug && !signal.openAt) {
        signal.openAt = row.occurred_at;
        signal.openSlug = slug;
      }
    }
    latest.set(phone, signal);
  }
  if (!latest.size) return { names: 0, reopened: 0 };

  const { data: leads, error: leadError } = await supabase
    .from("leads")
    .select("id, lead_name, phone_e164, signed_case, agreement_status, agreement_signing_url, agreement_reminder_count, created_at, test")
    .eq("test", false)
    .in("phone_e164", [...latest.keys()])
    .order("created_at", { ascending: false });
  if (leadError) throw new Error(leadError.message);

  const chosen = new Map<string, NonNullable<typeof leads>[number]>();
  for (const lead of leads ?? []) {
    const phone = String(lead.phone_e164 || "");
    if (phone && !chosen.has(phone)) chosen.set(phone, lead);
  }

  let names = 0;
  let reopened = 0;
  for (const [phone, signal] of latest) {
    const lead = chosen.get(phone);
    if (!lead) continue;
    const patch: Record<string, unknown> = {};
    const current = String(lead.lead_name || "").replace(/\s+/g, " ").trim();
    if (signal.name && current !== signal.name) {
      patch.lead_name = signal.name;
      patch.identity_status = "confirmed";
      patch.identity_evidence = null;
    }
    const status = String(lead.agreement_status || "").toLowerCase();
    const storedSlug = String(lead.agreement_signing_url || "").match(LINK)?.[1] ?? "";
    const contractSigned = Boolean(lead.signed_case) || status === "signed" || status === "completed";
    const signedAfterLink = Boolean(signal.signedAt && (!signal.openAt || signal.signedAt > signal.openAt));
    const openedAfterSignature = Boolean(
      signal.signedAt && lead.created_at && Date.parse(String(lead.created_at)) > Date.parse(signal.signedAt),
    );
    if (signedAfterLink && openedAfterSignature) continue;
    const confirmationForThisContract = Boolean(
      signedAfterLink && (!storedSlug || !signal.openSlug || signal.openSlug === storedSlug),
    );
    if (contractSigned || confirmationForThisContract) {
      if (status === "sent" || status === "viewed" || !status) {
        patch.agreement_status = "completed";
        patch.agreement_next_reminder_at = null;
      }
    } else if (signal.openSlug && !storedSlug) {
      patch.agreement_status = "sent";
      patch.agreement_signing_url = `https://${HOST}${signal.openSlug}`;
      if (!lead.agreement_reminder_count) patch.agreement_reminder_count = 1;
    }
    if (contractSigned || confirmationForThisContract) {
      await supabase
        .from("lead_jobs")
        .update({ status: "skipped", detail: "Contract is signed." })
        .eq("lead_id", lead.id)
        .eq("queue", "call")
        .eq("sequence", "want_to_sign")
        .eq("status", "pending");
    }
    if (!Object.keys(patch).length) continue;
    const { error: updateError } = await supabase.from("leads").update(patch).eq("id", lead.id);
    if (updateError) throw new Error(updateError.message);
    if (patch.lead_name) {
      names += 1;
      await supabase.from("lead_events").insert({
        lead_id: lead.id,
        event_type: "name_corrected",
        actor: "sign-flow",
        payload: { from: current || null, to: signal.name },
      });
    }
    if (patch.agreement_status) {
      reopened += 1;
      await supabase.from("lead_events").insert({
        lead_id: lead.id,
        event_type: "agreement_sent",
        actor: "sign-flow",
        payload: {
          signing_url: patch.agreement_signing_url ?? null,
          reason: patch.agreement_status === "completed" ? "contract_signed" : "contract_link",
        },
      });
    }
  }
  return { names, reopened };
}
