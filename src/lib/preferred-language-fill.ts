import type { SupabaseClient } from "@supabase/supabase-js";
import { callrailCallId, callrailConfigured, fetchCallrailCall } from "@/lib/callrail";
import {
  inferPreferredLanguage,
  languageFromCallrailTracker,
  languageFromLandingUrl,
  type PreferredLanguage,
} from "@/lib/preferred-language";

type LanguageLead = {
  id: string;
  preferred_language: string | null;
  summary?: string | null;
  case_detail?: string | null;
  callrail_call_id?: string | null;
  intake_call_id?: string | null;
};

async function saveLanguage(supabase: SupabaseClient, lead: LanguageLead, language: PreferredLanguage): Promise<boolean> {
  if (lead.preferred_language === language) return false;
  const { error } = await supabase
    .from("leads")
    .update({ preferred_language: language })
    .eq("id", lead.id)
    .is("preferred_language", null);
  if (error) return false;
  lead.preferred_language = language;
  return true;
}

/** Fill blank preferred_language from Slack/form copy, Call Ads, Website Pool landing pages, or Quo text. */
export async function fillPreferredLanguages(supabase: SupabaseClient, leads: LanguageLead[]): Promise<number> {
  let filled = 0;
  const needCallrail: LanguageLead[] = [];

  for (const lead of leads) {
    if (lead.preferred_language === "en" || lead.preferred_language === "es") continue;
    const text = [lead.case_detail, lead.summary].filter(Boolean).join("\n");
    // Quo spoken language is set at call time with duration. Cron fill uses form / CallRail signals only.
    const inferred = inferPreferredLanguage({
      text,
      summary: lead.summary,
    });
    if (inferred) {
      if (await saveLanguage(supabase, lead, inferred)) filled += 1;
      continue;
    }
    const trackerHint = /website pool|call\s*ads?/i.test(text);
    if (trackerHint || lead.callrail_call_id || /callrail\.com/i.test(text)) needCallrail.push(lead);
  }

  if (!needCallrail.length || !callrailConfigured()) return filled;

  for (const lead of needCallrail.slice(0, 40)) {
    if (lead.preferred_language === "en" || lead.preferred_language === "es") continue;
    const callId = (lead.callrail_call_id?.trim() || callrailCallId(lead.case_detail) || "").toUpperCase();
    if (!callId) continue;
    const meta = await fetchCallrailCall(callId);
    if (!meta) continue;
    const language =
      languageFromLandingUrl(meta.landingPageUrl) ||
      languageFromCallrailTracker(meta.trackingName) ||
      null;
    if (!language) continue;
    if (await saveLanguage(supabase, lead, language)) filled += 1;
  }
  return filled;
}

export async function fillOutstandingPreferredLanguages(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase
    .from("leads")
    .select("id, preferred_language, summary, case_detail, callrail_call_id, intake_call_id")
    .eq("test", false)
    .is("preferred_language", null)
    .not("lead_status", "in", "(Signed,Promoted,Lost,Referred)")
    .order("created_at", { ascending: false })
    .limit(120);
  if (error) throw new Error(error.message);
  return fillPreferredLanguages(supabase, (data ?? []) as LanguageLead[]);
}
