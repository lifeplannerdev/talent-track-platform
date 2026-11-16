import { Suspense } from "react";
import type { Metadata } from "next";
import { ShieldCheckIcon } from "lucide-react";
import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { listBlockedStudents } from "@/lib/staff-overview";
import { PageHeader } from "@/components/app/page-header";
import { linkClass, staffMain } from "@/components/app/styles";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GrantButton } from "../grants/grant-button";
import { GrantStatusProvider } from "../grants/grant-status";

export const metadata: Metadata = { title: "Blocked students | TalentTrack" };


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
          <TableHead>Curriculum and exam</TableHead>
          <TableHead className="text-right">Attempts used</TableHead>
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
              <span className="block text-muted-foreground">{r.examSetName || "No exam set"}</span>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {r.maxAttempts === null ? r.attemptsUsed : `${r.attemptsUsed} of ${r.maxAttempts}`}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {r.lastPoints === null ? "No score" : `${r.lastPoints} / ${r.lastMaxPoints}`}
            </TableCell>
            <TableCell>
              <div className="flex flex-col items-start gap-2">
                {r.examSetId ? (
                  <GrantButton
                    studentId={r.studentId}
                    examSetId={r.examSetId}
                    studentName={r.studentName}
                    examSetName={r.examSetName}
                    label="Grant another attempt"
                    note="This lifts the block."
                  />
                ) : null}
                {/* The student management page (/staff/students/[id]) is built in Task 8. */}
                <Link href={`/staff/students/${r.studentId}`} className={linkClass}>
                  Reassign curriculums
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
        description="These students failed their last allowed attempt. Give another attempt (only with questions they have not seen) or reassign their curriculums."
      />
      <GrantStatusProvider>
        <Suspense fallback={<ListSkeleton />}>
          <BlockedList />
        </Suspense>
      </GrantStatusProvider>
    </main>
  );
}
