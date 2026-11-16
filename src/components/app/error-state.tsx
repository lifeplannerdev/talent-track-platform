import { CircleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Designed error state for route error boundaries: what happened, what is safe, how to retry. */
export function ErrorState({ title, children, onRetry }: { title: string; children: React.ReactNode; onRetry: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-start gap-4 px-4 pt-16 pb-16">
      <span className="flex size-10 items-center justify-center rounded-lg bg-destructive-muted text-destructive">
        <CircleAlertIcon aria-hidden="true" className="size-5" />
      </span>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="text-base text-muted-foreground">{children}</div>
      <Button onClick={onRetry}>Try again</Button>
    </main>
  );
}
