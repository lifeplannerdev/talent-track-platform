import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

const LINKS = [
  { href: "/staff", label: "Dashboard" },
  { href: "/staff/review", label: "Review" },
  { href: "/staff/blocked", label: "Blocked" },
  { href: "/staff/grants", label: "Give attempts" },
] as const;

/** Staff section links. `current` marks the page the user is on. */
export function StaffNav({ current }: { current: (typeof LINKS)[number]["href"] }) {
  return (
    <nav aria-label="Staff" className="flex flex-wrap gap-2">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={l.href === current ? "page" : undefined}
          className={buttonVariants({ variant: l.href === current ? "secondary" : "ghost", size: "sm" })}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
