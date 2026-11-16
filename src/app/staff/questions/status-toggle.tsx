"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { QuestionStatus } from "@/lib/types";
import { setQuestionStatus } from "./actions";

export function StatusToggle({ questionId, status, label }: { questionId: string; status: QuestionStatus; label: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const next: QuestionStatus = status === "approved" ? "draft" : "approved";

  const toggle = () =>
    startTransition(async () => {
      setError(null);
      try {
        const r = await setQuestionStatus(questionId, next);
        if (!r.ok) setError(r.message);
      } catch {
        setError("The status could not be changed.");
      }
    });

  return (
    <span className="flex flex-col items-start gap-1">
      <Button type="button" size="sm" variant={next === "approved" ? "default" : "outline"} onClick={toggle} disabled={pending}>
        {pending ? "Saving…" : next === "approved" ? "Approve" : "Set to draft"}
        <span className="sr-only">: {label}</span>
      </Button>
      {error ? (
        <span role="alert" className="text-sm text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}
