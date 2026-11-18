import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleCheckIcon, ClockIcon, HourglassIcon, InboxIcon, ListChecksIcon, LockIcon } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { getExamStartState, type ExamSetInfo, type ExamStartState } from "@/lib/exam-start";
import { formatDateTime } from "@/lib/format";
import { greeting } from "@/lib/greeting";
import { listStudentResults, type StudentResultListItem } from "@/lib/results";
import { StudentHeader } from "@/components/app/student-header";
import { linkClass, studentMain } from "@/components/app/styles";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { startExam } from "../actions";

export const metadata: Metadata = { title: "Exam | TalentTrack" };

const START_ERRORS: Record<string, string> = {
  no_grant: "There is no attempt available for you right now. Please ask your trainer.",
  insufficient_pool: "This exam cannot be started yet. Please tell your trainer.",
  not_open: "This exam is not open for you. Please ask your trainer.",
  in_progress: "You already have an exam in progress. Please finish it first.",
  result_pending: "Your last result is still awaiting review. You can continue after your trainer releases it.",
};

function ExamFacts({ examSet }: { examSet: ExamSetInfo }) {
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
      <div className="flex items-center gap-2">
        <dt className="flex items-center gap-2 text-muted-foreground">
          <ListChecksIcon aria-hidden="true" className="size-4 text-primary" />
          Questions
        </dt>
        <dd className="font-heading text-base font-semibold tabular-nums" data-testid="question-count">
          {examSet.questionCount}
        </dd>
      </div>
      <div className="flex items-center gap-2">
        <dt className="flex items-center gap-2 text-muted-foreground">
          <ClockIcon aria-hidden="true" className="size-4 text-primary" />
          Time limit
        </dt>
        <dd className="font-heading text-base font-semibold tabular-nums">{examSet.timeLimitMin} min</dd>
      </div>
    </dl>
  );
}

function StatusNote({ testId, children }: { testId: string; children: React.ReactNode }) {
  return (
    <p
      data-testid={testId}
      className="flex items-start gap-3 rounded-lg bg-secondary px-4 py-3 text-base text-secondary-foreground"
    >
      <HourglassIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function ResultsList({ results }: { results: StudentResultListItem[] }) {
  if (results.length === 0) return null;
  return (
    <section aria-labelledby="results-heading" className="flex flex-col gap-2 pt-2">
      <h2 id="results-heading" className="text-lg font-semibold">
        Your results
      </h2>
      <ul className="flex flex-col divide-y rounded-xl border" data-testid="results-list">
        {results.map((r) => (
          <li
            key={r.id}
            data-testid="result-row"
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3"
          >
            <div className="flex min-w-0 flex-col">
              <span className="font-semibold">{r.curriculumName || "Exam"}</span>
              <span className="text-sm text-muted-foreground">
                {r.examSetName ? `${r.examSetName}, ` : ""}submitted {formatDateTime(r.submittedAt)}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {r.status === "released" && r.points !== null && r.maxPoints !== null ? (
                <>
                  <span className="font-heading text-lg font-semibold tabular-nums">
                    {r.points} / {r.maxPoints}
                  </span>
                  <Badge variant={r.passed ? "success" : "destructive"}>{r.passed ? "Passed" : "Not passed"}</Badge>
                </>
              ) : (
                <Badge variant="warning">Awaiting review</Badge>
              )}
              <Link href={`/results/${r.id}`} className={linkClass}>
                {r.status === "released" ? "View result" : "View status"}
                <span className="sr-only">
                  {" "}
                  for {r.curriculumName} {r.examSetName}
                </span>
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One short orientation line under the greeting; empty states explain themselves. */
const LEAD: Partial<Record<ExamStartState["kind"], string>> = {
  ready: "Your next exam is ready. Start whenever you feel settled.",
  in_progress: "You have an exam in progress. Pick up where you left off.",
  awaiting_review: "Well done for finishing. Your exam is now with your trainer.",
  waiting: "Your next exam is lined up. Your trainer will open an attempt for you.",
};

async function StartContent({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const profile = await requireRole("student");
  if (!profile.consent_at) redirect("/consent");
  const [state, results] = await Promise.all([getExamStartState(profile.id), listStudentResults(profile.id)]);
  const lead = LEAD[state.kind];
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-[1.625rem] leading-tight font-semibold sm:text-[1.875rem]" data-testid="greeting">
          {greeting({ fullName: profile.full_name, username: profile.username }, new Date())}
        </h1>
        {lead ? <p className="text-base text-muted-foreground">{lead}</p> : null}
      </div>
      <NextExam state={state} searchParams={searchParams} />
      <ResultsList results={results} />
    </>
  );
}

async function NextExam({ state, searchParams }: { state: ExamStartState; searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  // Own keys only: "?error=__proto__" must not pick up an inherited object.
  const errorText = error
    ? Object.hasOwn(START_ERRORS, error)
      ? START_ERRORS[error]
      : "The exam could not be started. Please try again."
    : null;

  if (state.kind === "none") {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <InboxIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>No exam yet</EmptyTitle>
          <EmptyDescription data-testid="no-exams">
            No exams are assigned to you yet. Your trainer will add your first exam here; check back soon.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (state.kind === "completed") {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CircleCheckIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>All exams completed</EmptyTitle>
          <EmptyDescription data-testid="all-completed">
            Congratulations, you have passed every exam assigned to you. Your results are listed below.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (state.kind === "blocked") {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LockIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>Please contact your trainer</EmptyTitle>
          <EmptyDescription data-testid="blocked-contact-trainer">
            You have used all attempts{state.curriculumNames.length ? ` for ${state.curriculumNames.join(", ")}` : ""}. Only your
            trainer can give you another attempt.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const examSet = state.examSet;
  const curriculumName = examSet?.curriculumName ?? (state.kind === "waiting" ? state.curriculumName : "");

  return (
    <section aria-labelledby="next-exam-heading">
      <Card className="gap-4">
        <CardHeader className="gap-1">
          <CardTitle>
            <h2
              id="next-exam-heading"
              className="text-[1.375rem] leading-tight font-semibold sm:text-2xl"
              data-testid="next-exam"
            >
              {curriculumName}
              {examSet ? (
                <span className="mt-0.5 block font-sans text-base font-normal tracking-normal text-muted-foreground">
                  {examSet.name}
                </span>
              ) : null}
            </h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {examSet ? <ExamFacts examSet={examSet} /> : null}
          {errorText ? (
            <Alert variant="destructive">
              <AlertDescription>{errorText}</AlertDescription>
            </Alert>
          ) : null}
          {state.kind === "ready" ? (
            <>
              <Separator />
              <ul className="flex max-w-[62ch] list-disc flex-col gap-1.5 pl-5 text-base leading-relaxed marker:text-primary">
                <li>The questions are in German.</li>
                <li>The timer starts when you press Start and keeps running if you leave the page.</li>
                <li>Your answers are saved automatically, and the exam is submitted when the time is up.</li>
              </ul>
              <form action={startExam}>
                <Button type="submit" size="lg" className="w-full sm:w-auto sm:min-w-48">
                  Start exam
                </Button>
              </form>
            </>
          ) : null}
          {state.kind === "in_progress" ? (
            <>
              <StatusNote testId="in-progress">You have an exam in progress. The timer is still running.</StatusNote>
              <Link
                href={`/exam/${state.attemptId}`}
                className={buttonVariants({ size: "lg", className: "w-full sm:w-auto sm:min-w-48" })}
              >
                Resume exam
              </Link>
            </>
          ) : null}
          {state.kind === "awaiting_review" ? (
            <StatusNote testId="awaiting-review">Submitted, awaiting review. Your trainer will release your result.</StatusNote>
          ) : null}
          {state.kind === "waiting" ? (
            <StatusNote testId="waiting-for-grant">Waiting for your trainer to give you an attempt.</StatusNote>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
function StartSkeleton() {
  return (
    <div role="status" aria-label="Loading your exam" className="flex flex-col gap-4">
      <Skeleton className="h-8 w-64 max-w-full" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <Skeleton className="h-48 w-full rounded-xl" />
      <Skeleton className="h-11 w-48" />
    </div>
  );
}

export default function ExamStartPage(props: PageProps<"/exam/start">) {
  return (
    <>
      <StudentHeader signOut />
      <main className={studentMain}>
        <Suspense fallback={<StartSkeleton />}>
          <StartContent searchParams={props.searchParams as Promise<{ error?: string }>} />
        </Suspense>
      </main>
    </>
  );
}
