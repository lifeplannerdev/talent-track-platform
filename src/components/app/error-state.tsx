import { CircleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Designed error state for route error boundaries: what happened, what is safe, how to retry.
 * `skipTarget`: this <main> is the skip-link target (student error boundaries replace the page and
 * its header, where the target normally sits; staff pages keep theirs in the shared header).
 */
export function ErrorState({
  title,
  children,
  onRetry,
  skipTarget = false,
}: {
  title: string;
  children: React.ReactNode;
  onRetry: () => void;
  skipTarget?: boolean;
}) {
  return (
    <main
      id={skipTarget ? "main-content" : undefined}
      tabIndex={skipTarget ? -1 : undefined}
      className="mx-auto flex w-full max-w-xl flex-1 flex-col items-start gap-3 px-4 pt-10 pb-12 outline-none sm:pt-16"
    >
      <span className="flex size-10 items-center justify-center rounded-lg bg-destructive-muted text-destructive">
        <CircleAlertIcon aria-hidden="true" className="size-5" />
      </span>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="text-base text-muted-foreground">{children}</div>
      <Button onClick={onRetry}>Try again</Button>
    </main>
  );
}
