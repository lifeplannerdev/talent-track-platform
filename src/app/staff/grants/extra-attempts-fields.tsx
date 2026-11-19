"use client";

import { cn } from "cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { MAX_EXTRA_ATTEMPTS } from "./messages";

/**
 * The two inputs of the Extra attempts form: how many (1..10) and whether exam sets the student
 * already had may be given again. Controlled; ExtraAttemptsButton owns the state and the action.
 * `repeatsLocked`: repeats are already allowed for this student (giving never switches them off).
 */
export function ExtraAttemptsFields({
  idPrefix,
  count,
  onCount,
  countError,
  repeats,
  onRepeats,
  repeatsLocked,
}: {
  idPrefix: string;
  count: string;
  onCount: (v: string) => void;
  countError?: string;
  repeats: boolean;
  onRepeats: (v: boolean) => void;
  repeatsLocked: boolean;
}) {
  const countId = `${idPrefix}-count`;
  const repeatsId = `${idPrefix}-repeats`;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={countId}>Number of extra attempts</Label>
        <Input
          id={countId}
          type="number"
          inputMode="numeric"
          autoComplete="off"
          min={1}
          max={MAX_EXTRA_ATTEMPTS}
          step={1}
          required
          value={count}
          onChange={(e) => onCount(e.target.value)}
          aria-invalid={countError ? true : undefined}
          aria-describedby={`${countId}-hint`}
          className="w-24 tabular-nums"
        />
        <p id={`${countId}-hint`} className={cn("text-xs", countError ? "text-destructive" : "text-muted-foreground")}>
          {countError ?? `From 1 to ${MAX_EXTRA_ATTEMPTS}. They are added to the attempts the student has left.`}
        </p>
      </div>
      <div className="flex items-start gap-3">
        <Switch
          id={repeatsId}
          checked={repeats}
          onCheckedChange={(v) => onRepeats(v)}
          disabled={repeatsLocked}
          aria-labelledby={`${repeatsId}-label`}
          aria-describedby={`${repeatsId}-hint`}
          className="mt-0.5"
        />
        <div className="flex flex-col gap-1">
          <Label id={`${repeatsId}-label`} htmlFor={repeatsId}>
            Allow repeating exam sets
          </Label>
          <p id={`${repeatsId}-hint`} className="text-xs text-muted-foreground">
            {repeatsLocked ? "Already allowed for this student. " : null}
            When every exam set has been used, exam sets this student already had are given again (the one used
            longest ago first, with questions they have not seen first).
          </p>
        </div>
      </div>
    </div>
  );
}
