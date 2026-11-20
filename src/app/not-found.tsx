import Link from "next/link";
import { SearchXIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

// Shown for unknown pages and for records the signed-in user may not see (another student's
// result looks exactly like a missing one).
export default function NotFound() {
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto flex w-full max-w-xl flex-1 flex-col items-start gap-3 px-4 pt-10 pb-12 outline-none sm:pt-16">
      <span className="flex size-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
        <SearchXIcon aria-hidden="true" className="size-5" />
      </span>
      <h1 className="text-2xl font-semibold">This page could not be found</h1>
      <p className="text-base text-muted-foreground">
        The link may be old, or the page belongs to someone else. Go back to your start page.
      </p>
      <Link href="/" className={buttonVariants()}>
        Go to start page
      </Link>
    </main>
  );
}
