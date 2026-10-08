import { redirect } from "next/navigation";
import { ALLOWED_DOMAIN, isSupabaseConfigured } from "./supabase/config";
import { createSupabaseServerClient } from "./supabase/server";

export async function requireStaff() {
  if (!isSupabaseConfigured()) redirect("/login?error=config");
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const email = user.email ?? "";
  if (!email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`)) {
    redirect("/login?error=domain");
  }
  return { supabase, email, userId: user.id };
}
