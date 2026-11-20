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
import { useActionStatus } from "./action-status";
import { ExtraAttemptsFields } from "./extra-attempts-fields";
import { extraAttemptsMessage, extraAttemptsSuccess, parseExtraAttemptsCount } from "./messages";

type Props = {
  studentId: string;
  curriculumId: string;
  studentName: string;
  curriculumName: string;
  attemptsUsed: number;
  allowance: number;
  blocked: boolean;
  /** Repeats are already allowed for this student in this curriculum. */
  allowRepeats: boolean;
  /** Start with repeats switched on (no exam set left the student has not had). */
  suggestRepeats: boolean;
  size?: "sm" | "default";
};

/**
 * "Give extra attempts": opens a dialog with the count (1..10) and the Allow repeating exam sets
 * switch, then calls giveExtraAttemptsAction (staff session; identity comes from the session).
 * Success is announced at page level (ActionStatusProvider), a refusal next to the button.
 */
export function ExtraAttemptsButton({
  studentId,
  curriculumId,
  studentName,
  curriculumName,
  attemptsUsed,
  allowance,
  blocked,
  allowRepeats,
  suggestRepeats,
  size = "sm",
}: Props) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState("1");
  const [repeats, setRepeats] = useState(allowRepeats || suggestRepeats);
  const [countError, setCountError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const announce = useActionStatus();
  const idPrefix = `extra-${studentId}-${curriculumId}`;

  const openDialog = () => {
    setCount("1");
    setRepeats(allowRepeats || suggestRepeats);
    setCountError(undefined);
    setError(null);
    setOpen(true);
  };

  const give = () => {
    const n = parseExtraAttemptsCount(count);
    if (n === null) {
      setCountError(extraAttemptsMessage({ ok: false, error: "invalid_n" }));
      return;
    }
    startTransition(async () => {
      setError(null);
      try {
        const result = await giveExtraAttemptsAction({ studentId, curriculumId, n, allowRepeats: repeats });
        setOpen(false);
        if (result.ok) {
          announce(
            extraAttemptsSuccess({
              n,
              studentName,
              curriculumName,
              allowRepeats: repeats && !allowRepeats,
              wasBlocked: blocked,
              stillBlocked: result.stillBlocked,
            }),
          );
        } else {
          setError(extraAttemptsMessage(result));
        }
      } catch {
        setOpen(false);
        setError(extraAttemptsMessage({ ok: false, error: "failed" }));
      }
    });
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <Button type="button" size={size} onClick={openDialog} disabled={pending}>
        {pending ? "Giving…" : "Give extra attempts"}
        <span className="sr-only">
          {" "}
          to {studentName} for {curriculumName}
        </span>
      </Button>
      {error ? (
        <Alert variant="destructive" className="max-w-xs">
          <AlertDescription data-testid="grant-error" role="alert">
            {error}
          </AlertDescription>
        </Alert>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form
            className="flex flex-col gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              give();
            }}
          >
            <DialogHeader>
              <DialogTitle>Give {studentName} extra attempts</DialogTitle>
              <DialogDescription>
                {curriculumName}: {attemptsUsed} of {allowance} attempt{allowance === 1 ? "" : "s"} used.
                {blocked ? " Giving attempts lifts the block." : null}
              </DialogDescription>
            </DialogHeader>
            <ExtraAttemptsFields
              idPrefix={idPrefix}
              count={count}
              onCount={(v) => {
                setCount(v);
                setCountError(undefined);
              }}
              countError={countError}
              repeats={repeats}
              onRepeats={setRepeats}
              repeatsLocked={allowRepeats}
            />
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
              <Button type="submit" disabled={pending}>
                {pending ? "Giving…" : "Give extra attempts"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
