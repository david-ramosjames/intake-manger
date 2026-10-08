"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ALLOWED_DOMAIN } from "@/lib/supabase/config";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

function LoginForm({ origin, configured }: { origin: string; configured: boolean }) {
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(
    params.get("error") === "domain"
      ? `Sign in with an @${ALLOWED_DOMAIN} account.`
      : params.get("error") === "auth"
        ? "That sign-in link was invalid or expired."
        : null,
  );
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${origin}/auth/callback`,
          queryParams: { hd: ALLOWED_DOMAIN, prompt: "select_account" },
        },
      });
      if (authError) setError(authError.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center px-6 py-16">
      <p className="text-sm font-medium text-slate-500">Ramos James Law</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Intake</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        The lead list for the intake team. Sign in with your firm Google account.
      </p>
      {configured ? null : (
        <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm leading-6 text-amber-950">
          <p>This deployment has no Supabase connection yet. Set these on Vercel, then redeploy:</p>
          <ul className="mt-2 list-disc pl-5 font-mono text-xs">
            <li>NEXT_PUBLIC_SUPABASE_URL</li>
            <li>NEXT_PUBLIC_SUPABASE_ANON_KEY</li>
            <li>NEXT_PUBLIC_SITE_URL</li>
          </ul>
          <p className="mt-2">
            Use the same Supabase project as Docket. Set the site URL to this deployment’s origin,
            and add {origin}/auth/callback to the Supabase redirect URLs. The public values are
            read at build time, so a deploy that already finished will not see them until the next
            build.
          </p>
        </div>
      )}
      <button
        type="button"
        onClick={() => void signIn()}
        disabled={busy || !configured}
        className="mt-8 rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {busy ? "Redirecting…" : "Continue with Google"}
      </button>
      {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
      <p className="mt-8 text-xs leading-5 text-slate-500">
        Add {origin}/auth/callback to the Supabase redirect URLs if this is the first time opening
        this app.
      </p>
    </main>
  );
}

export function LoginScreen({ origin, configured }: { origin: string; configured: boolean }) {
  return (
    <Suspense>
      <LoginForm origin={origin} configured={configured} />
    </Suspense>
  );
}
