"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, CloudOffIcon, LoaderCircleIcon } from "lucide-react";
import { cn } from "cn";
import type { ExamQuestion } from "@/lib/attempts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { saveAnswerAction, submitExam } from "../actions";

type SaveState = "saving" | "saved" | "pending" | "error";

type Props = {
  attemptId: string;
  examSetName: string;
  deadlineAt: string;
  serverNow: string;
  questions: ExamQuestion[];
  initialAnswers: Record<string, string>;
};

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

// Redirects and notFound from a server action surface as errors with a Next.js digest; let them through.
function isNavigation(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK"));
}

function formatRemaining(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function ExamClient({ attemptId, examSetName, deadlineAt, serverNow, questions, initialAnswers }: Props) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers);
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  const [remaining, setRemaining] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [closedMessage, setClosedMessage] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

  // Unsynced answers (network failures) and a queue so saves reach the server in order.
  const pending = useRef(new Map<string, string>());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const submitted = useRef(false);
  const lastAutoSubmit = useRef(0);

  /**
   * Submits once. Waits for in-flight saves first so a save sent just before the deadline is not
   * overtaken by the submit. A manual submit is refused while answers are still unsaved; an
   * automatic one (time is up) goes ahead because the server would refuse late saves anyway.
   * Returns false when the submit did not start or failed; the exam then stays on screen.
   */
  const finish = useCallback(
    async (auto: boolean): Promise<boolean> => {
      if (submitted.current) return true;
      submitted.current = true;
      setSubmitError(null);
      await queue.current;
      if (!auto && pending.current.size > 0) {
        submitted.current = false;
        setSubmitError("Some answers are not saved yet; reconnect and try again.");
        return false;
      }
      return new Promise<boolean>((resolve) => {
        startSubmit(async () => {
          try {
            await submitExam(attemptId);
            resolve(true);
          } catch (e) {
            if (isNavigation(e)) {
              resolve(true);
              throw e;
            }
            submitted.current = false;
            setSubmitError("The exam could not be submitted. Check your connection and try again. Your answers are kept.");
            resolve(false);
          }
        });
      });
    },
    [attemptId],
  );

  const persist = useCallback(
    (attemptQuestionId: string, optionId: string) => {
      pending.current.set(attemptQuestionId, optionId);
      setSaveState((s) => ({ ...s, [attemptQuestionId]: "saving" }));
      const run = async () => {
        try {
          const result = await saveAnswerAction(attemptId, attemptQuestionId, optionId);
          if (result.ok) {
            if (pending.current.get(attemptQuestionId) === optionId) {
              pending.current.delete(attemptQuestionId);
              setSaveState((s) => ({ ...s, [attemptQuestionId]: "saved" }));
            }
          } else if (result.code === "deadline_passed" || result.code === "closed") {
            pending.current.clear();
            setClosedMessage("Time is up. Your saved answers have been submitted.");
            submitted.current = true;
            router.replace(`/results/${attemptId}`);
          } else {
            pending.current.delete(attemptQuestionId);
            setSaveState((s) => ({ ...s, [attemptQuestionId]: "error" }));
          }
        } catch {
          // Network or server unreachable: keep it and retry when the browser is back online.
          setSaveState((s) => ({ ...s, [attemptQuestionId]: "pending" }));
        }
      };
      queue.current = queue.current.then(run);
      return queue.current;
    },
    [attemptId, router],
  );

  const flushPending = useCallback(async () => {
    const entries = [...pending.current.entries()];
    await Promise.all(entries.map(([aq, option]) => persist(aq, option)));
  }, [persist]);

  // Countdown from the server deadline, corrected by the client's clock skew to the database clock.
  useEffect(() => {
    const skew = Date.parse(serverNow) - Date.now();
    const deadline = Date.parse(deadlineAt);
    const tick = () => setRemaining(deadline - (Date.now() + skew));
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 500);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [deadlineAt, serverNow]);

  // At expiry the server submits the saved answers; ask it to do so now (retrying at most every 5 s).
  useEffect(() => {
    if (remaining === null || remaining > 0 || !online) return;
    if (Date.now() - lastAutoSubmit.current < 5000) return;
    lastAutoSubmit.current = Date.now();
    void finish(true);
  }, [remaining, online, finish]);

  useEffect(() => {
    const retry = () => void flushPending();
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [flushPending]);

  const question = questions[index];
  const answeredCount = questions.filter((q) => answers[q.attemptQuestionId]).length;
  const unsaved = Object.values(saveState).some((s) => s === "pending" || s === "saving");
  const lowTime = remaining !== null && remaining < 5 * 60_000;
  const currentState = saveState[question.attemptQuestionId];

  function choose(optionId: string) {
    if (submitted.current) return;
    setAnswers((a) => ({ ...a, [question.attemptQuestionId]: optionId }));
    void persist(question.attemptQuestionId, optionId);
  }

  async function confirmSubmit() {
    await flushPending();
    if (!(await finish(false))) setConfirmOpen(false);
  }

  const submitDisabled = submitting || closedMessage !== null || !online;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{examSetName}</p>
            <p className="text-xs text-muted-foreground">
              {answeredCount} of {questions.length} answered
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div
              role="timer"
              aria-label="Time remaining"
              data-testid="timer"
              className={cn(
                "rounded-md border px-2.5 py-1 font-mono text-base tabular-nums",
                lowTime && "border-destructive/40 text-destructive",
              )}
            >
              {remaining === null ? "--:--" : formatRemaining(remaining)}
            </div>
            <Button onClick={() => setConfirmOpen(true)} disabled={submitDisabled}>
              Submit
            </Button>
          </div>
        </div>
      </header>

      {!online ? (
        <div className="mx-auto w-full max-w-3xl px-4 pt-3">
          <Alert data-testid="offline-banner">
            <CloudOffIcon />
            <AlertTitle>You are offline</AlertTitle>
            <AlertDescription>
              Your answers will be saved when the connection is back. The timer keeps running.
            </AlertDescription>
          </Alert>
        </div>
      ) : null}
      {submitError ? (
        <div className="mx-auto w-full max-w-3xl px-4 pt-3">
          <Alert variant="destructive">
            <AlertDescription data-testid="submit-error">{submitError}</AlertDescription>
          </Alert>
        </div>
      ) : null}
      {closedMessage ? (
        <div className="mx-auto w-full max-w-3xl px-4 pt-3">
          <Alert>
            <AlertDescription>{closedMessage}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6">
        <section aria-labelledby="question-heading" className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <h1 id="question-heading" className="text-sm font-medium text-muted-foreground">
              Question {index + 1} of {questions.length}
            </h1>
            <p className="flex items-center gap-1 text-xs text-muted-foreground" aria-live="polite" data-testid="save-status">
              {currentState === "saving" ? (
                <>
                  <LoaderCircleIcon className="size-3.5 animate-spin" aria-hidden /> Saving…
                </>
              ) : currentState === "saved" ? (
                <>
                  <CheckIcon className="size-3.5" aria-hidden /> Saved
                </>
              ) : currentState === "pending" ? (
                "Not saved yet, will retry"
              ) : currentState === "error" ? (
                <span className="text-destructive">Could not save this answer</span>
              ) : null}
            </p>
          </div>

          <div lang="de" className="flex flex-col gap-4">
            <p className="text-lg leading-relaxed font-medium" data-testid="question-stem">
              {question.stemDe}
            </p>
            <RadioGroup
              key={question.attemptQuestionId}
              aria-labelledby="question-heading"
              value={answers[question.attemptQuestionId] ?? null}
              onValueChange={(value) => choose(value as string)}
              disabled={submitting || closedMessage !== null}
              className="gap-2"
            >
              {question.options.map((option) => (
                <label
                  key={option.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-base transition-colors hover:bg-muted has-data-checked:border-primary has-data-checked:bg-muted"
                >
                  <RadioGroupItem value={option.id} />
                  <span>{option.de}</span>
                </label>
              ))}
            </RadioGroup>
          </div>
        </section>

        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" onClick={() => setIndex((i) => i - 1)} disabled={index === 0}>
            <ChevronLeftIcon data-icon="inline-start" /> Previous
          </Button>
          {index < questions.length - 1 ? (
            <Button variant="outline" onClick={() => setIndex((i) => i + 1)}>
              Next <ChevronRightIcon data-icon="inline-end" />
            </Button>
          ) : (
            <Button onClick={() => setConfirmOpen(true)} disabled={submitDisabled}>
              Review and submit
            </Button>
          )}
        </div>

        <nav aria-label="Questions" className="border-t pt-4">
          <p className="mb-2 text-xs text-muted-foreground">Go to question</p>
          <ol className="flex flex-wrap gap-2">
            {questions.map((q, i) => {
              const answered = Boolean(answers[q.attemptQuestionId]);
              return (
                <li key={q.attemptQuestionId}>
                  <Button
                    variant={i === index ? "default" : "outline"}
                    size="icon-lg"
                    aria-current={i === index ? "step" : undefined}
                    aria-label={`Question ${i + 1}${answered ? ", answered" : ", not answered"}`}
                    onClick={() => setIndex(i)}
                    className={cn(answered && i !== index && "border-primary/50 bg-muted")}
                  >
                    {i + 1}
                  </Button>
                </li>
              );
            })}
          </ol>
        </nav>
      </main>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit your exam?</DialogTitle>
            <DialogDescription>
              You answered {answeredCount} of {questions.length} questions. You cannot change your answers after
              submitting.
              {unsaved ? " Some answers are still being saved; they will be sent first." : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Keep working</DialogClose>
            <Button onClick={() => void confirmSubmit()} disabled={submitDisabled}>
              {submitting ? "Submitting…" : "Submit exam"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
