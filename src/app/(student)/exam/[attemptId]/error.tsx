"use client";

import { Button } from "@/components/ui/button";

export default function ExamError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-10">
      <h1 className="text-xl font-semibold">The exam could not be loaded</h1>
      <p className="text-sm text-muted-foreground">
        Your saved answers are safe and the timer keeps running on the server. Check your connection and try again.
      </p>
      <div>
        <Button onClick={reset}>Try again</Button>
      </div>
    </main>
  );
}
