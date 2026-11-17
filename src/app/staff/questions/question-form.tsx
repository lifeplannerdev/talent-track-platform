"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { OPTION_IDS, type OptionId } from "@/lib/question-fields";
import type { QuestionOption, QuestionStatus } from "@/lib/types";
import { saveQuestion } from "./actions";

export type ExamSetChoice = { id: string; name: string; curriculumName: string };

export type QuestionInitial = {
  id?: string;
  examSetId: string;
  topic: string;
  difficulty: string;
  stemDe: string;
  stemEn: string;
  options: QuestionOption[];
  correctOptionId: string;
  points: number;
  status: QuestionStatus;
  used?: boolean;
};

type Values = {
  examSetId: string;
  topic: string;
  difficulty: string;
  stemDe: string;
  stemEn: string;
  options: Record<OptionId, { de: string; en: string }>;
  correct: string;
  points: string;
  status: QuestionStatus;
};

function toValues(q: QuestionInitial): Values {
  const options = {} as Values["options"];
  for (const id of OPTION_IDS) {
    const o = q.options.find((x) => x.id === id);
    options[id] = { de: o?.de ?? "", en: o?.en ?? "" };
  }
  return {
    examSetId: q.examSetId,
    topic: q.topic,
    difficulty: q.difficulty,
    stemDe: q.stemDe,
    stemEn: q.stemEn,
    options,
    correct: q.correctOptionId || "a",
    points: String(q.points),
    status: q.status,
  };
}

function groupByCurriculum(sets: ExamSetChoice[]) {
  const groups = new Map<string, ExamSetChoice[]>();
  for (const s of sets) groups.set(s.curriculumName, [...(groups.get(s.curriculumName) ?? []), s]);
  return [...groups.entries()];
}

export function ExamSetSelect({
  id,
  sets,
  value,
  onChange,
  disabled,
  placeholder = "Choose an exam set",
}: {
  id: string;
  sets: ExamSetChoice[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} required className="w-full">
      <NativeSelectOption value="" disabled>
        {placeholder}
      </NativeSelectOption>
      {groupByCurriculum(sets).map(([curriculum, list]) => (
        <NativeSelectOptGroup key={curriculum} label={curriculum}>
          {list.map((s) => (
            <NativeSelectOption key={s.id} value={s.id}>
              {s.name}
            </NativeSelectOption>
          ))}
        </NativeSelectOptGroup>
      ))}
    </NativeSelect>
  );
}

/** Manual bilingual entry. Same validation as the CSV import (validateQuestionFields on the server). */
export function QuestionForm({ sets, initial }: { sets: ExamSetChoice[]; initial: QuestionInitial }) {
  const isNew = !initial.id;
  const [values, setValues] = useState<Values>(() => toValues(initial));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const set = <K extends keyof Values>(key: K, v: Values[K]) => setValues((old) => ({ ...old, [key]: v }));
  const setOption = (id: OptionId, lang: "de" | "en", v: string) =>
    setValues((old) => ({ ...old, options: { ...old.options, [id]: { ...old.options[id], [lang]: v } } }));

  const submit = () =>
    startTransition(async () => {
      setMessage(null);
      try {
        const r = await saveQuestion({
          ...(initial.id ? { id: initial.id } : {}),
          examSetId: values.examSetId,
          fields: {
            topic: values.topic,
            difficulty: values.difficulty,
            stemDe: values.stemDe,
            stemEn: values.stemEn,
            options: values.options,
            correct: values.correct,
            points: values.points,
          },
          status: values.status,
        });
        if (!r.ok) return setMessage({ ok: false, text: r.message });
        if (isNew) {
          setValues((v) => ({ ...toValues({ ...initial, examSetId: v.examSetId, topic: v.topic, difficulty: v.difficulty, status: v.status }) }));
          setMessage({ ok: true, text: "Question added." });
        } else {
          router.push(`/staff/questions?examSet=${values.examSetId}`);
        }
      } catch {
        setMessage({ ok: false, text: "The question could not be saved. Please try again." });
      }
    });

  return (
    <form action={submit} className="flex flex-col gap-4" aria-label={isNew ? "Add question" : "Edit question"}>
      {!isNew ? (
        <Alert variant="warning" data-testid="question-edit-warning">
          <AlertDescription>
            {initial.used
              ? "This question has been used in attempts. Stored marks of submitted attempts do not change. "
              : "Stored marks of submitted attempts never change. "}
            If a student has this question in an exam that is in progress right now, they see the change at once and it
            counts when that attempt is scored. Edit outside exam times when you can.
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="q-set">Exam set</Label>
          <ExamSetSelect id="q-set" sets={sets} value={values.examSetId} onChange={(v) => set("examSetId", v)} disabled={!isNew} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="q-topic">Topic</Label>
          <Input id="q-topic" required value={values.topic} onChange={(e) => set("topic", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="q-difficulty">Difficulty</Label>
          <Input id="q-difficulty" placeholder="medium" value={values.difficulty} onChange={(e) => set("difficulty", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5" lang="de">
          <Label htmlFor="q-stem-de">Question (German)</Label>
          <Textarea id="q-stem-de" required rows={3} value={values.stemDe} onChange={(e) => set("stemDe", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5" lang="en">
          <Label htmlFor="q-stem-en">Question (English)</Label>
          <Textarea id="q-stem-en" required rows={3} value={values.stemEn} onChange={(e) => set("stemEn", e.target.value)} />
        </div>
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium">Options (A and B required, C and D optional)</legend>
        {OPTION_IDS.map((id) => (
          <div key={id} className="grid gap-2 sm:grid-cols-[2rem_1fr_1fr] sm:items-center">
            <span className="text-sm font-medium" aria-hidden="true">
              {id.toUpperCase()}
            </span>
            <Input
              lang="de"
              aria-label={`Option ${id.toUpperCase()} (German)`}
              placeholder="Deutsch"
              required={id === "a" || id === "b"}
              value={values.options[id].de}
              onChange={(e) => setOption(id, "de", e.target.value)}
            />
            <Input
              lang="en"
              aria-label={`Option ${id.toUpperCase()} (English)`}
              placeholder="English"
              required={id === "a" || id === "b"}
              value={values.options[id].en}
              onChange={(e) => setOption(id, "en", e.target.value)}
            />
          </div>
        ))}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="q-correct">Correct option</Label>
          <NativeSelect id="q-correct" value={values.correct} onChange={(e) => set("correct", e.target.value)} className="w-full">
            {OPTION_IDS.map((id) => (
              <NativeSelectOption key={id} value={id}>
                {id.toUpperCase()}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="q-points">Points</Label>
          <Input id="q-points" type="number" min={1} step={1} required value={values.points} onChange={(e) => set("points", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="q-status">Status</Label>
          <NativeSelect id="q-status" value={values.status} onChange={(e) => set("status", e.target.value as QuestionStatus)} className="w-full">
            <NativeSelectOption value="draft">Draft (not used in exams)</NativeSelectOption>
            <NativeSelectOption value="approved">Approved (used in new papers)</NativeSelectOption>
          </NativeSelect>
        </div>
      </div>
      <div aria-live="polite">
        {message ? (
          <Alert variant={message.ok ? "success" : "destructive"}>
            <AlertDescription data-testid="question-form-message">{message.text}</AlertDescription>
          </Alert>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || !values.examSetId}>
          {pending ? "Saving…" : isNew ? "Add question" : "Save question"}
        </Button>
        {!isNew ? (
          <Button type="button" variant="outline" onClick={() => router.push(`/staff/questions?examSet=${values.examSetId}`)}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
