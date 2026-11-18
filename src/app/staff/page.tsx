import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { greeting } from "@/lib/greeting";
import { formatPercent } from "@/lib/percent";
import { getDashboard } from "@/lib/staff-overview";
import { cn } from "cn";
import { PageHeader, SectionHeading } from "@/components/app/page-header";
import { staffMain } from "@/components/app/styles";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Dashboard | TalentTrack" };

const bigNumber = "font-heading text-[2rem] leading-none font-semibold tabular-nums";

function Stat({ label, value, testId, tone }: { label: string; value: number; testId: string; tone?: "warn" }) {
  return (
    <div className="flex flex-col gap-1 bg-card px-4 py-3">
      <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
      <dd
        className={cn("font-heading text-2xl leading-none font-semibold tabular-nums", tone === "warn" && value > 0 && "text-destructive")}
        data-testid={testId}
      >
        {value}
      </dd>
    </div>
  );
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** One orientation sentence from the counts on this page. */
function todaySummary(awaiting: number, blocked: number): string {
  if (awaiting === 0 && blocked === 0) return "Nothing is waiting for you right now.";
  const parts: string[] = [];
  if (awaiting > 0) parts.push(`${plural(awaiting, "result is", "results are")} waiting for release`);
  if (blocked > 0) parts.push(`${plural(blocked, "student is", "students are")} blocked`);
  return `${parts.join(" and ")}.`;
}

async function DashboardContent() {
  const profile = await requireRole("staff");
  const d = await getDashboard();
  const hello = greeting({ fullName: profile.full_name, username: profile.username }, new Date());

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={
          <>
            <span className="font-semibold text-foreground" data-testid="greeting">
              {hello}.
            </span>{" "}
            {todaySummary(d.awaitingReview, d.blockedTotal)}
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Awaiting review</CardDescription>
            <CardTitle className={bigNumber} data-testid="awaiting-review">
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
            <CardTitle className={cn(bigNumber, d.blockedTotal > 0 && "text-destructive")} data-testid="blocked-total">
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
                    className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5 first:pt-0"
                    data-testid="blocked-preview-row"
                  >
                    <span className="min-w-0">
                      <span className="block font-semibold">{b.studentName}</span>
                      <span className="block text-muted-foreground">{b.curriculumName}</span>
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {b.lastPoints === null || b.lastMaxPoints === null ? (
                        "No score"
                      ) : (
                        <>
                          Last score{" "}
                          <span className="font-semibold text-foreground">{formatPercent(b.lastPoints, b.lastMaxPoints)}</span>{" "}
                          ({b.lastPoints} / {b.lastMaxPoints})
                        </>
                      )}
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

        <Card className="md:col-span-2 xl:col-span-1">
          <CardHeader>
            <CardTitle>Give attempts</CardTitle>
            <CardDescription>
              Students only get an exam attempt when you give one: a first attempt, a retake or after a block.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Link href="/staff/grants" className={buttonVariants({ variant: "outline" })}>
              Give attempts
            </Link>
          </CardFooter>
        </Card>
      </div>

      <section aria-labelledby="students-heading" className="flex flex-col gap-2">
        <SectionHeading
          id="students-heading"
          aside={
            <p className="text-xs text-muted-foreground">Counted under each status they have in at least one curriculum.</p>
          }
        >
          Students
        </SectionHeading>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
          <Stat label="All students" value={d.studentTotal} testId="count-total" />
          <Stat label="Open" value={d.byStatus.open} testId="count-open" />
          <Stat label="Passed" value={d.byStatus.passed} testId="count-passed" />
          <Stat label="Blocked" value={d.byStatus.blocked} testId="count-blocked" tone="warn" />
        </dl>
      </section>
    </>
  );
}

function DashboardSkeleton() {
  return (
    <>
      <PageHeader title="Dashboard" description="Loading today's overview…" />
      <div role="status" aria-label="Loading dashboard" className="flex flex-col gap-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
          <Skeleton className="h-44 md:col-span-2 xl:col-span-1" />
        </div>
        <Skeleton className="h-20 w-full" />
      </div>
    </>
  );
}

export default function StaffDashboardPage() {
  return (
    <main className={staffMain}>
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent />
      </Suspense>
    </main>
  );
}
