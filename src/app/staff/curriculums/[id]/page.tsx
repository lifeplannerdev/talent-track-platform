import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { isUuid } from "@/lib/attempts";
import { examSetWarnings, formatTopicMix } from "@/lib/exam-set-fields";
import { listCurriculumsWithSets } from "@/lib/staff-manage";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { StaffNav } from "../../staff-nav";
import { linkClass } from "../../students/ui";
import { CurriculumNameForm } from "../curriculum-name-form";
import { ExamSetForm, NEW_EXAM_SET } from "./exam-set-form";

export const metadata: Metadata = { title: "Curriculum | TalentTrack" };

async function CurriculumDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("staff");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const curriculum = (await listCurriculumsWithSets()).find((c) => c.id === id);
  if (!curriculum) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold" data-testid="curriculum-name">
          {curriculum.name}
        </h2>
        <CurriculumNameForm id={curriculum.id} name={curriculum.name} />
      </div>

      <section aria-labelledby="sets-heading" className="flex flex-col gap-4">
        <h2 id="sets-heading" className="text-lg font-medium">
          Exam sets
        </h2>
        {curriculum.examSets.length === 0 ? (
          <Empty className="border" data-testid="exam-sets-empty">
            <EmptyHeader>
              <EmptyTitle>No exam sets yet</EmptyTitle>
              <EmptyDescription>Create one below, then add questions to it on the Questions page.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          curriculum.examSets.map((s) => {
            const warnings = examSetWarnings({ questionCount: s.questionCount, topicMix: s.topicMix }, s.approvedTopics);
            return (
              <Card key={s.id} data-testid="exam-set-card">
                <CardHeader>
                  <CardTitle>{s.name}</CardTitle>
                  <CardDescription>
                    {s.questionCount} questions · {s.timeLimitMin} min · pass {s.passMarkPercent}% · up to {s.maxAttempts} attempt
                    {s.maxAttempts === 1 ? "" : "s"} · {s.holdResult ? "results held for review" : "results released at once"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant="secondary">{s.approvedCount} approved</Badge>
                    <Badge variant="outline">{s.draftCount} draft</Badge>
                    {Object.keys(s.topicMix).length > 0 ? (
                      <span className="text-muted-foreground">Topic mix: {formatTopicMix(s.topicMix).replaceAll("\n", ", ")}</span>
                    ) : null}
                    <Link href={`/staff/questions?examSet=${s.id}`} className={linkClass}>
                      Questions
                    </Link>
                  </p>
                  {warnings.length > 0 ? (
                    <Alert>
                      <AlertDescription>
                        <ul className="list-disc pl-4">
                          {warnings.map((w) => (
                            <li key={w}>{w}</li>
                          ))}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  <details className="group rounded-lg border p-3">
                    <summary className="cursor-pointer rounded-sm text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                      Edit settings
                    </summary>
                    <div className="pt-4">
                      <ExamSetForm curriculumId={curriculum.id} initial={s} />
                    </div>
                  </details>
                </CardContent>
              </Card>
            );
          })
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>New exam set</CardTitle>
          <CardDescription>Students get questions they have not seen before on every attempt.</CardDescription>
        </CardHeader>
        <CardContent>
          <ExamSetForm curriculumId={curriculum.id} initial={NEW_EXAM_SET} />
        </CardContent>
      </Card>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div role="status" aria-label="Loading curriculum" className="flex flex-col gap-4">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

export default function CurriculumPage(props: PageProps<"/staff/curriculums/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-10">
      <h1 className="text-2xl font-semibold">Curriculum</h1>
      <StaffNav current="/staff/curriculums" />
      <Link href="/staff/curriculums" className={linkClass}>
        All curriculums
      </Link>
      <Suspense fallback={<DetailSkeleton />}>
        <CurriculumDetail params={props.params} />
      </Suspense>
    </main>
  );
}
