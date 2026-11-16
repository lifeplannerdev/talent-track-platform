"use client";

import { ErrorState } from "@/components/app/error-state";

export default function ExamError({ reset }: { error: Error; reset: () => void }) {
  return (
    <ErrorState title="The exam could not be loaded" onRetry={reset}>
      <p>Your saved answers are safe and the timer keeps running on the server. Check your connection and try again.</p>
    </ErrorState>
  );
}
