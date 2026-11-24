import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheckIcon, LayersIcon } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { listExtraAttemptCandidates } from "@/lib/staff-overview";
import type { ExtraAttemptRow } from "@/lib/staff-overview-core";
import { PageHeader, SectionHeading } from "@/components/app/page-header";
import { linkClass, staffMain } from "@/components/app/styles";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ActionStatusProvider } from "./action-status";
import { ExtraAttemptsButton } from "./extra-attempts-button";

export const metadata: Metadata = { title: "Extra attempts | Talent Track Platform" };

function CandidateTable({ rows, testId }: { rows: ExtraAttemptRow[]; testId: string }) {
  return (
    <Table data-testid={testId} className="min-w-[44rem] table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-[26%]">Student</TableHead>
          <TableHead className="w-[30%]">Curriculum</TableHead>
          <TableHead className="w-[12%] text-right">Attempts used</TableHead>
          <TableHead className="w-[12%] text-right">Exam sets left</TableHead>
          <TableHead className="w-[20%]">Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={`${r.studentId}:${r.curriculumId}`} className="align-top" data-testid="extra-attempts-row">
            <TableCell>
              <Link href={`/staff/students/${r.studentId}`} className={`${linkClass} block w-fit`}>
                {r.studentName}
              </Link>
              <span className="block text-muted-foreground">{r.batch ? `Batch ${r.batch}` : "No batch"}</span>
            </TableCell>
            <TableCell>
              <span className="block">{r.curriculumName}</span>
              {r.allowRepeats ? <span className="block text-muted-foreground">Repeats allowed</span> : null}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {r.attemptsUsed} of {r.allowance}
            </TableCell>
            <TableCell className="text-right tabular-nums">{r.examSetsLeft}</TableCell>
            <TableCell>
              <ExtraAttemptsButton
                studentId={r.studentId}
                curriculumId={r.curriculumId}
                studentName={r.studentName}
                curriculumName={r.curriculumName}
                attemptsUsed={r.attemptsUsed}
                allowance={r.allowance}
                blocked={r.reason === "blocked"}
                allowRepeats={r.allowRepeats}
                suggestRepeats={r.examSetsLeft === 0}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

async function CandidateLists() {
  const profile = await requireRole("staff");
  // The Curriculums page is admin only: a trainer gets the sentence without the link.
  const isAdmin = profile.role === "admin";
  const rows = await listExtraAttemptCandidates();
  const blocked = rows.filter((r) => r.reason === "blocked");
  const short = rows.filter((r) => r.reason === "no_exam_sets_left");

  return (
    <>
      <section aria-labelledby="blocked-heading" className="flex flex-col gap-3">
        <SectionHeading id="blocked-heading">
          Blocked students <span className="font-normal text-muted-foreground tabular-nums">({blocked.length})</span>
        </SectionHeading>
        <p className="max-w-prose text-sm text-muted-foreground">
          They failed their last allowed attempt. Extra attempts lift the block. If no exam set is left that they have
          not had, also allow repeating exam sets.
        </p>
        {blocked.length === 0 ? (
          <Empty className="border" data-testid="grants-empty">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CircleCheckIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No blocked students</EmptyTitle>
              <EmptyDescription>A student who fails their last allowed attempt in a curriculum appears here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <CandidateTable rows={blocked} testId="grants-table" />
        )}
      </section>

      <section aria-labelledby="short-heading" className="flex flex-col gap-3">
        <SectionHeading id="short-heading">
          No exam set left <span className="font-normal text-muted-foreground tabular-nums">({short.length})</span>
        </SectionHeading>
        <p className="max-w-prose text-sm text-muted-foreground">
          These students still have attempts but have had every exam set of the curriculum, so they are told to contact
          their trainer. Allow repeating exam sets here
          {isAdmin ? (
            <>
              , or add exam sets on the{" "}
              <Link href="/staff/curriculums" className={linkClass}>
                Curriculums
              </Link>{" "}
              page.
            </>
          ) : (
            ", or ask an admin to add exam sets."
          )}
        </p>
        {short.length === 0 ? (
          <Empty className="border" data-testid="short-empty">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <LayersIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>Every student has an exam set left</EmptyTitle>
              <EmptyDescription>Students with attempts left but no exam set they have not had appear here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <CandidateTable rows={short} testId="short-table" />
        )}
      </section>
    </>
  );
}

function ListSkeleton() {
  return (
    <div role="status" aria-label="Loading students" className="flex flex-col gap-2">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

export default function ExtraAttemptsPage() {
  return (
    <main className={staffMain}>
      <PageHeader
        title="Extra attempts"
        description="Students get the curriculum's attempts without approval. Give extra attempts (1 to 10) to blocked students, or let a student repeat exam sets. You can also give extra attempts any time from a student's page."
      />
      <ActionStatusProvider>
        <Suspense fallback={<ListSkeleton />}>
          <CandidateLists />
        </Suspense>
      </ActionStatusProvider>
    </main>
  );
}
