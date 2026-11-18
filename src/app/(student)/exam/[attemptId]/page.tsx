import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { getAttemptForStudent } from "@/lib/attempts";
import { Skeleton } from "@/components/ui/skeleton";
import { ExamClient } from "./exam-client";

export const metadata: Metadata = { title: "Exam in progress | TalentTrack" };

async function Exam({ params }: { params: Promise<{ attemptId: string }> }) {
  const profile = await requireRole("student");
  const { attemptId } = await params;
  // Reading the attempt also submits it if the deadline has passed (lazy expiry).
  const attempt = await getAttemptForStudent(profile.id, attemptId);
  if (!attempt) notFound();
  if (attempt.status !== "in_progress") redirect(`/results/${attempt.id}`);

  return (
    <ExamClient
      attemptId={attempt.id}
      examSetName={attempt.examSetName}
      startedAt={attempt.startedAt}
      deadlineAt={attempt.deadlineAt}
      serverNow={attempt.serverNow}
      reminderIntervalMin={attempt.reminderIntervalMin}
      questions={attempt.questions}
      initialAnswers={attempt.answers}
    />
  );
}

export default function ExamPage(props: PageProps<"/exam/[attemptId]">) {
  return (
    <Suspense
      fallback={
        <main role="status" aria-label="Loading exam" className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pt-20">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-8 w-full max-w-lg" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </main>
      }
    >
      <Exam params={props.params} />
    </Suspense>
  );
}
