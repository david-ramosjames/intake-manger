import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { supabasePublishableKey } from "@/lib/supabase/keys";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const origin = requestUrl.origin;
  if (!code) return NextResponse.redirect(`${origin}/login?error=auth`);

  const cookieStore = await cookies();
  const publishable = supabasePublishableKey();
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !publishable) {
    return NextResponse.redirect(`${origin}/login?error=config`);
  }
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishable,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options as CookieOptions),
          );
        },
      },
    },
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${origin}/login?error=auth`);
  return NextResponse.redirect(`${origin}/`);
}
