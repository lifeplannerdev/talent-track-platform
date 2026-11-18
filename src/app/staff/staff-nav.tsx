"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";

const LINKS = [
  { href: "/staff", label: "Dashboard" },
  { href: "/staff/review", label: "Review" },
  { href: "/staff/results", label: "Results" },
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

/**
 * Staff section links in the shared header; the current section is marked with aria-current
 * and an ink underline. On narrow screens the row scrolls sideways and keeps the current
 * section in view.
 */
export function StaffNav() {
  const current = currentHref(usePathname());
  const activeRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    const link = activeRef.current;
    const row = link?.closest("ul");
    if (!link || !row || row.scrollWidth <= row.clientWidth) return;
    // Scroll only the nav row (not the page) so the current section is visible.
    row.scrollLeft = link.offsetLeft - (row.clientWidth - link.offsetWidth) / 2;
  }, [current]);

  return (
    <nav aria-label="Staff">
      <ul className="flex snap-x gap-1 overflow-x-auto px-3 [scrollbar-width:none] sm:px-5 lg:px-0 [&::-webkit-scrollbar]:hidden">
        {LINKS.map((l) => {
          const active = l.href === current;
          return (
            <li key={l.href} className="shrink-0 snap-start">
              <Link
                ref={active ? activeRef : undefined}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative inline-flex h-11 items-center px-2.5 text-sm font-semibold whitespace-nowrap text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-offset-[-2px] lg:h-14",
                  "after:absolute after:inset-x-2.5 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent after:transition-colors",
                  active && "text-foreground after:bg-primary",
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
