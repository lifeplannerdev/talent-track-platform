import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { formatDateTime } from "@/lib/format";
import { getStudentResult, percentOf, type StudentResult } from "@/lib/results";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Result | TalentTrack" };

// English interface; the released report itself is bilingual (German / English) and prints
// as a clean report. Before release nothing about the score reaches this page: the data comes
// from the student_attempts view, which masks the numbers, and getStudentResult returns none.

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/exam/start" className={buttonVariants({ variant: "outline", className: "print:hidden" })}>
      Back to exams
    </Link>
  );
}

function AwaitingReview({ result }: { result: Extract<StudentResult, { status: "submitted" }> }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{result.curriculumName}</CardDescription>
        <CardTitle className="text-xl">Submitted</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p data-testid="result-status">Submitted, awaiting review. Your trainer will release your result.</p>
        <p className="text-sm text-muted-foreground">
          {result.examSetName} · submitted {formatDateTime(result.submittedAt)}
        </p>
      </CardContent>
      <CardFooter>
        <BackLink />
      </CardFooter>
    </Card>
  );
}

function Report({ result, studentName }: { result: Extract<StudentResult, { status: "released" }>; studentName: string }) {
  return (
    <Card className="print:shadow-none print:ring-0" data-testid="result-report">
      <CardHeader>
        <CardDescription>TalentTrack · Life Planner</CardDescription>
        <CardTitle className="text-2xl">
          <h1>Ergebnis / Result</h1>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 print:grid-cols-2">
          <Fact label="Name / Name">{studentName}</Fact>
          <Fact label="Lehrplan / Curriculum">{result.curriculumName}</Fact>
          <Fact label="Prüfung / Exam">{result.examSetName}</Fact>
          <Fact label="Abgegeben / Submitted">{formatDateTime(result.submittedAt)}</Fact>
          <Fact label="Freigegeben / Released">{formatDateTime(result.releasedAt)}</Fact>
        </dl>

        <Separator />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">Punkte / Points</p>
            <p className="text-3xl font-semibold tabular-nums" data-testid="result-score">
              {result.points} of {result.maxPoints}
              <span className="ml-2 text-xl font-normal text-muted-foreground">({result.percent}%)</span>
            </p>
          </div>
          <Badge
            variant={result.passed ? "default" : "destructive"}
            className="h-auto px-3 py-1 text-sm"
            data-testid="result-outcome"
          >
            {result.passed ? "Bestanden / Passed" : "Nicht bestanden / Not passed"}
          </Badge>
        </div>

        {result.topics.length > 0 ? (
          <section className="flex flex-col gap-2" aria-labelledby="topics-heading">
            <h2 id="topics-heading" className="font-medium">
              Ergebnis nach Thema / Result by topic
            </h2>
            <Table data-testid="topic-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Thema / Topic</TableHead>
                  <TableHead className="text-right">Punkte / Points</TableHead>
                  <TableHead className="text-right">%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.topics.map((t) => (
                  <TableRow key={t.topic}>
                    <TableCell className="whitespace-normal">{t.topic}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {t.points} / {t.max}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {percentOf(t.points, t.max)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        ) : null}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 print:hidden">
        <PrintButton />
        <BackLink />
      </CardFooter>
    </Card>
  );
}

async function Result({ params }: { params: Promise<{ attemptId: string }> }) {
  const profile = await requireRole("student");
  const { attemptId } = await params;
  // Ownership is decided by the session (the view filters by auth.uid()); another
  // student's attempt is simply not found. notFound() runs inside the Suspense boundary, so
  // the not-found UI is streamed with HTTP status 200 (the shell is already sent); no data of
  // the attempt is ever rendered, which e2e/results.spec.ts checks on the response body.
  const result = await getStudentResult(profile.id, attemptId);
  if (!result) notFound();
  if (result.status === "in_progress") redirect(`/exam/${result.id}`);
  if (result.status === "submitted") return <AwaitingReview result={result} />;
  return <Report result={result} studentName={profile.full_name ?? profile.username} />;
}

function ResultSkeleton() {
  return (
    <div role="status" aria-label="Loading result" className="flex flex-col gap-3">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

export default function ResultPage(props: PageProps<"/results/[attemptId]">) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 print:max-w-none print:p-0">
      <Suspense fallback={<ResultSkeleton />}>
        <Result params={props.params} />
      </Suspense>
    </main>
  );
}
