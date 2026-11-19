"use client";

import { LoaderCircleIcon } from "lucide-react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

/** The card's Start exam button: disabled while the server starts the attempt, so one tap starts one exam. */
export function StartButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending} data-testid="start-exam">
      {pending ? <LoaderCircleIcon data-icon="inline-start" className="motion-safe:animate-spin" aria-hidden="true" /> : null}
      {pending ? "Starting…" : "Start exam"}
    </Button>
  );
}
