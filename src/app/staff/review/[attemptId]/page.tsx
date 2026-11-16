import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { formatDateTime } from "@/lib/format";
import { getAttemptReview, type ReviewQuestion } from "@/lib/review";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ReleaseButton } from "./release-button";

export const metadata: Metadata = { title: "Evaluation | TalentTrack" };

function QuestionCard({ q }: { q: ReviewQuestion }) {
  const answered = q.chosenOptionId !== null;
  return (
    <Card data-testid="review-question" size="sm">
      <CardHeader>
        <CardDescription>
          Question {q.position} · {q.topic}
        </CardDescription>
        <CardAction>
          <Badge variant={q.awardedPoints > 0 ? "secondary" : "destructive"} data-testid="awarded-points">
            {q.awardedPoints} / {q.maxPoints} points
          </Badge>
        </CardAction>
        <CardTitle className="grid gap-3 font-normal md:grid-cols-2">
          <p lang="de">
            <span className="block text-xs text-muted-foreground">Deutsch</span>
            <span className="font-medium">{q.stemDe}</span>
          </p>
          <p lang="en">
            <span className="block text-xs text-muted-foreground">English</span>
            <span className="font-medium">{q.stemEn}</span>
          </p>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {!answered ? <Badge variant="outline">Not answered</Badge> : null}
        <ul className="flex flex-col gap-2" aria-label={`Options for question ${q.position}`}>
          {q.options.map((o) => {
            const correct = o.id === q.correctOptionId;
            const chosen = o.id === q.chosenOptionId;
            return (
              <li
                key={o.id}
                data-testid="review-option"
                data-correct={correct || undefined}
                data-chosen={chosen || undefined}
                className="flex flex-col gap-2 rounded-lg border p-3 data-correct:border-foreground/40 data-correct:bg-muted md:flex-row md:items-center"
              >
                <span className="grid flex-1 gap-1 md:grid-cols-2">
                  <span lang="de">{o.de}</span>
                  <span lang="en" className="text-muted-foreground">
                    {o.en}
                  </span>
                </span>
                <span className="flex gap-1">
                  {chosen ? (
                    <Badge variant={correct ? "secondary" : "destructive"}>Student&apos;s answer</Badge>
                  ) : null}
                  {correct ? <Badge>Correct answer</Badge> : null}
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

async function Evaluation({ params }: { params: Promise<{ attemptId: string }> }) {
  await requireRole("staff");
  const { attemptId } = await params;
  const review = await getAttemptReview(attemptId);
  if (!review || review.status === "in_progress") notFound();

  const scored = review.points !== null && review.maxPoints !== null;
  const summary = scored ? `${review.points} of ${review.maxPoints}` : "not scored yet";
  const released = review.status === "released";

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardDescription>
            {review.curriculumName} · {review.examSetName}
          </CardDescription>
          <CardTitle className="text-xl">
            <h1>{review.studentName}</h1>
          </CardTitle>
          <CardAction>
            <Badge variant={released ? "secondary" : "outline"} data-testid="review-status">
              {released ? "Released" : "Awaiting release"}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Submitted</dt>
              <dd>{formatDateTime(review.submittedAt)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Score</dt>
              <dd className="font-medium tabular-nums" data-testid="review-score">
                {scored ? `${review.points} / ${review.maxPoints} · ${review.passed ? "Pass" : "Fail"}` : "Scoring pending"}
              </dd>
            </div>
            {released ? (
              <div>
                <dt className="text-muted-foreground">Released</dt>
                <dd>
                  {formatDateTime(review.releasedAt)}
                  {review.releasedBy ? ` by ${review.releasedBy}` : " automatically"}
                </dd>
              </div>
            ) : null}
          </dl>
          <div>
            <ReleaseButton
              attemptId={review.id}
              canRelease={!released && scored}
              disabledLabel={released ? "Released" : "Scoring pending"}
              summary={summary}
            />
          </div>
        </CardContent>
      </Card>

      <h2 className="text-lg font-semibold">Answers</h2>
      {review.questions.map((q) => (
        <QuestionCard key={q.attemptQuestionId} q={q} />
      ))}
    </div>
  );
}

function EvaluationSkeleton() {
  return (
    <div role="status" aria-label="Loading evaluation" className="flex flex-col gap-3">
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

export default function EvaluationPage(props: PageProps<"/staff/review/[attemptId]">) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-10">
      <div>
        <Link href="/staff/review" className={buttonVariants({ variant: "outline" })}>
          Back to review list
        </Link>
      </div>
      <Suspense fallback={<EvaluationSkeleton />}>
        <Evaluation params={props.params} />
      </Suspense>
    </main>
  );
}
