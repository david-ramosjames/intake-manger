import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import { AppHeader } from "@/components/AppHeader";
import { PriorityCountBadge } from "@/components/PriorityCountBadge";
import { isAdminEmail } from "@/lib/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Intake Manager",
  description: "Lead cockpit for Ramos James Law intake",
};

export const dynamic = "force-dynamic";

function PriorityBadgeFallback() {
  return (
    <span className="min-w-[1.25rem] rounded-full bg-accent/70 px-1.5 py-0.5 text-center text-[11px] font-semibold leading-none text-white/80">
      …
    </span>
  );
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  let email: string | null = null;
  let admin = false;
  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    email = user?.email ?? null;
    admin = isAdminEmail(email);
  }

  return (
    <html lang="en" className={`${geist.variable} h-full`}>
      <body className="min-h-full">
        <AppHeader
          email={email}
          admin={admin}
          priorityBadge={
            email ? (
              <Suspense fallback={<PriorityBadgeFallback />}>
                <PriorityCountBadge />
              </Suspense>
            ) : undefined
          }
        />
        {children}
      </body>
    </html>
  );
}
