import { propertyDamageGuideUrl, type PropertyDamageGuides } from "./referrals";
import { createSupabaseServiceClient } from "./supabase/service";

/** Raw URLs saved on Referrals (empty when not set yet). */
export async function loadStoredPropertyDamageGuides(): Promise<PropertyDamageGuides> {
  const supabase = createSupabaseServiceClient();
  const { data } = await supabase
    .from("intake_settings")
    .select("property_damage_guide_url_en, property_damage_guide_url_es")
    .eq("id", "default")
    .maybeSingle();
  return {
    en: typeof data?.property_damage_guide_url_en === "string" ? data.property_damage_guide_url_en.trim() : "",
    es: typeof data?.property_damage_guide_url_es === "string" ? data.property_damage_guide_url_es.trim() : "",
  };
}

/** URLs used when sending a property-damage referral text. */
export async function loadPropertyDamageGuides(): Promise<PropertyDamageGuides> {
  const stored = await loadStoredPropertyDamageGuides();
  return {
    en: propertyDamageGuideUrl("en", stored),
    es: propertyDamageGuideUrl("es", stored),
  };
}
