import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { InboxIcon } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { ATTEMPT_FILTERS } from "@/lib/attempt-status";
import { formatDateTime } from "@/lib/format";
import { listResults } from "@/lib/review";
import { PageHeader } from "@/components/app/page-header";
import { AttemptStatusBadge, ResultScore } from "@/components/app/result-score";
import { linkClass, staffMain } from "@/components/app/styles";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Attempts | TalentTrack" };

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

async function AttemptList({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole("staff");
  const sp = await searchParams;
  const filters = { batch: first(sp.batch), curriculumId: first(sp.curriculum), status: first(sp.status) };
  const { rows, batches, curriculums } = await listResults(filters);
  const status = ATTEMPT_FILTERS.some((f) => f.value === filters.status) ? filters.status : "";
  const filtered = Boolean(filters.batch || filters.curriculumId || status);

  return (
    <div className="flex flex-col gap-4">
      <form method="get" role="search" aria-label="Filter attempts" className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="batch">Batch</Label>
          <NativeSelect id="batch" name="batch" defaultValue={filters.batch}>
            <NativeSelectOption value="">All batches</NativeSelectOption>
            {batches.map((b) => (
              <NativeSelectOption key={b} value={b}>
                {b}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="curriculum">Curriculum</Label>
          <NativeSelect id="curriculum" name="curriculum" defaultValue={filters.curriculumId}>
            <NativeSelectOption value="">All curriculums</NativeSelectOption>
            {curriculums.map((c) => (
              <NativeSelectOption key={c.id} value={c.id}>
                {c.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="status">Status</Label>
          <NativeSelect id="status" name="status" defaultValue={status}>
            {ATTEMPT_FILTERS.map((f) => (
              <NativeSelectOption key={f.value} value={f.value}>
                {f.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" variant="outline">
          Filter
        </Button>
        {filtered ? (
          <Link href="/staff/review" className={linkClass}>
            Clear filters
          </Link>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <Empty className="border" data-testid="results-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <InboxIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>{filtered ? "No attempts match these filters" : "No attempts yet"}</EmptyTitle>
            <EmptyDescription>
              {filtered ? "Change or clear the filters." : "Exams appear here as soon as a student starts one."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table data-testid="results-table" className="min-w-[52rem]">
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead>Batch</TableHead>
              <TableHead>Curriculum and exam set</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead className="text-right">Score</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className="align-top" data-testid="attempt-row">
                <TableCell>
                  {r.status === "in_progress" ? (
                    <span className="font-semibold">{r.studentName}</span>
                  ) : (
                    <Link href={`/staff/review/${r.id}`} className={linkClass}>
                      {r.studentName}
                      <span className="sr-only">, evaluation of {r.examSetName}</span>
                    </Link>
                  )}
                </TableCell>
                <TableCell>{r.batch ?? "–"}</TableCell>
                <TableCell>
                  <span className="block">{r.curriculumName}</span>
                  <span className="block text-muted-foreground">{r.examSetName}</span>
                </TableCell>
                <TableCell>
                  {r.status === "in_progress" ? (
                    <span className="text-muted-foreground">Started {formatDateTime(r.startedAt)}</span>
                  ) : (
                    formatDateTime(r.submittedAt)
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <ResultScore points={r.points} maxPoints={r.maxPoints} passed={r.passed} outcome={false} />
                </TableCell>
                <TableCell>
                  <AttemptStatusBadge attempt={r} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {rows.length} attempt{rows.length === 1 ? "" : "s"}
        {filtered ? " match" : ""}
      </p>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div role="status" aria-label="Loading attempts" className="flex flex-col gap-2">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

export default function AttemptsPage(props: PageProps<"/staff/review">) {
  return (
    <main className={staffMain}>
      <PageHeader
        title="Attempts"
        description="Every exam, read only. Scores are calculated when an exam is submitted or its time runs out, shown to the student at once and cannot be changed. Open one to see the evaluation."
      />
      <Suspense fallback={<ListSkeleton />}>
        <AttemptList searchParams={props.searchParams as Promise<Record<string, string | string[] | undefined>>} />
      </Suspense>
    </main>
  );
}
