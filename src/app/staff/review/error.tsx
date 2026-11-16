"use client";

import { ErrorState } from "@/components/app/error-state";

export default function ReviewError({ reset }: { error: Error; reset: () => void }) {
  return (
    <ErrorState title="Results could not be loaded" onRetry={reset}>
      <p>Check your connection and try again.</p>
    </ErrorState>
  );
}
