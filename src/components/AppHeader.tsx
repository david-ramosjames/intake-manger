"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { signOut } from "@/lib/auth-actions";
import { navLink } from "@/lib/ui";

const LOGO = "https://res.cloudinary.com/dmmxuoa3p/image/upload/v1783363036/logo_rdt8yk.webp";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/work", label: "Work queue" },
  { href: "/priority", label: "Priority" },
  { href: "/open-calls", label: "Open calls" },
  { href: "/grades", label: "Call grades" },
  { href: "/referrals", label: "Referrals" },
  { href: "/leads/new", label: "Add lead" },
];

const ADMIN_LINKS = [
  { href: "/sequences", label: "Sequences" },
  { href: "/outreach-timeline", label: "Timeline" },
  { href: "/how-it-fits", label: "How it fits" },
  { href: "/staff", label: "Staff" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/" || href === "/leads/new") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function HeaderLinkFace({
  label,
  active,
  badge,
}: {
  label: string;
  active: boolean;
  badge?: ReactNode;
}) {
  const { pending } = useLinkStatus();
  return (
    <>
      <span
        className={
          pending && !active ? "text-white underline decoration-accent decoration-2 underline-offset-4" : undefined
        }
      >
        {label}
      </span>
      {badge}
      <span
        aria-hidden
        className={`ml-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent transition-opacity duration-150 ${
          pending ? "animate-pulse opacity-100" : "opacity-0"
        }`}
      />
    </>
  );
}

function HeaderLink({
  href,
  label,
  active,
  badge,
}: {
  href: string;
  label: string;
  active: boolean;
  badge?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`${navLink} group inline-flex items-center gap-1.5 ${
        active ? "border-accent text-white" : "border-transparent text-white/75 hover:text-white"
      }`}
    >
      <HeaderLinkFace label={label} active={active} badge={badge} />
    </Link>
  );
}

export function AppHeader({
  email,
  admin = false,
  priorityBadge,
}: {
  email: string | null;
  admin?: boolean;
  priorityBadge?: ReactNode;
}) {
  const pathname = usePathname();
  const wide = pathname === "/" || pathname === "/work" || pathname === "/review" || pathname === "/open-calls";

  return (
    <header className="sticky top-0 z-30 bg-[linear-gradient(100deg,#0A1E41_0%,#0F316D_100%)] text-white">
      <div className={`mx-auto flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 xl:px-6 ${wide ? "" : "max-w-7xl"}`}>
        <Link href="/" className="flex flex-col items-center gap-0.5">
          <img src={LOGO} alt="Ramos James Law" className="h-12 w-auto" />
          <span className="text-[11px] font-semibold leading-none tracking-tight">Intake Manager</span>
        </Link>
        {email ? (
          <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {LINKS.map((link) => (
              <HeaderLink
                key={link.href}
                href={link.href}
                label={link.label}
                active={isActive(pathname, link.href)}
                badge={link.href === "/priority" ? priorityBadge : undefined}
              />
            ))}
            <span className="hidden text-white/60 sm:inline">{email}</span>
            <form action={signOut}>
              <button type="submit" className="text-white/75 hover:text-white">
                Sign out
              </button>
            </form>
            {admin ? (
              <span className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1">
                {ADMIN_LINKS.map((link) => (
                  <HeaderLink key={link.href} href={link.href} label={link.label} active={isActive(pathname, link.href)} />
                ))}
              </span>
            ) : null}
          </nav>
        ) : null}
      </div>
    </header>
  );
}
