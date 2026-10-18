import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { AppHeader } from "@/components/AppHeader";
import { isAdminEmail } from "@/lib/admin";
import { countCurrentPriority } from "@/lib/next-step";
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

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  let email: string | null = null;
  let admin = false;
  let priorityCount = 0;
  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    email = user?.email ?? null;
    admin = isAdminEmail(email);
    if (email) priorityCount = await countCurrentPriority(supabase);
  }

  return (
    <html lang="en" className={`${geist.variable} h-full`}>
      <body className="min-h-full">
        <AppHeader email={email} admin={admin} priorityCount={priorityCount} />
        {children}
      </body>
    </html>
  );
}
