"use client";

import { useState, useTransition } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { QuestionStatus } from "@/lib/types";
import { importQuestions, previewQuestionsImport, type ImportQuestionsResult, type QuestionsImportPreview } from "./actions";
import { ExamSetSelect, type ExamSetChoice } from "./question-form";

const TEMPLATE =
  "topic,difficulty,stem_de,stem_en,option_a_de,option_a_en,option_b_de,option_b_en,option_c_de,option_c_en,option_d_de,option_d_en,correct,points\r\n" +
  "Pflege,easy,Wie viele Tage hat eine Woche?,How many days does a week have?,Fünf,Five,Sieben,Seven,,,,,b,1\r\n";
const TEMPLATE_HREF = `data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`;

const linkClass =
  "font-medium underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

type Preview = Extract<QuestionsImportPreview, { ok: true }>;

/** Check first (row errors shown, nothing saved), then confirm. All-or-nothing unless only valid rows are chosen. */
export function QuestionImport({ sets, defaultExamSetId }: { sets: ExamSetChoice[]; defaultExamSetId: string }) {
  const [examSetId, setExamSetId] = useState(defaultExamSetId);
  const [csv, setCsv] = useState("");
  const [status, setStatus] = useState<QuestionStatus>("draft");
  const [onlyValid, setOnlyValid] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ImportQuestionsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setPreview(null);
    setResult(null);
    setError(null);
    setOnlyValid(false);
  };

  const check = () =>
    startTransition(async () => {
      reset();
      try {
        const r = await previewQuestionsImport(examSetId, csv);
        if (r.ok) setPreview(r);
        else setError(r.message);
      } catch {
        setError("The file could not be checked. Please try again.");
      }
    });

  const confirm = () =>
    startTransition(async () => {
      setError(null);
      try {
        const r = await importQuestions({ examSetId, csvText: csv, status, onlyValid });
        setResult(r);
        if (r.ok) {
          setPreview(null);
          setCsv("");
        }
      } catch {
        setError("The import could not be finished. Please try again.");
      }
    });

  const hasErrors = (preview?.errors.length ?? 0) > 0;
  const canImport = preview !== null && preview.validCount > 0 && (!hasErrors || onlyValid) && !preview.errors.some((e) => e.row === 0);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        One question per row with German and English text. Check the file first: row errors are shown and nothing is saved.
        If any row has an error, nothing is imported unless you choose to import only the valid rows.{" "}
        <a href={TEMPLATE_HREF} download="questions-template.csv" className={linkClass}>
          Download template
        </a>
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="import-set">Exam set</Label>
          <ExamSetSelect
            id="import-set"
            sets={sets}
            value={examSetId}
            onChange={(v) => {
              setExamSetId(v);
              reset();
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="import-status">Import as</Label>
          <NativeSelect id="import-status" value={status} onChange={(e) => setStatus(e.target.value as QuestionStatus)} className="w-full">
            <NativeSelectOption value="draft">Draft (review before use)</NativeSelectOption>
            <NativeSelectOption value="approved">Approved (used in new papers)</NativeSelectOption>
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="import-file">CSV file</Label>
          <Input
            id="import-file"
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setCsv(await file.text());
              reset();
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="import-csv">Or paste the CSV</Label>
          <Textarea
            id="import-csv"
            rows={5}
            value={csv}
            onChange={(e) => {
              setCsv(e.target.value);
              reset();
            }}
            spellCheck={false}
            className="font-mono text-xs"
          />
        </div>
      </div>
      <div>
        <Button type="button" variant="outline" onClick={check} disabled={pending || !csv.trim() || !examSetId}>
          {pending && !preview ? "Checking…" : "Check file"}
        </Button>
      </div>

      <div aria-live="polite" className="flex flex-col gap-3">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {preview ? (
          <div className="flex flex-col gap-3" data-testid="question-import-preview">
            <p className="text-sm" data-testid="question-import-summary">
              {preview.validCount} valid question{preview.validCount === 1 ? "" : "s"}
              {Object.keys(preview.topics).length > 0
                ? ` (${Object.entries(preview.topics)
                    .map(([t, n]) => `${t}: ${n}`)
                    .join(", ")})`
                : ""}
              {hasErrors ? `, ${preview.errors.length} row${preview.errors.length === 1 ? "" : "s"} with errors` : ""}.
            </p>
            {hasErrors ? (
              <Alert variant="destructive" data-testid="question-import-errors">
                <AlertTitle>Rows with errors</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4">
                    {preview.errors.map((e) => (
                      <li key={`${e.row}:${e.message}`}>{e.row === 0 ? e.message : `Row ${e.row}: ${e.message}`}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}
            {hasErrors && preview.validCount > 0 && !preview.errors.some((e) => e.row === 0) ? (
              <div className="flex items-start gap-2">
                <input
                  id="import-only-valid"
                  type="checkbox"
                  checked={onlyValid}
                  onChange={(e) => setOnlyValid(e.target.checked)}
                  className="mt-0.5 size-4 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                />
                <Label htmlFor="import-only-valid" className="leading-snug">
                  Import only the {preview.validCount} valid row{preview.validCount === 1 ? "" : "s"} and skip the rest
                </Label>
              </div>
            ) : null}
            <div>
              <Button type="button" onClick={confirm} disabled={pending || !canImport}>
                {pending ? "Importing…" : `Import ${preview.validCount} question${preview.validCount === 1 ? "" : "s"} as ${status}`}
              </Button>
            </div>
          </div>
        ) : null}
        {result ? (
          result.ok ? (
            <Alert data-testid="question-import-result">
              <AlertDescription>
                Imported {result.inserted} question{result.inserted === 1 ? "" : "s"}
                {result.skipped > 0 ? `; skipped ${result.skipped} row${result.skipped === 1 ? "" : "s"} with errors` : ""}.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="destructive">
              <AlertTitle>{result.message}</AlertTitle>
            </Alert>
          )
        ) : null}
      </div>
    </div>
  );
}
