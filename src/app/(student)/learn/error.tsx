"use client";

import { ErrorState } from "@/components/app/error-state";

export default function LearnError({ reset }: { error: Error; reset: () => void }) {
  return (
    <ErrorState skipTarget title="Your learning could not be loaded" onRetry={reset}>
      <p>Check your connection and try again.</p>
    </ErrorState>
  );
}
