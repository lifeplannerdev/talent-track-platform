import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { getStudentDetail } from "@/lib/staff-manage";
import { ChevronLeftIcon, ClipboardListIcon, LibraryIcon } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { ReleaseStatus, ResultScore } from "@/components/app/result-score";
import { PageHeader, SectionHeading } from "@/components/app/page-header";
import { staffMain } from "@/components/app/styles";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GrantButton } from "../../grants/grant-button";
import { GrantStatusProvider } from "../../grants/grant-status";
import { linkClass, statusVariant, trackLabel } from "../ui";
import { AddCurriculumForm, MoveButtons, RemoveCurriculumButton } from "./assignment-controls";
import { DeleteStudentForm } from "./delete-student-form";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Student | TalentTrack" };

async function StudentDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("staff");
  const { id } = await params;
  const s = await getStudentDetail(id);
  if (!s) notFound();
  const order = s.assignments.map((a) => a.curriculumId);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-2xl font-semibold" data-testid="student-name">
              {s.fullName}
            </h2>
          </CardTitle>
          <CardDescription>Username {s.username}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Batch</dt>
              <dd>{s.batch ?? "–"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Track</dt>
              <dd data-testid="student-track">{trackLabel(s.track)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Curriculums</dt>
              <dd>{s.assignments.length}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <section aria-labelledby="curriculums-heading" className="flex flex-col gap-3">
        <SectionHeading id="curriculums-heading">Curriculums</SectionHeading>
        <p className="text-sm text-muted-foreground">
          The student takes curriculums in this order: the first open one is next. Removing a curriculum keeps the
          student&apos;s attempts and results.
        </p>
        <GrantStatusProvider>
          {s.assignments.length === 0 ? (
            <Empty className="border" data-testid="assignments-empty">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <LibraryIcon aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>No curriculums assigned</EmptyTitle>
                <EmptyDescription>Add one below so the student can be given exams.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table data-testid="assignments-table" className="min-w-[46rem]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Order</TableHead>
                  <TableHead>Curriculum</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Attempts</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.assignments.map((a, i) => (
                  <TableRow key={a.curriculumId} className="align-top" data-testid="assignment-row">
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="w-4 tabular-nums">{i + 1}</span>
                        <MoveButtons studentId={s.id} order={order} index={i} name={a.name} />
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <span className="block font-semibold">{a.name}</span>
                      <span className="block text-muted-foreground">
                        {a.examSets.length === 0 ? "No exam sets yet" : a.examSets.map((e) => e.name).join(", ")}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(a.status)} data-testid="assignment-status">
                        {a.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{a.attemptsUsed}</TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-2">
                        {a.status !== "passed"
                          ? a.examSets.map((e) => (
                              <GrantButton
                                key={e.id}
                                studentId={s.id}
                                examSetId={e.id}
                                studentName={s.fullName}
                                examSetName={e.name}
                                label={a.examSets.length === 1 ? "Give attempt" : `Give attempt: ${e.name}`}
                                note={a.status === "blocked" ? "This lifts the block." : undefined}
                              />
                            ))
                          : null}
                        <RemoveCurriculumButton
                          studentId={s.id}
                          studentName={s.fullName}
                          curriculumId={a.curriculumId}
                          curriculumName={a.name}
                          attempts={a.attemptsTotal}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </GrantStatusProvider>
        <AddCurriculumForm studentId={s.id} options={s.unassigned} />
      </section>

      <section aria-labelledby="results-heading" className="flex flex-col gap-3">
        <SectionHeading id="results-heading">Results</SectionHeading>
        {s.results.length === 0 ? (
          <Empty className="border" data-testid="student-results-empty">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ClipboardListIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No results yet</EmptyTitle>
              <EmptyDescription>Submitted exams of this student appear here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table data-testid="student-results-table" className="min-w-[40rem]">
            <TableHeader>
              <TableRow>
                <TableHead>Curriculum and exam</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead>
                  <span className="sr-only">Evaluation</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {s.results.map((r) => (
                <TableRow key={r.id} className="align-top">
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
                  <TableCell>
                    <Link href={`/staff/review/${r.id}`} className={linkClass}>
                      Open<span className="sr-only"> evaluation of {r.examSetName}</span>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <ResetPasswordForm studentId={s.id} studentName={s.fullName} />
      <DeleteStudentForm studentId={s.id} studentName={s.fullName} username={s.username} />
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div role="status" aria-label="Loading student" className="flex flex-col gap-4">
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

export default function StudentPage(props: PageProps<"/staff/students/[id]">) {
  return (
    <main className={staffMain}>
      <div className="flex flex-col gap-2">
        <Link href="/staff/students" className={`${linkClass} inline-flex w-fit items-center gap-1 text-sm`}>
          <ChevronLeftIcon aria-hidden="true" className="size-4" />
          All students
        </Link>
        <PageHeader title="Student" />
      </div>
      <Suspense fallback={<DetailSkeleton />}>
        <StudentDetail params={props.params} />
      </Suspense>
    </main>
  );
}
