"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "./config";
import { supabasePublishableKey } from "./keys";

export function createSupabaseBrowserClient(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured.");
  }
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, supabasePublishableKey()!);
}
