import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { getDashboard } from "@/lib/staff-overview";
import { cn } from "cn";
import { PageHeader, SectionHeading } from "@/components/app/page-header";
import { linkClass, staffMain } from "@/components/app/styles";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Dashboard | TalentTrack" };

function Stat({ label, value, testId, tone }: { label: string; value: number; testId: string; tone?: "warn" }) {
  return (
    <div className="flex flex-col gap-0.5 bg-card px-4 py-3">
      <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
      <dd
        className={cn("font-heading text-2xl font-semibold tabular-nums", tone === "warn" && value > 0 && "text-destructive")}
        data-testid={testId}
      >
        {value}
      </dd>
    </div>
  );
}

async function DashboardContent() {
  const profile = await requireRole("staff");
  const d = await getDashboard();

  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm text-muted-foreground">Signed in as {profile.full_name ?? profile.username}.</p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription>Awaiting review</CardDescription>
            <CardTitle className="font-heading text-3xl tabular-nums" data-testid="awaiting-review">
              {d.awaitingReview}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {d.awaitingReview === 0
              ? "No submitted exams are waiting for release."
              : "Submitted exams with held results wait for you to check and release them."}
          </CardContent>
          <CardFooter>
            <Link
              href="/staff/review"
              className={buttonVariants({ variant: d.awaitingReview > 0 ? "default" : "outline" })}
            >
              Review and release results
            </Link>
          </CardFooter>
        </Card>

        <Card data-testid="blocked-card">
          <CardHeader>
            <CardDescription>Blocked students</CardDescription>
            <CardTitle
              className={cn("font-heading text-3xl tabular-nums", d.blockedTotal > 0 && "text-destructive")}
              data-testid="blocked-total"
            >
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
                    className="flex flex-wrap items-baseline justify-between gap-x-3 py-2 first:pt-0"
                    data-testid="blocked-preview-row"
                  >
                    <span className="min-w-0">
                      <span className="block font-semibold">{b.studentName}</span>
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

      <section aria-labelledby="students-heading" className="flex flex-col gap-3">
        <SectionHeading id="students-heading">Students</SectionHeading>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border md:grid-cols-4">
          <Stat label="All students" value={d.studentTotal} testId="count-total" />
          <Stat label="Open" value={d.byStatus.open} testId="count-open" />
          <Stat label="Passed" value={d.byStatus.passed} testId="count-passed" />
          <Stat label="Blocked" value={d.byStatus.blocked} testId="count-blocked" tone="warn" />
        </dl>
        <p className="text-xs text-muted-foreground">
          A student is counted under each status they have in at least one curriculum.
        </p>
      </section>

      <p className="text-sm">
        Students only get an exam attempt when you give one.{" "}
        <Link href="/staff/grants" className={linkClass}>
          Give attempts
        </Link>
      </p>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div role="status" aria-label="Loading dashboard" className="flex flex-col gap-8">
      <Skeleton className="h-4 w-48" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-52" />
        <Skeleton className="h-52" />
      </div>
      <Skeleton className="h-20 w-full" />
    </div>
  );
}

export default function StaffDashboardPage() {
  return (
    <main className={staffMain}>
      <PageHeader title="Dashboard" />
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent />
      </Suspense>
    </main>
  );
}
