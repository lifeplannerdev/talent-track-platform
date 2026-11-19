"use client";

import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { assignCurriculum, removeCurriculum, reorderCurriculums } from "../actions";

function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}

/** Up/down buttons; sends the whole new order so the server can check it is still current. */
export function MoveButtons({ studentId, order, index, name }: { studentId: string; order: string[]; index: number; name: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const move = (delta: -1 | 1) =>
    startTransition(async () => {
      setError(null);
      const next = order.slice();
      [next[index], next[index + delta]] = [next[index + delta], next[index]];
      try {
        const r = await reorderCurriculums(studentId, next);
        if (!r.ok) setError(r.message);
      } catch {
        setError("The order could not be saved.");
      }
    });

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1">
        <Button type="button" size="icon-sm" variant="ghost" aria-label={`Move ${name} up`} disabled={pending || index === 0} onClick={() => move(-1)}>
          <ArrowUp aria-hidden="true" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={`Move ${name} down`}
          disabled={pending || index === order.length - 1}
          onClick={() => move(1)}
        >
          <ArrowDown aria-hidden="true" />
        </Button>
      </div>
      <ErrorText message={error} />
    </div>
  );
}

export function RemoveCurriculumButton({
  studentId,
  studentName,
  curriculumId,
  curriculumName,
  attempts,
}: {
  studentId: string;
  studentName: string;
  curriculumId: string;
  curriculumName: string;
  attempts: number;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const remove = () =>
    startTransition(async () => {
      setError(null);
      try {
        // The dialog below states the attempts that are kept, so confirming it is the explicit confirm.
        const r = await removeCurriculum(studentId, curriculumId, { confirm: attempts > 0 });
        setOpen(false);
        if (!r.ok) setError(r.message);
      } catch {
        setOpen(false);
        setError("The curriculum could not be removed.");
      }
    });

  return (
    <div className="flex flex-col items-start gap-1">
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)} disabled={pending}>
        Remove<span className="sr-only"> {curriculumName}</span>
      </Button>
      <ErrorText message={error} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Remove {curriculumName} from {studentName}?
            </DialogTitle>
            <DialogDescription>
              {attempts > 0
                ? `${studentName} has ${attempts} attempt${attempts === 1 ? "" : "s"} in this curriculum. Only the assignment is removed; the attempts and results are kept for the record. Extra attempts given for it are withdrawn.`
                : `${studentName} will no longer see this curriculum. Extra attempts given for it are withdrawn.`}
            </DialogDescription>
            <DialogDescription data-testid="remove-reset-note">
              If you add this curriculum again later, the attempts already used still count and extra attempts start again from none.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button type="button" variant="destructive" onClick={remove} disabled={pending}>
              {pending ? "Removing…" : "Remove curriculum"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function AddCurriculumForm({ studentId, options }: { studentId: string; options: { id: string; name: string }[] }) {
  const [value, setValue] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (options.length === 0) {
    return <p className="text-sm text-muted-foreground">Every curriculum is already assigned.</p>;
  }

  const add = () =>
    startTransition(async () => {
      setError(null);
      try {
        const r = await assignCurriculum(studentId, value);
        if (r.ok) setValue("");
        else setError(r.message);
      } catch {
        setError("The curriculum could not be assigned.");
      }
    });

  return (
    <form action={add} className="flex flex-wrap items-end gap-3" aria-label="Add curriculum">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="add-curriculum">Add curriculum</Label>
        <NativeSelect id="add-curriculum" value={value} onChange={(e) => setValue(e.target.value)} required>
          <NativeSelectOption value="" disabled>
            Choose a curriculum
          </NativeSelectOption>
          {options.map((o) => (
            <NativeSelectOption key={o.id} value={o.id}>
              {o.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <Button type="submit" variant="outline" disabled={pending || !value}>
        {pending ? "Adding…" : "Add"}
      </Button>
      {error ? (
        <Alert variant="destructive" className="w-full">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </form>
  );
}
