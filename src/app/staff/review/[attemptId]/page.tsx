import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { formatDateTime } from "@/lib/format";
import { getAttemptReview, type ReviewQuestion } from "@/lib/review";
import { Badge } from "@/components/ui/badge";
import { linkClass, staffMain } from "@/components/app/styles";
import { ChevronLeftIcon } from "lucide-react";
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
          Question {q.position}
          {q.topic ? ` · ${q.topic}` : null}
        </CardDescription>
        <CardAction>
          {q.awardedPoints === null || q.maxPoints === null ? (
            <Badge variant="outline" data-testid="awarded-points">
              Not scored
            </Badge>
          ) : (
            <Badge variant={q.awardedPoints > 0 ? "success" : "destructive"} data-testid="awarded-points">
              {q.awardedPoints} / {q.maxPoints} points
            </Badge>
          )}
        </CardAction>
        <CardTitle className="grid gap-3 font-sans font-normal tracking-normal md:grid-cols-2">
          <p lang="de">
            <span className="block text-xs font-semibold text-muted-foreground">Deutsch</span>
            <span className="text-base font-semibold">{q.stemDe}</span>
          </p>
          <p lang="en">
            <span className="block text-xs font-semibold text-muted-foreground">English</span>
            <span className="text-base">{q.stemEn}</span>
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
                className="flex flex-col gap-2 rounded-md border p-3 data-chosen:not-data-correct:border-destructive/40 data-chosen:not-data-correct:bg-destructive-muted data-correct:border-success/40 data-correct:bg-success-muted md:flex-row md:items-center"
              >
                <span className="grid flex-1 gap-1 md:grid-cols-2">
                  <span lang="de">{o.de}</span>
                  <span lang="en" className="text-muted-foreground">
                    {o.en}
                  </span>
                </span>
                <span className="flex shrink-0 flex-wrap gap-1">
                  {chosen ? (
                    <Badge variant={correct ? "success" : "destructive"}>Student&apos;s answer</Badge>
                  ) : null}
                  {correct ? <Badge variant="success">Correct answer</Badge> : null}
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
          <CardTitle>
            <h1 className="text-2xl font-semibold">{review.studentName}</h1>
          </CardTitle>
          <CardAction>
            <Badge variant={released ? "success" : "warning"} data-testid="review-status">
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
              <dd className="font-heading text-lg font-semibold tabular-nums" data-testid="review-score">
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

      <h2 className="mt-2 text-lg font-semibold">Answers</h2>
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
    <main className={staffMain}>
      <div>
        <Link href="/staff/review" className={`${linkClass} inline-flex items-center gap-1 text-sm`}>
          <ChevronLeftIcon aria-hidden="true" className="size-4" />
          Back to review list
        </Link>
      </div>
      <Suspense fallback={<EvaluationSkeleton />}>
        <Evaluation params={props.params} />
      </Suspense>
    </main>
  );
}
