import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseSecretKey } from "./keys";

export function createSupabaseServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = supabaseSecretKey();
  if (!url || !key) {
    throw new Error("Supabase secret key is not configured.");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
