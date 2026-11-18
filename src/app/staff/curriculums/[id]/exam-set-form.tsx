"use client";

import { useState, useTransition } from "react";
import { cn } from "cn";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { durationFromParts, MAX_DURATION_MIN, splitDuration } from "@/lib/duration";
import {
  DEFAULT_REMINDER_INTERVAL_MIN,
  examSetSummary,
  formatTopicMix,
  MAX_REMINDER_INTERVAL_MIN,
  parseTopicMixText,
  validateExamSetFields,
  type ExamSetField,
  type TopicMix,
} from "@/lib/exam-set-fields";
import { saveExamSet } from "../actions";

export type ExamSetInitial = {
  id?: string;
  name: string;
  questionCount: number;
  timeLimitMin: number;
  passMarkPercent: number;
  maxAttempts: number;
  holdResult: boolean;
  topicMix: TopicMix;
  reminderIntervalMin: number;
};

export const NEW_EXAM_SET: ExamSetInitial = {
  name: "",
  questionCount: 20,
  timeLimitMin: 30,
  passMarkPercent: 60,
  maxAttempts: 2,
  holdResult: true,
  topicMix: {},
  reminderIntervalMin: DEFAULT_REMINDER_INTERVAL_MIN,
};

type Values = {
  name: string;
  questionCount: string;
  hours: string;
  minutes: string;
  passMarkPercent: string;
  maxAttempts: string;
  reminderIntervalMin: string;
  holdResult: boolean;
  topicMixText: string;
};

const DURATION_PARTS_ERROR = "Enter whole hours and 0 to 59 minutes";

function hintClass(error?: string) {
  return cn("text-xs", error ? "text-destructive" : "text-muted-foreground");
}

function NumberField({
  id,
  label,
  hint,
  value,
  error,
  onChange,
  min,
  max,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  error?: string;
  onChange: (v: string) => void;
  min: number;
  max: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-hint` : undefined}
      />
      {error || hint ? (
        <p id={`${id}-hint`} className={hintClass(error)}>
          {error ?? hint}
        </p>
      ) : null}
    </div>
  );
}

/** Hours and minutes side by side, stored as minutes. */
function DurationField({
  prefix,
  hours,
  minutes,
  error,
  onHours,
  onMinutes,
}: {
  prefix: string;
  hours: string;
  minutes: string;
  error?: string;
  onHours: (v: string) => void;
  onMinutes: (v: string) => void;
}) {
  const hintId = `${prefix}-duration-hint`;
  const part = (id: string, label: string, unit: string, value: string, onChange: (v: string) => void, max: number) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={0}
          max={max}
          step={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={hintId}
          className="w-24 tabular-nums"
        />
        <span aria-hidden="true" className="text-sm text-muted-foreground">
          {unit}
        </span>
      </div>
    </div>
  );
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 text-sm leading-none font-medium">Time limit</legend>
      <div className="flex flex-wrap gap-4">
        {part(`${prefix}-hours`, "Hours", "h", hours, onHours, MAX_DURATION_MIN / 60)}
        {part(`${prefix}-minutes`, "Minutes", "min", minutes, onMinutes, 59)}
      </div>
      <p id={hintId} className={hintClass(error)}>
        {error ?? "From 1 min to 12 h. The countdown starts when the student presses Start."}
      </p>
    </fieldset>
  );
}

export function ExamSetForm({ curriculumId, initial, onSaved }: { curriculumId: string; initial: ExamSetInitial; onSaved?: () => void }) {
  const isNew = !initial.id;
  const prefix = initial.id ? `set-${initial.id}` : "new-set";
  const startDuration = splitDuration(initial.timeLimitMin);
  const [values, setValues] = useState<Values>({
    name: initial.name,
    questionCount: String(initial.questionCount),
    hours: String(startDuration.hours),
    minutes: String(startDuration.minutes),
    passMarkPercent: String(initial.passMarkPercent),
    maxAttempts: String(initial.maxAttempts),
    reminderIntervalMin: String(initial.reminderIntervalMin),
    holdResult: initial.holdResult,
    topicMixText: formatTopicMix(initial.topicMix),
  });
  const [errors, setErrors] = useState<Partial<Record<ExamSetField, string>>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ warnings: string[] } | null>(null);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof Values>(key: K) => (v: Values[K]) => setValues((old) => ({ ...old, [key]: v }));

  const timeLimitMin = durationFromParts(values.hours, values.minutes);
  const fields = {
    name: values.name || "-",
    questionCount: values.questionCount,
    timeLimitMin: timeLimitMin ?? "",
    passMarkPercent: values.passMarkPercent,
    maxAttempts: values.maxAttempts,
    holdResult: values.holdResult,
    topicMix: {},
    reminderIntervalMin: values.reminderIntervalMin,
  };
  // Live preview of what students will get, once the numbers are valid.
  const preview = validateExamSetFields(fields);

  const submit = () =>
    startTransition(async () => {
      setErrors({});
      setMessage(null);
      setSaved(null);
      if (timeLimitMin === null) return setErrors({ timeLimitMin: DURATION_PARTS_ERROR });
      const mix = parseTopicMixText(values.topicMixText);
      if (!mix.ok) return setErrors({ topicMix: mix.message });
      try {
        const r = await saveExamSet({
          ...(initial.id ? { id: initial.id } : {}),
          curriculumId,
          name: values.name,
          questionCount: values.questionCount,
          timeLimitMin,
          passMarkPercent: values.passMarkPercent,
          maxAttempts: values.maxAttempts,
          holdResult: values.holdResult,
          topicMix: mix.mix,
          reminderIntervalMin: values.reminderIntervalMin,
        });
        if (!r.ok) {
          setErrors(r.errors ?? {});
          setMessage(r.message ?? "Check the highlighted fields.");
          return;
        }
        setSaved({ warnings: r.warnings });
        if (isNew) setValues((v) => ({ ...v, name: "", topicMixText: "" }));
        onSaved?.();
      } catch {
        setMessage("The exam set could not be saved. Please try again.");
      }
    });

  return (
    <form action={submit} className="flex flex-col gap-5" aria-label={isNew ? "New exam set" : `Settings for ${initial.name}`}>
      {!isNew ? (
        <Alert variant="warning" data-testid="exam-set-edit-warning">
          <AlertDescription>
            Exams already in progress keep their questions and time limit, but the pass mark and result holding saved here
            apply to them when they are submitted. Change these outside exam times when you can.
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${prefix}-name`}>Exam set name</Label>
        <Input
          id={`${prefix}-name`}
          required
          maxLength={120}
          value={values.name}
          onChange={(e) => set("name")(e.target.value)}
          aria-invalid={errors.name ? true : undefined}
        />
        {errors.name ? <p className="text-xs text-destructive">{errors.name}</p> : null}
      </div>
      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
        <NumberField
          id={`${prefix}-count`}
          label="Questions per paper"
          hint="Every attempt draws this many approved questions the student has not seen."
          value={values.questionCount}
          error={errors.questionCount}
          onChange={set("questionCount")}
          min={1}
          max={500}
        />
        <DurationField
          prefix={prefix}
          hours={values.hours}
          minutes={values.minutes}
          error={errors.timeLimitMin}
          onHours={set("hours")}
          onMinutes={set("minutes")}
        />
        <NumberField
          id={`${prefix}-pass`}
          label="Pass mark (%)"
          hint="0 to 100 percent of the points."
          value={values.passMarkPercent}
          error={errors.passMarkPercent}
          onChange={set("passMarkPercent")}
          min={0}
          max={100}
        />
        <NumberField
          id={`${prefix}-attempts`}
          label="Maximum attempts"
          hint="After the last failed attempt the student is blocked until you give another."
          value={values.maxAttempts}
          error={errors.maxAttempts}
          onChange={set("maxAttempts")}
          min={1}
          max={50}
        />
        <NumberField
          id={`${prefix}-reminder`}
          label="Time reminder every (minutes)"
          hint="Students see how much time is left at each interval and at 5 and 1 minute. Enter 0 for no reminders."
          value={values.reminderIntervalMin}
          error={errors.reminderIntervalMin}
          onChange={set("reminderIntervalMin")}
          min={0}
          max={MAX_REMINDER_INTERVAL_MIN}
        />
      </div>
      <div className="flex items-start gap-2">
        <input
          id={`${prefix}-hold`}
          type="checkbox"
          checked={values.holdResult}
          onChange={(e) => set("holdResult")(e.target.checked)}
          className="mt-0.5 size-4 rounded border-input accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
        <Label htmlFor={`${prefix}-hold`} className="flex-col items-start gap-1 leading-snug">
          Hold results for review
          <span className="text-xs font-normal text-muted-foreground">Students see their result only after you release it.</span>
        </Label>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${prefix}-mix`}>Topic mix (optional)</Label>
        <Textarea
          id={`${prefix}-mix`}
          rows={3}
          value={values.topicMixText}
          onChange={(e) => set("topicMixText")(e.target.value)}
          placeholder={"Pflege: 12\nRecht: 8"}
          aria-invalid={errors.topicMix ? true : undefined}
          aria-describedby={`${prefix}-mix-hint`}
        />
        <p id={`${prefix}-mix-hint`} className={hintClass(errors.topicMix)}>
          {errors.topicMix ?? "One “topic: count” per line. The counts must add up to the questions per paper. Leave empty to draw from all topics."}
        </p>
      </div>
      <div className="flex flex-col gap-1 rounded-md border-l-2 border-primary bg-muted/70 px-3.5 py-2.5" data-testid="exam-set-preview">
        <p className="text-xs font-medium text-muted-foreground">Students will get</p>
        <p className="text-sm">
          {preview.ok ? examSetSummary(preview.value) : "Fill in the settings above to see what students will get."}
        </p>
      </div>
      <div aria-live="polite" className="flex flex-col gap-2">
        {message ? (
          <Alert variant="destructive">
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : null}
        {saved ? (
          <Alert variant={saved.warnings.length > 0 ? "warning" : "success"} data-testid="exam-set-saved">
            <AlertTitle>{isNew ? "Exam set created." : "Settings saved."}</AlertTitle>
            {saved.warnings.length > 0 ? (
              <AlertDescription>
                <ul className="list-disc pl-4" data-testid="exam-set-warnings">
                  {saved.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </AlertDescription>
            ) : null}
          </Alert>
        ) : null}
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : isNew ? "Create exam set" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}
