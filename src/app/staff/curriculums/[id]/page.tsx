import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { isUuid } from "@/lib/attempts";
import { curriculumWarnings, examSetSummary, examSetWarnings, formatTopicMix } from "@/lib/exam-set-fields";
import { listCurriculumsWithSets } from "@/lib/staff-manage";
import { ChevronLeftIcon, FileStackIcon } from "lucide-react";
import { PageHeader, SectionHeading } from "@/components/app/page-header";
import { staffMain } from "@/components/app/styles";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { linkClass } from "../../students/ui";
import { CurriculumSettingsForm } from "./curriculum-settings-form";
import { ExamSetForm, NEW_EXAM_SET } from "./exam-set-form";

export const metadata: Metadata = { title: "Curriculum | TalentTrack" };

async function CurriculumDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("staff");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const curriculum = (await listCurriculumsWithSets()).find((c) => c.id === id);
  if (!curriculum) notFound();
  const setWarnings = curriculumWarnings({
    maxAttempts: curriculum.maxAttempts,
    examSets: curriculum.examSets.map((s) => ({ ...s, approvedTopics: s.approvedTopics.map((q) => q.topic) })),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
        <h2 className="text-2xl font-semibold" data-testid="curriculum-name">
          {curriculum.name}
        </h2>
        <CurriculumSettingsForm id={curriculum.id} name={curriculum.name} maxAttempts={curriculum.maxAttempts} />
      </div>

      <section aria-labelledby="sets-heading" className="flex flex-col gap-4">
        <SectionHeading id="sets-heading">Exam sets</SectionHeading>
        <p className="max-w-prose text-sm text-muted-foreground">
          Each attempt gets a different exam set of this curriculum, chosen at random among the ones the student has not
          had. An exam set can be given only when it has at least its questions per paper approved.
        </p>
        {setWarnings.length > 0 ? (
          <Alert variant="warning" data-testid="curriculum-warning">
            <AlertDescription>{setWarnings[0]}</AlertDescription>
          </Alert>
        ) : null}
        {curriculum.examSets.length === 0 ? (
          <Empty className="border" data-testid="exam-sets-empty">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileStackIcon aria-hidden="true" />
              </EmptyMedia>
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
                  <CardDescription data-testid="exam-set-summary">
                    <span className="sr-only">Exam settings summary: </span>
                    {examSetSummary(s)}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant="success">{s.approvedCount} approved</Badge>
                    <Badge variant="outline">{s.draftCount} draft</Badge>
                    {Object.keys(s.topicMix).length > 0 ? (
                      <span className="text-muted-foreground">Topic mix: {formatTopicMix(s.topicMix).replaceAll("\n", ", ")}</span>
                    ) : null}
                    <Link href={`/staff/questions?examSet=${s.id}`} className={linkClass}>
                      Questions
                    </Link>
                  </p>
                  {warnings.length > 0 ? (
                    <Alert variant="warning">
                      <AlertDescription>
                        <ul className="list-disc pl-4">
                          {warnings.map((w) => (
                            <li key={w}>{w}</li>
                          ))}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  <details className="group rounded-md border bg-muted/40 p-3 open:bg-card">
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
          <CardDescription>Add as many exam sets as students have attempts, so every attempt gets a different one.</CardDescription>
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
    <main className={staffMain}>
      <div className="flex flex-col gap-2">
        <Link href="/staff/curriculums" className={`${linkClass} inline-flex w-fit items-center gap-1 text-sm`}>
          <ChevronLeftIcon aria-hidden="true" className="size-4" />
          All curriculums
        </Link>
        <PageHeader title="Curriculum" description="Name and attempts per student, then the exam sets and their settings." />
      </div>
      <Suspense fallback={<DetailSkeleton />}>
        <CurriculumDetail params={props.params} />
      </Suspense>
    </main>
  );
}
