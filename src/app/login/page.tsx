import { isSupabaseConfigured, siteUrl } from "@/lib/supabase/config";
import { LoginScreen } from "./login-form";

export default function LoginPage() {
  return <LoginScreen origin={siteUrl()} configured={isSupabaseConfigured()} />;
}
