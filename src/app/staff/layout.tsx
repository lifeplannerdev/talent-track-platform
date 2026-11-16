import { Suspense } from "react";
import Link from "next/link";
import { logout } from "@/app/login/actions";
import { Wordmark } from "@/components/app/wordmark";
import { Button } from "@/components/ui/button";
import { StaffNav } from "./staff-nav";

// Shared staff chrome: wordmark, section navigation and sign out. Pages render their own <main>.
// The proxy and each page's requireRole('staff') guard access; this layout reads no session.
// On phones the navigation wraps onto its own rows under the wordmark; from lg it sits inline.
export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/staff" className="order-1 rounded-md">
            <Wordmark />
          </Link>
          <div className="order-3 min-w-0 basis-full lg:order-2 lg:flex-1 lg:basis-auto">
            <Suspense fallback={<div className="h-9" />}>
              <StaffNav />
            </Suspense>
          </div>
          <form action={logout} className="order-2 ml-auto lg:order-3 lg:ml-0">
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      {children}
    </>
  );
}
