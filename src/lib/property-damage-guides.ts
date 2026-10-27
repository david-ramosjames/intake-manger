import type { SupabaseClient } from "@supabase/supabase-js";
import { propertyDamageGuideUrl, type PropertyDamageGuides } from "./referrals";

export async function loadPropertyDamageGuides(supabase: SupabaseClient): Promise<PropertyDamageGuides> {
  const { data } = await supabase
    .from("intake_settings")
    .select("property_damage_guide_url_en, property_damage_guide_url_es")
    .eq("id", "default")
    .maybeSingle();
  const stored = {
    en: typeof data?.property_damage_guide_url_en === "string" ? data.property_damage_guide_url_en.trim() : "",
    es: typeof data?.property_damage_guide_url_es === "string" ? data.property_damage_guide_url_es.trim() : "",
  };
  return {
    en: propertyDamageGuideUrl("en", stored),
    es: propertyDamageGuideUrl("es", stored),
  };
}
