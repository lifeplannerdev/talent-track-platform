"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";

// Page-level confirmation for extra attempts: a row may disappear from the list once the server
// re-renders it (a blocked student is no longer blocked), so the success message lives here,
// outside the table, in a polite live region. Refusals stay next to their button (role="alert").

export type ActionStatus = { id: number; message: string } | null;

/** Every success gets a new id, so the same text given twice is announced twice. */
export function nextActionStatus(prev: ActionStatus, message: string): { id: number; message: string } {
  return { id: (prev?.id ?? 0) + 1, message };
}

const ActionStatusContext = createContext<(message: string) => void>(() => {});

export function useActionStatus() {
  return useContext(ActionStatusContext);
}

/**
 * The polite region with the latest success. The node is keyed by the announcement id, so a new
 * success replaces it (screen readers announce the replacement); the Alert inside drops its own
 * assertive role="alert" so the outer role="status" governs.
 */
export function ActionStatusView({ status }: { status: ActionStatus }) {
  return (
    <div aria-live="polite" role="status">
      {status ? (
        <Alert key={status.id} variant="success" role="none" data-announcement={status.id}>
          <AlertDescription data-testid="grant-success">{status.message}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

export function ActionStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ActionStatus>(null);
  const announce = useCallback((message: string) => setStatus((prev) => nextActionStatus(prev, message)), []);
  return (
    <ActionStatusContext.Provider value={announce}>
      <ActionStatusView status={status} />
      {children}
    </ActionStatusContext.Provider>
  );
}
