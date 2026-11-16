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
import { releaseAttemptAction } from "../actions";

type Props = {
  attemptId: string;
  /** False when already released or not scored yet. */
  canRelease: boolean;
  disabledLabel: string;
  summary: string;
};

export function ReleaseButton({ attemptId, canRelease, disabledLabel, summary }: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!canRelease) {
    return (
      <Button type="button" disabled>
        {disabledLabel}
      </Button>
    );
  }

  const release = () =>
    startTransition(async () => {
      setError(null);
      const result = await releaseAttemptAction(attemptId);
      if (result.ok) {
        setOpen(false);
      } else {
        setError("The result could not be released. Please try again.");
      }
    });

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" onClick={() => setOpen(true)}>
        Release result
      </Button>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription data-testid="release-error">{error}</AlertDescription>
        </Alert>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Release this result?</DialogTitle>
            <DialogDescription>
              The student will see their score ({summary}) and whether they passed. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button type="button" onClick={release} disabled={pending}>
              {pending ? "Releasing…" : "Release"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
