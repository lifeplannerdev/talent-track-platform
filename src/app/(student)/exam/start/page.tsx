import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { getExamStartState, type ExamSetInfo } from "@/lib/exam-start";
import { logout } from "@/app/login/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { startExam } from "../actions";

export const metadata: Metadata = { title: "Exam | TalentTrack" };

const START_ERRORS: Record<string, string> = {
  no_grant: "There is no attempt available for you right now. Please ask your trainer.",
  insufficient_pool: "This exam cannot be started yet. Please tell your trainer.",
};

function ExamFacts({ examSet }: { examSet: ExamSetInfo }) {
  return (
    <dl className="grid grid-cols-2 gap-3 text-sm">
      <div className="rounded-lg border p-3">
        <dt className="text-muted-foreground">Questions</dt>
        <dd className="text-lg font-semibold" data-testid="question-count">
          {examSet.questionCount}
        </dd>
      </div>
      <div className="rounded-lg border p-3">
        <dt className="text-muted-foreground">Time limit</dt>
        <dd className="text-lg font-semibold">{examSet.timeLimitMin} min</dd>
      </div>
    </dl>
  );
}

async function StartContent({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const profile = await requireRole("student");
  if (!profile.consent_at) redirect("/consent");
  const state = await getExamStartState(profile.id);
  const { error } = await searchParams;
  const errorText = error ? (START_ERRORS[error] ?? "The exam could not be started. Please try again.") : null;

  if (state.kind === "none") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No exam yet</CardTitle>
        </CardHeader>
        <CardContent>
          <p data-testid="no-exams">No exams are assigned to you yet. Please check back later or ask your instructor.</p>
        </CardContent>
      </Card>
    );
  }

  const examSet = state.examSet;
  const curriculumName = examSet?.curriculumName ?? (state.kind === "waiting" ? state.curriculumName : "");

  return (
    <Card>
      <CardHeader>
        <CardDescription>Your next exam</CardDescription>
        <CardTitle className="text-xl" data-testid="next-exam">
          {curriculumName}
          {examSet ? <span className="block text-base font-normal text-muted-foreground">{examSet.name}</span> : null}
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
          <p className="text-sm text-muted-foreground">
            The questions are in German. The timer starts when you press Start and keeps running if you leave
            the page. Your answers are saved automatically, and the exam is submitted when the time is up.
          </p>
        ) : null}
        {state.kind === "in_progress" ? (
          <p className="text-sm text-muted-foreground">You have an exam in progress. The timer is still running.</p>
        ) : null}
        {state.kind === "awaiting_review" ? (
          <p data-testid="awaiting-review">Submitted, awaiting review. Your trainer will release your result.</p>
        ) : null}
        {state.kind === "waiting" ? (
          <p data-testid="waiting-for-grant">Waiting for your trainer to give you an attempt.</p>
        ) : null}
      </CardContent>
      {state.kind === "ready" ? (
        <CardFooter>
          <form action={startExam} className="w-full">
            <Button type="submit" size="lg" className="w-full">
              Start exam
            </Button>
          </form>
        </CardFooter>
      ) : null}
      {state.kind === "in_progress" ? (
        <CardFooter>
          <Link href={`/exam/${state.attemptId}`} className={buttonVariants({ size: "lg", className: "w-full" })}>
            Resume exam
          </Link>
        </CardFooter>
      ) : null}
    </Card>
  );
}

export default function ExamStartPage(props: PageProps<"/exam/start">) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-10">
      <h1 className="text-2xl font-semibold">Exam</h1>
      <Suspense fallback={<p role="status">Loading…</p>}>
        <StartContent searchParams={props.searchParams as Promise<{ error?: string }>} />
      </Suspense>
      <form action={logout}>
        <Button type="submit" variant="outline">
          Sign out
        </Button>
      </form>
    </main>
  );
}
