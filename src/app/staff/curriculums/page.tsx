import { Suspense } from "react";
import type { Metadata } from "next";
import { LibraryIcon } from "lucide-react";
import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { formatDuration } from "@/lib/duration";
import { curriculumWarnings, poolWarning } from "@/lib/exam-set-fields";
import { listCurriculumsWithSets } from "@/lib/staff-manage";
import { PageHeader } from "@/components/app/page-header";
import { staffMain } from "@/components/app/styles";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { linkClass } from "../students/ui";
import { CurriculumNameForm } from "./curriculum-name-form";

export const metadata: Metadata = { title: "Curriculums | Talent Track Platform" };

async function CurriculumList() {
  await requireRole("staff");
  const curriculums = await listCurriculumsWithSets();

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border bg-card p-4">
        <CurriculumNameForm openAfterCreate />
      </div>
      {curriculums.length === 0 ? (
        <Empty className="border" data-testid="curriculums-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LibraryIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No curriculums yet</EmptyTitle>
            <EmptyDescription>Create a curriculum, then add exam sets to it.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {curriculums.map((c) => (
            <li key={c.id}>
              <Card size="sm" data-testid="curriculum-card" className="h-full">
                <CardHeader>
                  <CardTitle className="text-base">
                    <Link href={`/staff/curriculums/${c.id}`} className={linkClass}>
                      {c.name}
                    </Link>
                  </CardTitle>
                  <CardDescription className="flex flex-wrap items-center gap-2">
                    <span data-testid="curriculum-attempts">
                      {c.maxAttempts} attempt{c.maxAttempts === 1 ? "" : "s"} per student
                    </span>
                    {curriculumWarnings({
                      maxAttempts: c.maxAttempts,
                      examSets: c.examSets.map((s) => ({ ...s, approvedTopics: s.approvedTopics.map((q) => q.topic) })),
                    }).length > 0 ? (
                      <Badge variant="warning">Too few exam sets</Badge>
                    ) : null}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {c.examSets.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No exam sets yet.</p>
                  ) : (
                    <ul className="flex flex-col divide-y text-sm">
                      {c.examSets.map((s) => (
                        <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                          <span className="font-semibold">{s.name}</span>
                          <span className="flex items-center gap-2 text-muted-foreground tabular-nums">
                            {s.approvedCount} approved / {s.questionCount} per paper, {formatDuration(s.timeLimitMin)}
                            {poolWarning(s.approvedCount, s.questionCount) ? <Badge variant="warning">Too few questions</Badge> : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div role="status" aria-label="Loading curriculums" className="grid gap-4 md:grid-cols-2">
      <Skeleton className="h-32" />
      <Skeleton className="h-32" />
    </div>
  );
}

export default function CurriculumsPage() {
  return (
    <main className={staffMain}>
      <PageHeader
        title="Curriculums"
        description="A curriculum is one exam with its own attempts per student and several exam sets (each attempt uses a different one). Open one to change its settings and exam sets."
      />
      <Suspense fallback={<ListSkeleton />}>
        <CurriculumList />
      </Suspense>
    </main>
  );
}
