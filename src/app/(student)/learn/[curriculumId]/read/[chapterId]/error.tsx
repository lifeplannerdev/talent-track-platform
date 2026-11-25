"use client";

import { ErrorState } from "@/components/app/error-state";

export default function ReaderError({ reset }: { error: Error; reset: () => void }) {
  return (
    <ErrorState skipTarget title="The book could not be loaded" onRetry={reset}>
      <p>Check your connection and try again.</p>
    </ErrorState>
  );
}
