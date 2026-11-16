import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { getDashboard } from "@/lib/staff-overview";
import { logout } from "@/app/login/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StaffNav } from "./staff-nav";

export const metadata: Metadata = { title: "Dashboard | TalentTrack" };

const linkClass =
  "font-medium underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function Stat({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <div className="rounded-lg border p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

async function DashboardContent() {
  const profile = await requireRole("staff");
  const d = await getDashboard();

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">Signed in as {profile.full_name ?? profile.username}.</p>

      <section aria-labelledby="students-heading" className="flex flex-col gap-3">
        <h2 id="students-heading" className="text-lg font-medium">
          Students
        </h2>
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="All students" value={d.studentTotal} testId="count-total" />
          <Stat label="Open" value={d.byStatus.open} testId="count-open" />
          <Stat label="Passed" value={d.byStatus.passed} testId="count-passed" />
          <Stat label="Blocked" value={d.byStatus.blocked} testId="count-blocked" />
        </dl>
        <p className="text-xs text-muted-foreground">
          A student is counted under each status they have in at least one curriculum.
        </p>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription>Awaiting review</CardDescription>
            <CardTitle className="text-2xl tabular-nums" data-testid="awaiting-review">
              {d.awaitingReview}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {d.awaitingReview === 0
              ? "No submitted exams are waiting for release."
              : "Submitted exams with held results wait for you to check and release them."}
          </CardContent>
          <CardFooter>
            <Link href="/staff/review" className={buttonVariants({ variant: "outline" })}>
              Review and release results
            </Link>
          </CardFooter>
        </Card>

        <Card data-testid="blocked-card">
          <CardHeader>
            <CardDescription>Blocked students</CardDescription>
            <CardTitle className="text-2xl tabular-nums" data-testid="blocked-total">
              {d.blockedTotal}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {d.blockedPreview.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="blocked-empty">
                No student is blocked. Students are blocked when they fail their last allowed attempt.
              </p>
            ) : (
              <ul className="flex flex-col divide-y text-sm">
                {d.blockedPreview.map((b) => (
                  <li
                    key={`${b.studentId}:${b.curriculumId}`}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 py-2"
                    data-testid="blocked-preview-row"
                  >
                    <span className="min-w-0">
                      <span className="block font-medium">{b.studentName}</span>
                      <span className="block text-muted-foreground">{b.curriculumName}</span>
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {b.lastPoints === null ? "No score" : `Last score ${b.lastPoints} / ${b.lastMaxPoints}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
          <CardFooter>
            <Link href="/staff/blocked" className={buttonVariants({ variant: "outline" })}>
              View blocked students
            </Link>
          </CardFooter>
        </Card>
      </div>

      <p className="text-sm">
        Students only get an exam attempt when you give one.{" "}
        <Link href="/staff/grants" className={linkClass}>
          Give attempts
        </Link>
      </p>

      <form action={logout}>
        <Button type="submit" variant="outline">
          Sign out
        </Button>
      </form>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div role="status" aria-label="Loading dashboard" className="flex flex-col gap-4">
      <Skeleton className="h-4 w-48" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    </div>
  );
}

export default function StaffDashboardPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-10">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <StaffNav current="/staff" />
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent />
      </Suspense>
    </main>
  );
}
