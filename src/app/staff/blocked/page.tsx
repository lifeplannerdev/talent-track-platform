import { Suspense } from "react";
import type { Metadata } from "next";
import { ShieldCheckIcon } from "lucide-react";
import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { formatPercent } from "@/lib/percent";
import { listBlockedStudents } from "@/lib/staff-overview";
import { PageHeader } from "@/components/app/page-header";
import { linkClass, staffMain } from "@/components/app/styles";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ActionStatusProvider } from "../grants/action-status";
import { ExtraAttemptsButton } from "../grants/extra-attempts-button";

export const metadata: Metadata = { title: "Blocked students | Talent Track Platform" };

async function BlockedList() {
  await requireRole("staff");
  const rows = await listBlockedStudents();

  if (rows.length === 0) {
    return (
      <Empty className="border" data-testid="blocked-empty">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShieldCheckIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>No blocked students</EmptyTitle>
          <EmptyDescription>
            A student is blocked when they fail their last allowed attempt. They will appear here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Table data-testid="blocked-table" className="min-w-[48rem]">
      <TableHeader>
        <TableRow>
          <TableHead>Student</TableHead>
          <TableHead>Curriculum and last exam</TableHead>
          <TableHead className="text-right">Attempts used</TableHead>
          <TableHead className="text-right">Exam sets left</TableHead>
          <TableHead className="text-right">Last score</TableHead>
          <TableHead>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={`${r.studentId}:${r.curriculumId}`} className="align-top">
            <TableCell>
              <span className="block font-semibold">{r.studentName}</span>
              <span className="block text-muted-foreground">{r.batch ? `Batch ${r.batch}` : "No batch"}</span>
            </TableCell>
            <TableCell>
              <span className="block">{r.curriculumName}</span>
              <span className="block text-muted-foreground">{r.lastExamSetName || "No attempt scored"}</span>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {r.attemptsUsed} of {r.allowance}
            </TableCell>
            <TableCell className="text-right tabular-nums">{r.examSetsLeft}</TableCell>
            <TableCell className="text-right tabular-nums">
              {r.lastPoints === null || r.lastMaxPoints === null ? (
                "No score"
              ) : (
                <>
                  <span className="block font-semibold">{formatPercent(r.lastPoints, r.lastMaxPoints)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {r.lastPoints} / {r.lastMaxPoints}
                    <span className="sr-only"> points</span>
                  </span>
                </>
              )}
            </TableCell>
            <TableCell>
              <div className="flex flex-col items-start gap-2">
                <ExtraAttemptsButton
                  studentId={r.studentId}
                  curriculumId={r.curriculumId}
                  studentName={r.studentName}
                  curriculumName={r.curriculumName}
                  attemptsUsed={r.attemptsUsed}
                  allowance={r.allowance}
                  blocked
                  allowRepeats={r.allowRepeats}
                  suggestRepeats={r.examSetsLeft === 0}
                />
                <Link href={`/staff/students/${r.studentId}`} className={linkClass}>
                  Student page<span className="sr-only"> of {r.studentName}</span>
                </Link>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ListSkeleton() {
  return (
    <div role="status" aria-label="Loading blocked students" className="flex flex-col gap-2">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

export default function BlockedPage() {
  return (
    <main className={staffMain}>
      <PageHeader
        title="Blocked students"
        description="These students failed their last allowed attempt in a curriculum. Extra attempts lift the block; on the student page you can also change their curriculums."
      />
      <ActionStatusProvider>
        <Suspense fallback={<ListSkeleton />}>
          <BlockedList />
        </Suspense>
      </ActionStatusProvider>
    </main>
  );
}
