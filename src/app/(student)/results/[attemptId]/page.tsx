import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { formatDateTime } from "@/lib/format";
import { formatPercent, percentValue } from "@/lib/percent";
import { getStudentResult, type StudentResult } from "@/lib/results";
import { ChevronLeftIcon, CircleCheckIcon, CircleXIcon } from "lucide-react";
import { StudentHeader } from "@/components/app/student-header";
import { ScoreBar } from "@/components/app/score-bar";
import { factLabel, studentMain } from "@/components/app/styles";
import { Wordmark } from "@/components/app/wordmark";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CalculatingResult } from "./calculating";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Result | TalentTrack" };

// English interface; the report itself is bilingual (German / English) and prints as a clean
// report. It shows as soon as the attempt is scored (spec change 1: scoring releases at once).
// Until the score exists nothing about it reaches this page: the student_attempts view masks the
// numbers and getStudentResult returns none (CalculatingResult).

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className={factLabel}>{label}</dt>
      <dd className="text-base break-words">{children}</dd>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/exam/start" className={buttonVariants({ variant: "outline", size: "lg", className: "print:hidden" })}>
      <ChevronLeftIcon data-icon="inline-start" />
      Back to exams
    </Link>
  );
}

function Report({ result, studentName }: { result: Extract<StudentResult, { status: "released" }>; studentName: string }) {
  const Outcome = result.passed ? CircleCheckIcon : CircleXIcon;
  return (
    <Card size="sm" className="gap-0 py-0 print:overflow-visible print:rounded-none print:ring-0" data-testid="result-report">
      {/* Letterhead: wordmark and the ink rule of an official sheet. */}
      <div className="flex items-center justify-between gap-3 border-b-2 border-primary px-4 py-3 sm:px-6 print:px-0">
        <Wordmark />
        <p className="text-right text-xs text-muted-foreground print:text-black">
          Prüfungsergebnis
          <span className="block">Exam report</span>
        </p>
      </div>

      <div className="flex flex-col gap-5 px-4 py-5 sm:px-6 print:gap-4 print:px-0 print:py-4">
        <h1 className="text-[1.625rem] leading-tight font-semibold sm:text-[1.75rem]">Ergebnis / Result</h1>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:gap-x-6 print:grid-cols-3">
          <Fact label="Name / Name">{studentName}</Fact>
          <Fact label="Lehrplan / Curriculum">{result.curriculumName}</Fact>
          <Fact label="Prüfung / Exam">{result.examSetName}</Fact>
          <Fact label="Abgegeben / Submitted">{formatDateTime(result.submittedAt)}</Fact>
        </dl>

        <section
          aria-label="Gesamtergebnis / Overall result"
          className="flex flex-col gap-3 rounded-lg bg-muted/60 p-4 ring-1 ring-border ring-inset print:bg-transparent print:ring-black"
        >
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
            <div className="flex flex-col gap-1.5">
              <p className={factLabel}>Prozent / Percent</p>
              <p className="font-heading text-[3rem] leading-none font-semibold tabular-nums sm:text-[3.5rem]" data-testid="result-score">
                {result.percentLabel}
              </p>
              <p className="text-base text-muted-foreground tabular-nums print:text-black" data-testid="result-points">
                {result.points} von {result.maxPoints} Punkten / {result.points} of {result.maxPoints} points
              </p>
            </div>
            <Badge
              variant={result.passed ? "success" : "destructive"}
              className="h-auto gap-1.5 rounded-md px-3 py-1.5 text-base print:border-black print:bg-transparent print:text-black"
              data-testid="result-outcome"
            >
              <Outcome aria-hidden="true" />
              {result.passed ? "Bestanden / Passed" : "Nicht bestanden / Not passed"}
            </Badge>
          </div>
          <ScoreBar percent={result.percent} passMarkPercent={result.passMarkPercent} passed={result.passed} />
          {result.passMarkPercent !== null ? (
            <p className="text-sm text-muted-foreground print:text-black" data-testid="result-pass-mark">
              Bestehensgrenze / Pass mark{" "}
              <span className="font-semibold text-foreground tabular-nums">{result.passMarkPercent}%</span>
              <span className="sr-only"> of the points</span>
            </p>
          ) : null}
        </section>

        {result.topics.length > 0 ? (
          <section className="flex flex-col gap-2" aria-labelledby="topics-heading">
            <h2 id="topics-heading" className="text-base font-semibold sm:text-lg">
              Ergebnis nach Thema / Result by topic
            </h2>
            <Table data-testid="topic-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Thema / Topic</TableHead>
                  <TableHead className="text-right">Prozent / Percent</TableHead>
                  <TableHead className="hidden text-right sm:table-cell print:table-cell">Punkte / Points</TableHead>
                  <TableHead className="hidden w-[32%] sm:table-cell print:table-cell">
                    <span className="sr-only">Anteil / Share</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.topics.map((t) => {
                  return (
                    <TableRow key={t.topic} className="hover:bg-transparent">
                      <TableCell className="whitespace-normal">{t.topic}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span className="font-semibold">{formatPercent(t.points, t.max)}</span>
                        {/* Phones: the points sit under the percentage instead of in their own column. */}
                        <span className="block text-xs text-muted-foreground sm:hidden print:hidden">
                          {t.points} / {t.max}
                        </span>
                      </TableCell>
                      <TableCell className="hidden text-right text-muted-foreground tabular-nums sm:table-cell print:table-cell print:text-black">
                        {t.points} / {t.max}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell print:table-cell">
                        <ScoreBar percent={percentValue(t.points, t.max)} size="sm" />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </section>
        ) : null}

        <p className="text-xs text-muted-foreground print:text-black">
          Automatisch bewertet; bestanden ab der Bestehensgrenze in Prozent der Punkte; die Themen ergeben zusammen die
          Gesamtpunktzahl. / Scored automatically; passed at or above the pass mark as a percentage of the points; the topics
          add up to the total points.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-t px-4 py-3 sm:px-6 print:hidden">
        <PrintButton />
        <BackLink />
      </div>
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
  if (result.status === "submitted") return <CalculatingResult result={result} />;
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
    <>
      <StudentHeader signOut />
      <main className={`${studentMain} print:max-w-none print:p-0`}>
        <Suspense fallback={<ResultSkeleton />}>
          <Result params={props.params} />
        </Suspense>
      </main>
    </>
  );
}
