import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { getAttemptForStudent } from "@/lib/attempts";
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
      deadlineAt={attempt.deadlineAt}
      serverNow={attempt.serverNow}
      questions={attempt.questions}
      initialAnswers={attempt.answers}
    />
  );
}

export default function ExamPage(props: PageProps<"/exam/[attemptId]">) {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-2xl px-4 py-10">
          <p role="status">Loading exam…</p>
        </main>
      }
    >
      <Exam params={props.params} />
    </Suspense>
  );
}
