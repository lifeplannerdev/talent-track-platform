import { Suspense } from "react";
import Link from "next/link";
import { logout } from "@/app/login/actions";
import { requireRole } from "@/lib/auth/require-role";
import { PoweredBy, Wordmark } from "@/components/app/wordmark";
import { Button } from "@/components/ui/button";
import { StaffNav } from "./staff-nav";

// Shared staff chrome: wordmark, section navigation and sign out. Pages render their own <main>.
// The proxy and each page's guard control access; the layout only reads the role (one cheap
// requireRole("staff") in a small server component under Suspense) to hide admin-only nav items.
// Below lg the navigation is one row under the wordmark that scrolls sideways inside itself
// (never the page); from lg it sits inline between the wordmark and sign out.
async function RoleNav() {
  const profile = await requireRole("staff");
  return <StaffNav role={profile.role} />;
}

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-b bg-card lg:sticky lg:top-0 lg:z-20 print:hidden">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-6 px-4 sm:px-6 lg:flex-nowrap lg:px-8">
          <Link href="/staff" className="order-1 flex h-14 items-center rounded-md">
            <Wordmark />
          </Link>
          <div className="order-3 -mx-4 min-w-0 basis-[calc(100%+2rem)] border-t sm:-mx-6 sm:basis-[calc(100%+3rem)] lg:order-2 lg:mx-0 lg:flex-1 lg:basis-auto lg:border-t-0">
            <Suspense fallback={<div className="h-11 lg:h-14" />}>
              <RoleNav />
            </Suspense>
          </div>
          <form action={logout} className="order-2 ml-auto lg:order-3 lg:ml-0">
            <Button type="submit" variant="ghost" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      <span id="main-content" tabIndex={-1} className="outline-none" />
      {children}
      <footer className="mt-auto border-t bg-card print:hidden">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8">
          <Wordmark compact />
          <PoweredBy className="text-xs" />
        </div>
      </footer>
    </>
  );
}
