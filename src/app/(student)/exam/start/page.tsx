import { Suspense } from "react";
import { cn } from "cn";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { InboxIcon } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { greeting } from "@/lib/greeting";
import { StudentHeader } from "@/components/app/student-header";
import { studentMain } from "@/components/app/styles";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { CurriculumCardView } from "./curriculum-card";
import { loadStartPage } from "./load";
import { ResultsByCurriculum } from "./results-by-curriculum";
import { groupResultsByCurriculum, latestPass } from "./view";

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

async function StartContent({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const profile = await requireRole("student");
  if (!profile.consent_at) redirect("/consent");
  const { cards, results } = await loadStartPage(profile.id);
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
          <p className="text-base text-muted-foreground">Each exam is separate, so take them in any order.</p>
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
        <ul className={cn("grid gap-4", cards.length > 1 && "sm:grid-cols-2")} aria-label="Your exams">
          {cards.map((c) => (
            <li key={c.curriculumId} className="min-w-0">
              <CurriculumCardView card={c} passedResult={c.kind === "passed" ? latestPass(results, c.curriculumId) : null} />
            </li>
          ))}
        </ul>
      )}
      <ResultsByCurriculum groups={groupResultsByCurriculum(results, cards)} />
    </>
  );
}

function StartSkeleton() {
  return (
    <div role="status" aria-label="Loading your exam" className="flex flex-col gap-4">
      <Skeleton className="h-8 w-64 max-w-full" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-52 w-full rounded-xl" />
        <Skeleton className="h-52 w-full rounded-xl" />
      </div>
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
