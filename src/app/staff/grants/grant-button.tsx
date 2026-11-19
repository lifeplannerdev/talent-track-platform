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
import { giveExtraAttemptsAction } from "./actions";
import { extraAttemptsMessage } from "./messages";
import { useGrantStatus } from "./grant-status";

// Gives one extra attempt in a curriculum (optionally allowing repeated exam sets). Minimal
// control for spec change 1; Task 4 builds the Extra attempts form (1..10, repeats toggle).
type Props = {
  studentId: string;
  curriculumId: string;
  studentName: string;
  curriculumName: string;
  /** Button text, e.g. "Give an extra attempt". */
  label: string;
  /** Also let exam sets the student already had be given again. */
  allowRepeats?: boolean;
  /** Extra sentence in the confirm dialog (e.g. that a block is lifted). */
  note?: string;
};

export function GrantButton({ studentId, curriculumId, studentName, curriculumName, label, allowRepeats = false, note }: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const announce = useGrantStatus();

  const grant = () =>
    startTransition(async () => {
      setError(null);
      try {
        const result = await giveExtraAttemptsAction({ studentId, curriculumId, n: 1, allowRepeats });
        setOpen(false);
        if (result.ok) announce(`Extra attempt given to ${studentName} for ${curriculumName}.`);
        else setError(extraAttemptsMessage(result));
      } catch {
        setOpen(false);
        setError("The extra attempts could not be given. Please try again.");
      }
    });

  return (
    <div className="flex flex-col items-start gap-2">
      <Button type="button" size="sm" onClick={() => setOpen(true)} disabled={pending}>
        {pending ? "Giving…" : label}
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
            <DialogTitle>Give {studentName} an extra attempt?</DialogTitle>
            <DialogDescription>
              {studentName} gets one more attempt at {curriculumName}
              {allowRepeats ? ", and exam sets they already had may be given again" : ""}.
              {note ? ` ${note}` : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button type="button" onClick={grant} disabled={pending}>
              {pending ? "Giving…" : "Give extra attempt"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
