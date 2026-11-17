import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardListIcon } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { formatDateTime } from "@/lib/format";
import { listResults } from "@/lib/review";
import { PageHeader } from "@/components/app/page-header";
import { ReleaseStatus, ResultScore } from "@/components/app/result-score";
import { linkClass, staffMain } from "@/components/app/styles";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Results | TalentTrack" };

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

async function ResultList({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole("staff");
  const sp = await searchParams;
  const filters = { batch: first(sp.batch), curriculumId: first(sp.curriculum), status: first(sp.status) };
  const { rows, batches, curriculums } = await listResults(filters);
  const filtered = Boolean(filters.batch || filters.curriculumId || filters.status);

  return (
    <div className="flex flex-col gap-4">
      <form method="get" role="search" aria-label="Filter results" className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
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
          <NativeSelect id="status" name="status" defaultValue={filters.status}>
            <NativeSelectOption value="">Released and awaiting release</NativeSelectOption>
            <NativeSelectOption value="released">Released</NativeSelectOption>
            <NativeSelectOption value="submitted">Awaiting release</NativeSelectOption>
          </NativeSelect>
        </div>
        <Button type="submit" variant="outline">
          Filter
        </Button>
        {filtered ? (
          <Link href="/staff/results" className={linkClass}>
            Clear filters
          </Link>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <Empty className="border" data-testid="results-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ClipboardListIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>{filtered ? "No results match these filters" : "No results yet"}</EmptyTitle>
            <EmptyDescription>
              {filtered ? "Change or clear the filters." : "Submitted exams appear here, held and released."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table data-testid="results-table" className="min-w-[48rem]">
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead>Batch</TableHead>
              <TableHead>Curriculum and exam</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Score</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className="align-top">
                <TableCell>
                  <Link href={`/staff/review/${r.id}`} className={linkClass}>
                    {r.studentName}
                  </Link>
                </TableCell>
                <TableCell>{r.batch ?? "–"}</TableCell>
                <TableCell>
                  <span className="block">{r.curriculumName}</span>
                  <span className="block text-muted-foreground">{r.examSetName}</span>
                </TableCell>
                <TableCell>{formatDateTime(r.submittedAt)}</TableCell>
                <TableCell>
                  <ReleaseStatus status={r.status} />
                </TableCell>
                <TableCell className="text-right">
                  <ResultScore points={r.points} maxPoints={r.maxPoints} passed={r.passed} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {rows.length} result{rows.length === 1 ? "" : "s"}
        {filtered ? " match" : ""}
      </p>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div role="status" aria-label="Loading results" className="flex flex-col gap-2">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

export default function ResultsPage(props: PageProps<"/staff/results">) {
  return (
    <main className={staffMain}>
      <PageHeader
        title="Results"
        description="Every submitted exam, released or awaiting release. Open one to see the evaluation."
      />
      <Suspense fallback={<ListSkeleton />}>
        <ResultList searchParams={props.searchParams as Promise<Record<string, string | string[] | undefined>>} />
      </Suspense>
    </main>
  );
}
