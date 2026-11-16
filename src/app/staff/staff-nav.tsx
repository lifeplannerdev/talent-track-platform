"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";

const LINKS = [
  { href: "/staff", label: "Dashboard" },
  { href: "/staff/review", label: "Review" },
  { href: "/staff/blocked", label: "Blocked" },
  { href: "/staff/grants", label: "Give attempts" },
  { href: "/staff/students", label: "Students" },
  { href: "/staff/curriculums", label: "Curriculums" },
  { href: "/staff/questions", label: "Questions" },
] as const;

function currentHref(pathname: string | null): string | null {
  if (!pathname) return null;
  // Longest matching prefix wins, so /staff/students/[id] marks Students, not Dashboard.
  const match = [...LINKS]
    .filter((l) => pathname === l.href || (l.href !== "/staff" && pathname.startsWith(`${l.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match?.href ?? null;
}

/** Staff section links in the shared header; the current section is marked with aria-current. */
export function StaffNav() {
  const current = currentHref(usePathname());
  return (
    <nav aria-label="Staff" className="-mx-1">
      <ul className="flex flex-wrap gap-x-1 gap-y-1">
        {LINKS.map((l) => {
          const active = l.href === current;
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative inline-flex h-9 items-center rounded-md px-2.5 text-sm font-semibold text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground",
                  active && "bg-secondary text-secondary-foreground hover:bg-secondary hover:text-secondary-foreground",
                )}
              >
                {l.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
