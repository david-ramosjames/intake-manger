export const ALLOWED_DOMAIN = "ramosjames.com";

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export function docketBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_DOCKET_URL || "https://rjl-docket-flow.vercel.app").replace(
    /\/$/,
    "",
  );
}

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3002").replace(/\/$/, "");
}
