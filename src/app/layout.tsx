import type { Metadata } from "next";
import Link from "next/link";
import { Geist } from "next/font/google";
import "./globals.css";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { signOut } from "@/lib/auth-actions";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Intake",
  description: "Lead cockpit for Ramos James Law intake",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  let email: string | null = null;
  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    email = user?.email ?? null;
  }

  return (
    <html lang="en" className={`${geist.variable} h-full`}>
      <body className="min-h-full">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
            <Link href="/" className="text-sm font-semibold tracking-tight">
              Intake
            </Link>
            <div className="flex items-center gap-4 text-sm text-slate-600">
              <Link href="/how-it-fits" className="font-medium text-slate-900">
                How it fits
              </Link>
            {email ? (
              <>
                <Link href="/queues" className="font-medium text-slate-900">
                  Queues
                </Link>
                <Link href="/sequences" className="font-medium text-slate-900">
                  Sequences
                </Link>
                <Link href="/referrals" className="font-medium text-slate-900">
                  Referrals
                </Link>
                <Link href="/leads/new" className="font-medium text-slate-900">
                  Add lead
                </Link>
                <span className="hidden sm:inline">{email}</span>
                <form action={signOut}>
                  <button type="submit" className="text-slate-500 hover:text-slate-900">
                    Sign out
                  </button>
                </form>
              </>
            ) : null}
            </div>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
