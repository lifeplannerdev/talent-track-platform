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
import { grantAttemptAction } from "./actions";
import { grantMessage } from "./messages";
import { useGrantStatus } from "./grant-status";

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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const announce = useGrantStatus();

  const grant = () =>
    startTransition(async () => {
      setError(null);
      try {
        const result = await grantAttemptAction(studentId, examSetId);
        setOpen(false);
        if (result.ok) announce(`Attempt granted to ${studentName} for ${examSetName}.`);
        else setError(grantMessage(result));
      } catch {
        setOpen(false);
        setError("The attempt could not be granted. Please try again.");
      }
    });

  return (
    <div className="flex flex-col items-start gap-2">
      <Button type="button" size="sm" onClick={() => setOpen(true)} disabled={pending}>
        {pending ? "Granting…" : label}
      </Button>
      {error ? (
        <Alert variant="destructive" className="max-w-xs">
          <AlertDescription data-testid="grant-error" role="status">
            {error}
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
