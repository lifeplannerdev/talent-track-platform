"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";

const LINKS = [
  { href: "/learn", label: "Learn", match: (p: string) => p === "/learn" || p.startsWith("/learn/") },
  { href: "/exam/start", label: "Exams", match: (p: string) => p === "/exam/start" },
] as const;

/**
 * Learn and Exams, as two underlined tabs under the student header. The current one has
 * aria-current="page" and a Königsblau underline; targets are 44 px tall and the row never
 * overflows at 320 px (two short words).
 */
export function StudentNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Student" className="border-t print:hidden">
      <ul className="mx-auto flex w-full max-w-2xl gap-1 px-2">
        {LINKS.map((l) => {
          const current = l.match(pathname);
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "relative inline-flex min-h-11 items-center px-3 text-base font-semibold transition-colors",
                  "focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                  current ? "text-primary" : "text-muted-foreground hover:text-foreground",
                  "after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:transition-colors",
                  current ? "after:bg-primary" : "after:bg-transparent",
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
