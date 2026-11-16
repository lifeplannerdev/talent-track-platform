"use client";

import { useState, useTransition } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { grantAttemptAction, type GrantActionResult } from "./actions";

const REFUSALS: Record<string, string> = {
  grant_exists: "This student already has an unused attempt for this exam.",
  in_progress: "This student is taking this exam right now.",
  assignment_passed: "This student has already passed this curriculum.",
  not_assigned: "This exam is not assigned to this student any more.",
  exam_set_not_found: "This exam no longer exists.",
};

function messageFor(result: Exclude<GrantActionResult, { ok: true }>): string {
  if (result.error === "shortfall") {
    return `Only ${result.unseenAvailable} unseen questions left, ${result.needed} needed`;
  }
  return REFUSALS[result.error] ?? "The attempt could not be granted. Please try again.";
}

type Props = {
  studentId: string;
  examSetId: string;
  studentName: string;
  examSetName: string;
  /** Button text, e.g. "Grant another attempt" or "Give attempt". */
  label: string;
  /** Extra sentence in the confirm dialog (e.g. that a block is lifted). */
  note?: string;
};

export function GrantButton({ studentId, examSetId, studentName, examSetName, label, note }: Props) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const grant = () =>
    startTransition(async () => {
      setMessage(null);
      try {
        const result = await grantAttemptAction(studentId, examSetId);
        setOpen(false);
        setMessage(result.ok ? { kind: "success", text: "Attempt granted." } : { kind: "error", text: messageFor(result) });
      } catch {
        setOpen(false);
        setMessage({ kind: "error", text: "The attempt could not be granted. Please try again." });
      }
    });

  return (
    <div className="flex flex-col items-start gap-2">
      <Button type="button" size="sm" onClick={() => setOpen(true)} disabled={pending}>
        {pending ? "Granting…" : label}
      </Button>
      {message ? (
        <Alert variant={message.kind === "error" ? "destructive" : "default"} className="max-w-xs">
          <AlertDescription data-testid={message.kind === "error" ? "grant-error" : "grant-success"} role="status">
            {message.text}
          </AlertDescription>
        </Alert>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Give {studentName} an attempt?</DialogTitle>
            <DialogDescription>
              {studentName} can then start {examSetName} once, with questions they have not seen before.
              {note ? ` ${note}` : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button type="button" onClick={grant} disabled={pending}>
              {pending ? "Granting…" : "Grant attempt"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
