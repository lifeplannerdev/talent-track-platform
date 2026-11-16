"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";

// Page-level confirmation for grants: a granted row disappears from the list after the server
// re-renders it, so the success message lives here, outside the table.

const GrantStatusContext = createContext<(message: string) => void>(() => {});

export function useGrantStatus() {
  return useContext(GrantStatusContext);
}

export function GrantStatusProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  return (
    <GrantStatusContext.Provider value={setMessage}>
      <div aria-live="polite">
        {message ? (
          <Alert>
            <AlertDescription data-testid="grant-success">{message}</AlertDescription>
          </Alert>
        ) : null}
      </div>
      {children}
    </GrantStatusContext.Provider>
  );
}
