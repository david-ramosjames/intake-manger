"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/lib/auth-actions";

const LOGO = "https://res.cloudinary.com/dmmxuoa3p/image/upload/v1783363036/logo_rdt8yk.webp";

const LINKS = [
  { href: "/", label: "Work queue" },
  { href: "/priority", label: "Priority" },
  { href: "/verify", label: "Verify" },
  { href: "/sequences", label: "Sequences" },
  { href: "/calls", label: "Lead channel" },
  { href: "/referrals", label: "Referrals" },
  { href: "/leads/new", label: "Add lead" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/" || href === "/leads/new") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppHeader({ email }: { email: string | null }) {
  const pathname = usePathname();
  const docsActive = isActive(pathname, "/how-it-fits");
  const wide = pathname === "/";

  return (
    <header className="sticky top-0 z-30 bg-[linear-gradient(100deg,#0A1E41_0%,#0F316D_100%)] text-white">
      <div className={`mx-auto flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 xl:px-6 ${wide ? "" : "max-w-7xl"}`}>
        <Link href="/" className="flex items-center gap-3">
          <img src={LOGO} alt="Ramos James Law" className="h-12 w-auto" />
          <span className="text-sm font-semibold tracking-tight">Intake Manager</span>
        </Link>
        {email ? (
          <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {LINKS.map((link) => {
              const active = isActive(pathname, link.href);
              if (link.href === "/priority") {
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`rounded-full bg-brand px-3 py-1 font-semibold text-navy ${
                      active ? "ring-2 ring-accent" : ""
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              }
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`border-b-2 font-medium ${
                    active ? "border-accent text-white" : "border-transparent text-white/75 hover:text-white"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
            <span className="hidden text-white/60 sm:inline">{email}</span>
            <form action={signOut}>
              <button type="submit" className="text-white/75 hover:text-white">
                Sign out
              </button>
            </form>
            <Link
              href="/how-it-fits"
              className={`border-b-2 font-medium ${
                docsActive ? "border-accent text-white" : "border-transparent text-white/75 hover:text-white"
              }`}
            >
              How it fits
            </Link>
          </nav>
        ) : null}
      </div>
    </header>
  );
}
