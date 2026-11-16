"use client";

import { Button } from "@/components/ui/button";

export default function ReviewError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-10">
      <h1 className="text-xl font-semibold">Results could not be loaded</h1>
      <p className="text-sm text-muted-foreground">Check your connection and try again.</p>
      <div>
        <Button onClick={reset}>Try again</Button>
      </div>
    </main>
  );
}
