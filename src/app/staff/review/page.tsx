import { Suspense } from "react";
import type { Metadata } from "next";
import { InboxIcon } from "lucide-react";
import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { formatDateTime } from "@/lib/format";
import { listResults } from "@/lib/review";
import { PageHeader } from "@/components/app/page-header";
import { ResultScore } from "@/components/app/result-score";
import { linkClass, staffMain } from "@/components/app/styles";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Attempts | TalentTrack" };

async function ReviewList() {
  await requireRole("staff");
  const { rows: attempts } = await listResults({});

  if (attempts.length === 0) {
    return (
      <Empty className="border" data-testid="review-empty">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <InboxIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>No attempts yet</EmptyTitle>
          <EmptyDescription>Submitted exams appear here with their score.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Table data-testid="review-table">
      <TableHeader>
        <TableRow>
          <TableHead>Student</TableHead>
          <TableHead>Curriculum and exam</TableHead>
          <TableHead>Submitted</TableHead>
          <TableHead className="text-right">Score</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {attempts.map((a) => (
          <TableRow key={a.id}>
            <TableCell>
              <Link href={`/staff/review/${a.id}`} className={linkClass}>
                {a.studentName}
              </Link>
            </TableCell>
            <TableCell>
              <span className="block">{a.curriculumName}</span>
              <span className="block text-muted-foreground">{a.examSetName}</span>
            </TableCell>
            <TableCell>{formatDateTime(a.submittedAt)}</TableCell>
            <TableCell className="text-right">
              <ResultScore points={a.points} maxPoints={a.maxPoints} passed={a.passed} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ListSkeleton() {
  return (
    <div role="status" aria-label="Loading attempts" className="flex flex-col gap-2">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

export default function ReviewPage() {
  return (
    <main className={staffMain}>
      <PageHeader
        title="Attempts"
        description="Every submitted exam, read only. Scores are calculated automatically, shown to the student at once and cannot be changed. Open an exam to see the evaluation."
      />
      <Suspense fallback={<ListSkeleton />}>
        <ReviewList />
      </Suspense>
    </main>
  );
}
