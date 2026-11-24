import { Suspense } from "react";
import type { Metadata } from "next";
import { UserPlusIcon, UsersIcon } from "lucide-react";
import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { listActiveTrainers, listStudents } from "@/lib/staff-manage";
import { PageHeader, SectionHeading } from "@/components/app/page-header";
import { staffMain } from "@/components/app/styles";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AddStudentForm } from "./add-student-form";
import { ImportStudents } from "./import-students";
import { linkClass, statusVariant, trackLabel } from "./ui";

export const metadata: Metadata = { title: "Students | Talent Track Platform" };
// Server actions on this page (the CSV import sends up to 200 invite mails) get this limit, not the platform default (Next: maxDuration goes on the page).
export const maxDuration = 300;

type Search = { q?: string; batch?: string; track?: string };

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

async function StudentList({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const profile = await requireRole("staff");
  const isAdmin = profile.role === "admin";
  const sp = await searchParams;
  const filters: Search = { q: first(sp.q), batch: first(sp.batch), track: first(sp.track) };
  const { rows, batches } = await listStudents(filters);
  const filtered = Boolean(filters.q || filters.batch || filters.track);

  return (
    <div className="flex flex-col gap-4">
      <form method="get" role="search" aria-label="Filter students" className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
        <div className="flex min-w-full flex-1 flex-col gap-1.5 sm:min-w-48">
          <Label htmlFor="q">Search</Label>
          <Input id="q" name="q" type="search" defaultValue={filters.q} placeholder="Name or username" />
        </div>
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
          <Label htmlFor="track">Track</Label>
          <NativeSelect id="track" name="track" defaultValue={filters.track}>
            <NativeSelectOption value="">All tracks</NativeSelectOption>
            <NativeSelectOption value="nursing">Nursing</NativeSelectOption>
            <NativeSelectOption value="other">Other</NativeSelectOption>
          </NativeSelect>
        </div>
        <Button type="submit" variant="outline">
          Filter
        </Button>
        {filtered ? (
          <Link href="/staff/students" className={linkClass}>
            Clear filters
          </Link>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <Empty className="border" data-testid="students-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>{filtered ? "No students match these filters" : "No students yet"}</EmptyTitle>
            <EmptyDescription>
              {filtered ? "Change the search or clear the filters." : "Add a student below or import a CSV file."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table data-testid="students-table" className="min-w-[44rem]">
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead>Batch</TableHead>
              <TableHead>Track</TableHead>
              {isAdmin ? <TableHead>Trainer</TableHead> : null}
              <TableHead>Curriculums</TableHead>
              <TableHead>
                <span className="sr-only">Details</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className="align-top">
                <TableCell>
                  <span className="block font-semibold">{r.fullName}</span>
                  <span className="block text-muted-foreground">{r.username}</span>
                </TableCell>
                <TableCell>{r.batch ?? "–"}</TableCell>
                <TableCell>{trackLabel(r.track)}</TableCell>
                {isAdmin ? <TableCell data-testid="student-trainer">{r.trainerName ?? "–"}</TableCell> : null}
                <TableCell className="whitespace-normal">
                  {r.assignments.length === 0 ? (
                    <span className="text-muted-foreground">None</span>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {r.assignments.map((a) => (
                        <li key={a.name} className="flex flex-wrap items-center gap-2">
                          <span>{a.name}</span>
                          <Badge variant={statusVariant(a.effectiveStatus)}>{a.effectiveStatus}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </TableCell>
                <TableCell>
                  <Link href={`/staff/students/${r.id}`} className={linkClass}>
                    Open<span className="sr-only"> {r.fullName}</span>
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {rows.length} student{rows.length === 1 ? "" : "s"}
        {filtered ? " match" : ""}
      </p>
    </div>
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

async function StaffForms() {
  const profile = await requireRole("staff");
  // Only an admin picks a trainer; a trainer's students always belong to that trainer.
  const trainers = profile.role === "admin" ? await listActiveTrainers() : null;
  return (
    <section aria-labelledby="add-heading" className="flex scroll-mt-20 flex-col gap-3">
      <SectionHeading id="add-heading">Add students</SectionHeading>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <AddStudentForm trainers={trainers} />
        <ImportStudents trainers={trainers} isTrainer={profile.role === "trainer"} />
      </div>
    </section>
  );
}

export default function StudentsPage(props: PageProps<"/staff/students">) {
  return (
    <main className={staffMain}>
      <PageHeader
        title="Students"
        description="Students sign in with their username and password. Nursing gets Pflege Ausbildung and Life in Germany; every other track gets Life in Germany."
        actions={
          <a href="#add-heading" className={buttonVariants({ variant: "outline" })}>
            <UserPlusIcon data-icon="inline-start" />
            Add or import
          </a>
        }
      />
      <Suspense fallback={<ListSkeleton />}>
        <StudentList searchParams={props.searchParams} />
      </Suspense>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <StaffForms />
      </Suspense>
    </main>
  );
}
