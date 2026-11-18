import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { formatDateTime } from "@/lib/format";
import { topicTotals } from "@/lib/report";
import { formatPercent, percentValue } from "@/lib/percent";
import { getAttemptReview, type ReviewQuestion } from "@/lib/review";
import { Badge } from "@/components/ui/badge";
import { SectionHeading } from "@/components/app/page-header";
import { ScoreBar } from "@/components/app/score-bar";
import { factLabel, linkClass, staffMain } from "@/components/app/styles";
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
          {q.topic ? <span className="ml-2">Topic: {q.topic}</span> : null}
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
        <ul className="flex flex-col gap-1.5" aria-label={`Options for question ${q.position}`}>
          {q.options.map((o) => {
            const correct = o.id === q.correctOptionId;
            const chosen = o.id === q.chosenOptionId;
            return (
              <li
                key={o.id}
                data-testid="review-option"
                data-correct={correct || undefined}
                data-chosen={chosen || undefined}
                className="flex flex-col gap-1.5 rounded-md border px-3 py-2 data-chosen:not-data-correct:border-destructive/40 data-chosen:not-data-correct:bg-destructive-muted data-correct:border-success/40 data-correct:bg-success-muted md:flex-row md:items-center"
              >
                <span className="grid flex-1 gap-1 md:grid-cols-2">
                  <span lang="de">{o.de}</span>
                  <span lang="en" className="text-muted-foreground">
                    {o.en}
                  </span>
                </span>
                <span className="flex shrink-0 flex-wrap gap-1 md:w-60 md:justify-end">
                  {chosen ? <Badge variant={correct ? "success" : "destructive"}>Student&apos;s answer</Badge> : null}
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

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className={factLabel}>{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

async function Evaluation({ params }: { params: Promise<{ attemptId: string }> }) {
  await requireRole("staff");
  const { attemptId } = await params;
  const review = await getAttemptReview(attemptId);
  if (!review || review.status === "in_progress") notFound();

  const scored = review.points !== null && review.maxPoints !== null;
  const summary = scored ? `${review.percentLabel} (${review.points} of ${review.maxPoints} points)` : "not scored yet";
  const released = review.status === "released";
  const percent = scored ? percentValue(review.points!, review.maxPoints!) : null;
  const topics = topicTotals(review.questions);
  const answered = review.questions.filter((q) => q.chosenOptionId !== null).length;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardDescription>
            {review.curriculumName}
            {review.examSetName ? <span className="text-muted-foreground">, {review.examSetName}</span> : null}
          </CardDescription>
          <CardTitle>
            <h1 className="text-[1.375rem] leading-tight font-semibold sm:text-2xl">{review.studentName}</h1>
          </CardTitle>
          <CardAction>
            <Badge variant={released ? "success" : "warning"} data-testid="review-status">
              {released ? "Released" : "Awaiting release"}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
              <Fact label="Submitted">{formatDateTime(review.submittedAt)}</Fact>
              <Fact label="Answered">
                <span className="tabular-nums">
                  {answered} of {review.questions.length}
                </span>
              </Fact>
              {released ? (
                <div className="col-span-2 flex flex-col gap-0.5">
                  <dt className={factLabel}>Released</dt>
                  <dd className="text-sm">
                    {formatDateTime(review.releasedAt)}
                    {review.releasedBy ? ` by ${review.releasedBy}` : " automatically"}
                  </dd>
                </div>
              ) : null}
            </dl>
            <div className="flex flex-col items-start gap-2">
              <ReleaseButton
                attemptId={review.id}
                canRelease={!released && scored}
                disabledLabel={released ? "Released" : "Scoring pending"}
                summary={summary}
              />
              {!released && scored ? (
                <p className="text-xs text-muted-foreground">The student sees no score until you release it.</p>
              ) : null}
            </div>
          </div>

          <section aria-label="Score" className="flex flex-col gap-3 rounded-lg bg-muted/60 p-4 ring-1 ring-border ring-inset">
            <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
              <div className="flex flex-col gap-1">
                <p className={factLabel}>Percent</p>
                <p className="font-heading text-[2rem] leading-none font-semibold tabular-nums" data-testid="review-score">
                  {scored ? review.percentLabel : "Scoring pending"}
                </p>
                {scored ? (
                  <p className="text-sm text-muted-foreground tabular-nums" data-testid="review-points">
                    {review.points} of {review.maxPoints} points
                  </p>
                ) : null}
              </div>
              {scored ? (
                <Badge variant={review.passed ? "success" : "destructive"} className="h-auto px-2.5 py-1 text-sm">
                  {review.passed ? "Pass" : "Fail"}
                </Badge>
              ) : null}
            </div>
            {percent !== null ? (
              <>
                <ScoreBar percent={percent} passMarkPercent={review.passMarkPercent} passed={review.passed} />
                {review.passMarkPercent !== null ? (
                  <p className="text-xs text-muted-foreground">
                    Pass mark <span className="font-semibold text-foreground tabular-nums">{review.passMarkPercent}%</span>
                  </p>
                ) : null}
              </>
            ) : null}
            {topics.length > 1 ? (
              <table className="w-full text-sm" aria-label="Result by topic">
                <thead className="sr-only">
                  <tr>
                    <th scope="col">Topic</th>
                    <th scope="col">Percent</th>
                    <th scope="col">Points</th>
                    <th scope="col">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {topics.map((t) => (
                    <tr key={t.topic}>
                      <td className="py-1 pr-3">{t.topic}</td>
                      <td className="py-1 pr-3 text-right font-semibold whitespace-nowrap tabular-nums">{formatPercent(t.points, t.max)}</td>
                      <td className="py-1 pr-3 text-right whitespace-nowrap text-muted-foreground tabular-nums">
                        {t.points} / {t.max}
                      </td>
                      <td className="w-2/5 py-1">
                        <ScoreBar percent={percentValue(t.points, t.max)} size="sm" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </section>
        </CardContent>
      </Card>

      <SectionHeading aside={<p className="text-xs text-muted-foreground">German with the English translation beside it.</p>}>
        Answers
      </SectionHeading>
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
