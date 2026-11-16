import { Suspense } from "react";
import type { Metadata } from "next";
import { InboxIcon } from "lucide-react";
import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { formatDateTime } from "@/lib/format";
import { listSubmittedAttempts } from "@/lib/review";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/page-header";
import { linkClass, staffMain } from "@/components/app/styles";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Review | TalentTrack" };

async function ReviewList() {
  await requireRole("staff");
  const attempts = await listSubmittedAttempts();

  if (attempts.length === 0) {
    return (
      <Empty className="border" data-testid="review-empty">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <InboxIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>Nothing to review</EmptyTitle>
          <EmptyDescription>Submitted exams with held results appear here until you release them.</EmptyDescription>
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
              {a.points === null || a.maxPoints === null ? (
                <Badge variant="outline">Scoring pending</Badge>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <span className="tabular-nums">
                    {a.points} / {a.maxPoints}
                  </span>
                  <Badge variant={a.passed ? "success" : "destructive"}>{a.passed ? "Pass" : "Fail"}</Badge>
                </span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ListSkeleton() {
  return (
    <div role="status" aria-label="Loading submitted exams" className="flex flex-col gap-2">
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
        title="Results awaiting release"
        description="Scores are calculated automatically and cannot be changed. Open an exam to check it, then release the result to the student."
      />
      <Suspense fallback={<ListSkeleton />}>
        <ReviewList />
      </Suspense>
    </main>
  );
}
