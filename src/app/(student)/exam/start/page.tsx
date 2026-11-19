import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleCheckIcon, HourglassIcon, InboxIcon, LockIcon } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { getExamStartState, type CurriculumCard } from "@/lib/exam-start";
import { formatDateTime } from "@/lib/format";
import { greeting } from "@/lib/greeting";
import { formatPercent } from "@/lib/percent";
import { listStudentResults, type StudentResultListItem } from "@/lib/results";
import { StudentHeader } from "@/components/app/student-header";
import { linkClass, studentMain } from "@/components/app/styles";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { startExam } from "../actions";

export const metadata: Metadata = { title: "Exam | TalentTrack" };

const START_ERRORS: Record<string, string> = {
  unavailable: "This exam cannot be started right now. Please contact your trainer.",
  no_attempts_left: "You have used all your attempts for this exam. Please contact your trainer.",
  blocked: "You have used all your attempts for this exam. Please contact your trainer.",
  passed: "You have already passed this exam.",
  not_open: "This exam is not open for you. Please ask your trainer.",
  in_progress: "You already have this exam in progress. Please finish it first.",
  calculating: "Your last result is still being calculated. Please try again in a moment.",
  exam_set_used: "This exam could not be started. Please try again.",
};

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
                  <span className="flex items-baseline gap-2">
                    <span className="font-heading text-xl font-semibold tabular-nums" data-testid="result-percent">
                      {formatPercent(r.points, r.maxPoints)}
                    </span>
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {r.points} / {r.maxPoints} points
                    </span>
                  </span>
                  <Badge variant={r.passed ? "success" : "destructive"}>{r.passed ? "Passed" : "Not passed"}</Badge>
                </>
              ) : (
                <Badge variant="warning">Being calculated</Badge>
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

const KIND_LABEL: Record<CurriculumCard["kind"], string> = {
  ready: "Ready",
  in_progress: "In progress",
  calculating: "Being calculated",
  passed: "Passed",
  blocked: "Contact your trainer",
  unavailable: "Contact your trainer",
};

async function StartContent({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const profile = await requireRole("student");
  if (!profile.consent_at) redirect("/consent");
  const [cards, results] = await Promise.all([getExamStartState(profile.id), listStudentResults(profile.id)]);
  const { error } = await searchParams;
  // Own keys only: "?error=__proto__" must not pick up an inherited object.
  const errorText = error
    ? Object.hasOwn(START_ERRORS, error)
      ? START_ERRORS[error]
      : "The exam could not be started. Please try again."
    : null;
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-[1.625rem] leading-tight font-semibold sm:text-[1.875rem]" data-testid="greeting">
          {greeting({ fullName: profile.full_name, username: profile.username }, new Date())}
        </h1>
        {cards.length ? (
          <p className="text-base text-muted-foreground">Each exam is separate. Take them in any order.</p>
        ) : null}
      </div>
      {errorText ? (
        <Alert variant="destructive">
          <AlertDescription>{errorText}</AlertDescription>
        </Alert>
      ) : null}
      {cards.length === 0 ? (
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
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {cards.map((c) => (
            <li key={c.curriculumId}>
              <CurriculumCardView card={c} />
            </li>
          ))}
        </ul>
      )}
      <ResultsList results={results} />
    </>
  );
}

// Minimal cards (spec change 1, Task 2); the student interface is designed in Task 3.
function CurriculumCardView({ card }: { card: CurriculumCard }) {
  const headingId = `curriculum-${card.curriculumId}`;
  return (
    <Card className="h-full gap-4" data-testid="curriculum-card" aria-labelledby={headingId}>
      <CardHeader className="gap-1">
        <CardTitle>
          <h2 id={headingId} className="text-[1.375rem] leading-tight font-semibold sm:text-2xl">
            {card.name}
          </h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={card.kind === "passed" ? "success" : card.kind === "ready" ? "outline" : "warning"}>
            {KIND_LABEL[card.kind]}
          </Badge>
          {card.kind !== "passed" ? (
            <span className="text-sm text-muted-foreground" data-testid="attempts-left">
              {card.attemptsLeft === 1 ? "1 attempt left" : `${card.attemptsLeft} attempts left`}
            </span>
          ) : null}
        </div>
        {card.kind === "ready" ? (
          <form action={startExam.bind(null, card.curriculumId)}>
            <Button type="submit" size="lg" className="w-full sm:w-auto sm:min-w-48" data-testid="start-exam">
              Start exam
            </Button>
          </form>
        ) : null}
        {card.kind === "in_progress" && card.attemptId ? (
          <Link
            href={`/exam/${card.attemptId}`}
            data-testid="resume-exam"
            className={buttonVariants({ size: "lg", className: "w-full sm:w-auto sm:min-w-48" })}
          >
            Resume exam
          </Link>
        ) : null}
        {card.kind === "calculating" ? (
          <StatusNote testId="calculating">Your result is being calculated. Reload the page in a moment.</StatusNote>
        ) : null}
        {card.kind === "passed" ? (
          <p className="flex items-center gap-2 text-base">
            <CircleCheckIcon aria-hidden="true" className="size-5 text-success" />
            You passed this exam.
          </p>
        ) : null}
        {card.kind === "blocked" || card.kind === "unavailable" ? (
          <p className="flex items-start gap-2 text-base" data-testid="contact-trainer">
            <LockIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            {card.kind === "blocked"
              ? "You have used all attempts for this exam. Only your trainer can give you another attempt."
              : "This exam cannot be started right now. Please contact your trainer."}
          </p>
        ) : null}
      </CardContent>
    </Card>
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
