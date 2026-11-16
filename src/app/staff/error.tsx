"use client";

import { ErrorState } from "@/components/app/error-state";

export default function StaffError({ reset }: { error: Error; reset: () => void }) {
  return (
    <ErrorState title="This page could not be loaded" onRetry={reset}>
      <p>Check your connection and try again.</p>
    </ErrorState>
  );
}
