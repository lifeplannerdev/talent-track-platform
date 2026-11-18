"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, ClockIcon, CloudOffIcon, LoaderCircleIcon } from "lucide-react";
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
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );

  // Unsynced answers (network failures) and a queue so saves reach the server in order. Each
  // selection gets a revision, so only the response to the latest selection of a question can
  // mark it saved (A, B, A quickly: an early "A saved" must not hide a failed final A).
  const pending = useRef(new Map<string, { optionId: string; rev: number }>());
  const revision = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const submitted = useRef(false);
  const lastAutoSubmit = useRef(0);
  const flushing = useRef(false);
  // Clock offset to the database, fixed per server render: Next can hide and show this route
  // (Activity) and re-run effects later with the same props, and a recomputed offset would then
  // add the hidden time back to the countdown.
  const clock = useRef<{ serverNow: string; skew: number } | null>(null);

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
    (attemptQuestionId: string, optionId: string, retryRev?: number) => {
      const rev = retryRev ?? ++revision.current;
      const current = pending.current.get(attemptQuestionId);
      if (current && current.rev > rev) return queue.current; // a newer selection supersedes this retry
      pending.current.set(attemptQuestionId, { optionId, rev });
      setSaveState((s) => ({ ...s, [attemptQuestionId]: "saving" }));
      const isLatest = () => pending.current.get(attemptQuestionId)?.rev === rev;
      const run = async () => {
        try {
          const result = await saveAnswerAction(attemptId, attemptQuestionId, optionId);
          if (result.ok) {
            if (isLatest()) {
              pending.current.delete(attemptQuestionId);
              setSaveState((s) => ({ ...s, [attemptQuestionId]: "saved" }));
            }
          } else if (result.code === "deadline_passed" || result.code === "closed") {
            pending.current.clear();
            setClosedMessage("Time is up. Your saved answers have been submitted.");
            submitted.current = true;
            router.replace(`/results/${attemptId}`);
          } else if (isLatest()) {
            pending.current.delete(attemptQuestionId);
            setSaveState((s) => ({ ...s, [attemptQuestionId]: "error" }));
          }
        } catch {
          // Network or server unreachable: keep it; it is retried while online and on reconnect.
          if (isLatest()) setSaveState((s) => ({ ...s, [attemptQuestionId]: "pending" }));
        }
      };
      queue.current = queue.current.then(run);
      return queue.current;
    },
    [attemptId, router],
  );

  const flushPending = useCallback(async () => {
    const entries = [...pending.current.entries()];
    await Promise.all(entries.map(([aq, entry]) => persist(aq, entry.optionId, entry.rev)));
  }, [persist]);

  // Countdown from the server deadline, corrected by the client's clock skew to the database clock.
  useEffect(() => {
    if (clock.current?.serverNow !== serverNow) {
      clock.current = { serverNow, skew: Date.parse(serverNow) - Date.now() };
    }
    const skew = clock.current.skew;
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

  // A save can also fail while the browser stays online (a server error): retry every 5 s.
  useEffect(() => {
    if (!online) return;
    const timer = setInterval(() => {
      if (submitted.current || flushing.current || pending.current.size === 0) return;
      flushing.current = true;
      void flushPending().finally(() => {
        flushing.current = false;
      });
    }, 5000);
    return () => clearInterval(timer);
  }, [online, flushPending]);

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
      <header className="sticky top-0 z-10 bg-card/95 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{examSetName}</p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {answeredCount} of {questions.length} answered
            </p>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <div
              role="timer"
              aria-label="Time remaining"
              data-testid="timer"
              className={cn(
                "flex h-9 items-center gap-1.5 rounded-md border px-2.5 transition-colors pointer-coarse:h-11",
                lowTime ? "border-destructive/40 bg-destructive-muted text-destructive" : "border-border bg-muted/60",
              )}
            >
              <ClockIcon aria-hidden="true" className="size-4 shrink-0" />
              <span className="font-heading text-base font-semibold tabular-nums">
                {remaining === null ? "--:--" : formatRemaining(remaining)}
              </span>
            </div>
            <Button onClick={() => setConfirmOpen(true)} disabled={submitDisabled}>
              Submit
            </Button>
          </div>
        </div>
        {/* Progress: how much of the sheet is answered (the same number is in the text above). */}
        <div aria-hidden="true" className="h-0.5 w-full overflow-hidden bg-border">
          <div
            className="h-full origin-left bg-primary motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out"
            style={{ transform: `scaleX(${answeredCount / questions.length})` }}
          />
        </div>
      </header>
      <span id="main-content" tabIndex={-1} className="outline-none" />

      {!online ? (
        <div className="mx-auto w-full max-w-3xl px-4 pt-4">
          <Alert variant="warning" data-testid="offline-banner">
            <CloudOffIcon />
            <AlertTitle>You are offline</AlertTitle>
            <AlertDescription>Your answers will be saved when the connection is back. The timer keeps running.</AlertDescription>
          </Alert>
        </div>
      ) : null}
      {submitError ? (
        <div className="mx-auto w-full max-w-3xl px-4 pt-4">
          <Alert variant="destructive">
            <AlertDescription data-testid="submit-error">{submitError}</AlertDescription>
          </Alert>
        </div>
      ) : null}
      {closedMessage ? (
        <div className="mx-auto w-full max-w-3xl px-4 pt-4">
          <Alert>
            <AlertDescription>{closedMessage}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 pt-5 pb-10 sm:pt-8 sm:pb-16">
        <section aria-labelledby="question-heading" className="flex flex-col gap-4">
          <div className="flex min-h-5 items-center justify-between gap-2">
            <h1 id="question-heading" className="font-sans text-sm font-semibold tracking-normal text-primary">
              Question {index + 1} of {questions.length}
            </h1>
            <p className="flex items-center gap-1 text-xs text-muted-foreground" aria-live="polite" data-testid="save-status">
              {currentState === "saving" ? (
                <>
                  <LoaderCircleIcon className="size-3.5 animate-spin" aria-hidden /> Saving…
                </>
              ) : currentState === "saved" ? (
                <>
                  <CheckIcon className="size-3.5 text-success" aria-hidden /> Saved
                </>
              ) : currentState === "pending" ? (
                "Not saved yet, will retry"
              ) : currentState === "error" ? (
                <span className="font-semibold text-destructive">Could not save this answer</span>
              ) : null}
            </p>
          </div>

          <div lang="de" className="flex flex-col gap-5">
            <p className="max-w-[60ch] text-stem font-semibold text-foreground sm:text-[1.5rem]" data-testid="question-stem">
              {question.stemDe}
            </p>
            <RadioGroup
              key={question.attemptQuestionId}
              aria-labelledby="question-heading"
              value={answers[question.attemptQuestionId] ?? null}
              onValueChange={(value) => choose(value as string)}
              disabled={submitting || closedMessage !== null}
              className="gap-3"
            >
              {question.options.map((option) => (
                <label
                  key={option.id}
                  className="flex min-h-14 cursor-pointer items-center gap-4 rounded-lg border border-input/50 bg-card px-4 py-3 text-option transition-[background-color,border-color,box-shadow] duration-150 hover:border-input hover:bg-muted/60 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring has-data-checked:border-primary has-data-checked:bg-secondary has-data-checked:shadow-[inset_0_0_0_1px_var(--primary)] has-disabled:cursor-not-allowed"
                >
                  <RadioGroupItem value={option.id} className="size-6 border-2 border-input focus-visible:ring-0" />
                  <span>{option.de}</span>
                </label>
              ))}
            </RadioGroup>
          </div>
        </section>

        {/* On phones the move-on controls stay in thumb reach at the bottom of the screen. */}
        <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-between gap-3 border-t bg-card/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
          <Button
            variant="outline"
            size="lg"
            className="flex-1 sm:flex-none"
            onClick={() => setIndex((i) => i - 1)}
            disabled={index === 0}
          >
            <ChevronLeftIcon data-icon="inline-start" /> Previous
          </Button>
          {index < questions.length - 1 ? (
            <Button variant="outline" size="lg" className="flex-1 sm:flex-none" onClick={() => setIndex((i) => i + 1)}>
              Next <ChevronRightIcon data-icon="inline-end" />
            </Button>
          ) : (
            <Button size="lg" className="flex-1 sm:flex-none" onClick={() => setConfirmOpen(true)} disabled={submitDisabled}>
              Review and submit
            </Button>
          )}
        </div>

        <nav aria-label="Questions" className="flex flex-col gap-3 border-t pt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="text-sm font-semibold">Go to question</p>
            <p className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded-[3px] border border-primary/40 bg-secondary" /> Answered
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded-[3px] border border-input/70 bg-card" /> Open
              </span>
            </p>
          </div>
          <ol className="flex flex-wrap gap-2">
            {questions.map((q, i) => {
              const answered = Boolean(answers[q.attemptQuestionId]);
              const current = i === index;
              return (
                <li key={q.attemptQuestionId}>
                  <Button
                    variant={current ? "default" : "outline"}
                    size="icon-lg"
                    aria-current={current ? "step" : undefined}
                    aria-label={`Question ${i + 1}${answered ? ", answered" : ", not answered"}`}
                    onClick={() => setIndex(i)}
                    className={cn(
                      "relative font-heading tabular-nums",
                      answered && !current && "border-primary/40 bg-secondary text-secondary-foreground hover:bg-secondary",
                    )}
                  >
                    {i + 1}
                    {answered ? <CheckIcon aria-hidden="true" className="absolute top-0.5 right-0.5 size-3! stroke-3" /> : null}
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
              You answered {answeredCount} of {questions.length} questions. You cannot change your answers after submitting.
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
