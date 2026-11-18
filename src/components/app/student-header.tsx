import { logout } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { Wordmark } from "./wordmark";

/** Quiet top bar for the student pages outside the exam itself. Hidden in print. */
export function StudentHeader({ signOut = false }: { signOut?: boolean }) {
  return (
    <header className="border-b bg-card print:hidden">
      <div className="mx-auto flex h-14 w-full max-w-2xl items-center justify-between gap-3 px-4">
        <Wordmark />
        {signOut ? (
          <form action={logout}>
            <Button type="submit" variant="ghost" size="sm">
              Sign out
            </Button>
          </form>
        ) : null}
      </div>
    </header>
  );
}
