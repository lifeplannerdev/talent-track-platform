"use client";

import { useState, useTransition } from "react";
import { cn } from "cn";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_CURRICULUM_ATTEMPTS } from "@/lib/exam-set-fields";
import { saveCurriculum } from "../actions";

/** Name and attempts per student of one curriculum (saveCurriculum with maxAttempts). */
export function CurriculumSettingsForm({ id, name, maxAttempts }: { id: string; name: string; maxAttempts: number }) {
  const [values, setValues] = useState({ name, maxAttempts: String(maxAttempts) });
  const [errors, setErrors] = useState<{ name?: string; maxAttempts?: string }>({});
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const changed = values.name.trim() !== name || values.maxAttempts.trim() !== String(maxAttempts);

  const submit = () =>
    startTransition(async () => {
      setErrors({});
      setSaved(false);
      try {
        const r = await saveCurriculum({ id, name: values.name, maxAttempts: values.maxAttempts });
        if (!r.ok) return setErrors(r.errors?.maxAttempts ? { maxAttempts: r.errors.maxAttempts } : { name: r.message });
        setSaved(true);
      } catch {
        setErrors({ name: "The curriculum could not be saved. Please try again." });
      }
    });

  return (
    <form action={submit} className="flex flex-col gap-4" aria-label="Curriculum settings">
      <div className="grid max-w-3xl gap-x-6 gap-y-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`curriculum-name-${id}`}>Name</Label>
          <Input
            id={`curriculum-name-${id}`}
            required
            maxLength={120}
            value={values.name}
            onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? `curriculum-name-${id}-error` : undefined}
          />
          {errors.name ? (
            <p id={`curriculum-name-${id}-error`} className="text-xs text-destructive">
              {errors.name}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`curriculum-attempts-${id}`}>Attempts per student</Label>
          <Input
            id={`curriculum-attempts-${id}`}
            type="number"
            inputMode="numeric"
            autoComplete="off"
            min={1}
            max={MAX_CURRICULUM_ATTEMPTS}
            step={1}
            required
            value={values.maxAttempts}
            onChange={(e) => setValues((v) => ({ ...v, maxAttempts: e.target.value }))}
            aria-invalid={errors.maxAttempts ? true : undefined}
            aria-describedby={`curriculum-attempts-${id}-hint`}
            className="w-24 tabular-nums"
          />
          <p id={`curriculum-attempts-${id}-hint`} className={cn("text-xs", errors.maxAttempts ? "text-destructive" : "text-muted-foreground")}>
            {errors.maxAttempts ??
              `Students get this many attempts at this curriculum without approval (1 to ${MAX_CURRICULUM_ATTEMPTS}, standard 2). Staff can give extra attempts. Students who are already blocked stay blocked until you give them extra attempts.`}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="outline" disabled={pending || !changed || !values.name.trim()}>
          {pending ? "Saving…" : "Save curriculum"}
        </Button>
        <div aria-live="polite" className="text-sm">
          {saved && !changed ? (
            <Alert variant="success" className="px-3 py-1.5" data-testid="curriculum-saved">
              <AlertDescription>Curriculum saved.</AlertDescription>
            </Alert>
          ) : null}
        </div>
      </div>
    </form>
  );
}
