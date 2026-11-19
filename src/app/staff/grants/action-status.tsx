"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";

// Page-level confirmation for extra attempts: a row may disappear from the list once the server
// re-renders it (a blocked student is no longer blocked), so the success message lives here,
// outside the table, in a polite live region.

const ActionStatusContext = createContext<(message: string) => void>(() => {});

export function useActionStatus() {
  return useContext(ActionStatusContext);
}

export function ActionStatusProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  return (
    <ActionStatusContext.Provider value={setMessage}>
      <div aria-live="polite" role="status">
        {message ? (
          <Alert variant="success">
            <AlertDescription data-testid="grant-success">{message}</AlertDescription>
          </Alert>
        ) : null}
      </div>
      {children}
    </ActionStatusContext.Provider>
  );
}
