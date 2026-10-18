"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/lib/auth-actions";
import { navLink } from "@/lib/ui";

const LOGO = "https://res.cloudinary.com/dmmxuoa3p/image/upload/v1783363036/logo_rdt8yk.webp";

const LINKS = [
  { href: "/", label: "Work queue" },
  { href: "/review", label: "Review" },
  { href: "/priority", label: "Priority" },
  { href: "/open-calls", label: "Open calls" },
  { href: "/referrals", label: "Referrals" },
  { href: "/leads/new", label: "Add lead" },
];

const ADMIN_LINKS = [
  { href: "/sequences", label: "Sequences" },
  { href: "/how-it-fits", label: "How it fits" },
  { href: "/staff", label: "Staff" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/" || href === "/leads/new") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppHeader({
  email,
  admin = false,
  priorityCount = 0,
}: {
  email: string | null;
  admin?: boolean;
  priorityCount?: number;
}) {
  const pathname = usePathname();
  const wide = pathname === "/" || pathname === "/review" || pathname === "/open-calls";

  return (
    <header className="sticky top-0 z-30 bg-[linear-gradient(100deg,#0A1E41_0%,#0F316D_100%)] text-white">
      <div className={`mx-auto flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 xl:px-6 ${wide ? "" : "max-w-7xl"}`}>
        <Link href="/" className="flex items-center gap-3">
          <img src={LOGO} alt="Ramos James Law" className="h-12 w-auto" />
          <span className="text-sm font-semibold tracking-tight">Intake Manager</span>
        </Link>
        {email ? (
          <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {LINKS.map((link) => {
              const active = isActive(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`${navLink} inline-flex items-center gap-1.5 ${
                    active ? "border-accent text-white" : "border-transparent text-white/75 hover:text-white"
                  }`}
                >
                  {link.label}
                  {link.href === "/priority" ? (
                    <span className="min-w-[1.25rem] rounded-full bg-accent px-1.5 py-0.5 text-center text-[11px] font-semibold leading-none text-white">
                      {priorityCount}
                    </span>
                  ) : null}
                </Link>
              );
            })}
            <span className="hidden text-white/60 sm:inline">{email}</span>
            <form action={signOut}>
              <button type="submit" className="text-white/75 hover:text-white">
                Sign out
              </button>
            </form>
            {admin ? (
              <span className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1">
                {ADMIN_LINKS.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`${navLink} ${
                      isActive(pathname, link.href)
                        ? "border-accent text-white"
                        : "border-transparent text-white/75 hover:text-white"
                    }`}
                  >
                    {link.label}
                  </Link>
                ))}
              </span>
            ) : null}
          </nav>
        ) : null}
      </div>
    </header>
  );
}
