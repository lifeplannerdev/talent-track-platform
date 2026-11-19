import { Suspense } from "react";
import type { Metadata } from "next";
import { CircleCheckIcon } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { listExtraAttemptCandidates } from "@/lib/staff-overview";
import { PageHeader } from "@/components/app/page-header";
import { staffMain } from "@/components/app/styles";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GrantStatusProvider } from "./grant-status";
import { GrantButton } from "./grant-button";

export const metadata: Metadata = { title: "Extra attempts | TalentTrack" };

async function CandidateList() {
  await requireRole("staff");
  const rows = await listExtraAttemptCandidates();

  if (rows.length === 0) {
    return (
      <Empty className="border" data-testid="grants-empty">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CircleCheckIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>Nobody needs extra attempts</EmptyTitle>
          <EmptyDescription>
            Blocked students, and students with attempts left but no exam set they have not had yet, appear here.
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
          <TableHead>Curriculum</TableHead>
          <TableHead className="text-right">Attempts used</TableHead>
          <TableHead>Action</TableHead>
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
              <span className="block text-muted-foreground">
                {r.reason === "blocked" ? "Blocked" : "No exam set left that the student has not had"}
              </span>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {r.attemptsUsed} of {r.allowance}
            </TableCell>
            <TableCell>
              <GrantButton
                studentId={r.studentId}
                curriculumId={r.curriculumId}
                studentName={r.studentName}
                curriculumName={r.curriculumName}
                allowRepeats={r.reason === "no_exam_sets_left" || r.examSetsLeft === 0}
                label={r.examSetsLeft === 0 ? "Give an extra attempt, allow repeats" : "Give an extra attempt"}
                note={r.reason === "blocked" ? "This lifts the block." : undefined}
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
        title="Extra attempts"
        description="Every student has the curriculum's attempts without approval. Give extra attempts here to blocked students, or let a student repeat exam sets when none is left."
      />
      <GrantStatusProvider>
        <Suspense fallback={<ListSkeleton />}>
          <CandidateList />
        </Suspense>
      </GrantStatusProvider>
    </main>
  );
}
