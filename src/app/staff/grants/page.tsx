import { Suspense } from "react";
import type { Metadata } from "next";
import { CircleCheckIcon } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { listGrantable } from "@/lib/staff-overview";
import { PageHeader } from "@/components/app/page-header";
import { staffMain } from "@/components/app/styles";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GrantStatusProvider } from "./grant-status";
import { GrantButton } from "./grant-button";

export const metadata: Metadata = { title: "Give attempts | TalentTrack" };

async function GrantableList() {
  await requireRole("staff");
  const rows = await listGrantable();

  if (rows.length === 0) {
    return (
      <Empty className="border" data-testid="grants-empty">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CircleCheckIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>Nobody is waiting for an attempt</EmptyTitle>
          <EmptyDescription>
            Students with an open curriculum and no attempt available, in progress or awaiting review appear here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Table data-testid="grants-table" className="min-w-[40rem]">
      <TableHeader>
        <TableRow>
          <TableHead>Student</TableHead>
          <TableHead>Curriculum and exam</TableHead>
          <TableHead className="text-right">Attempts used</TableHead>
          <TableHead>Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={`${r.studentId}:${r.examSetId}`} className="align-top">
            <TableCell>
              <span className="block font-semibold">{r.studentName}</span>
              <span className="block text-muted-foreground">{r.batch ? `Batch ${r.batch}` : "No batch"}</span>
            </TableCell>
            <TableCell>
              <span className="block">{r.curriculumName}</span>
              <span className="block text-muted-foreground">{r.examSetName}</span>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {r.attemptsUsed} of {r.maxAttempts}
            </TableCell>
            <TableCell>
              <GrantButton
                studentId={r.studentId}
                examSetId={r.examSetId}
                studentName={r.studentName}
                examSetName={r.examSetName}
                label="Give attempt"
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ListSkeleton() {
  return (
    <div role="status" aria-label="Loading students" className="flex flex-col gap-2">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

export default function GrantsPage() {
  return (
    <main className={staffMain}>
      <PageHeader
        title="Give attempts"
        description="Attempts are never given automatically. Give a first attempt or a retake here; blocked students are on the Blocked page."
      />
      <GrantStatusProvider>
        <Suspense fallback={<ListSkeleton />}>
          <GrantableList />
        </Suspense>
      </GrantStatusProvider>
    </main>
  );
}
