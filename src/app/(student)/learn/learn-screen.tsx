import Link from "next/link";
import { cn } from "cn";
import { greeting } from "@/lib/greeting";
import { PageFade } from "@/components/app/page-fade";
import { StudentFooter, StudentHeader } from "@/components/app/student-header";
import { linkClass, studentMain } from "@/components/app/styles";
import { Skeleton } from "@/components/ui/skeleton";
import type { LearningPath } from "@/lib/book/pages-access";
import { LearningPathView } from "./learning-path";

/** The learning pages' frame: header with the Learn and Exams tabs, one narrow column, footer. */
export function LearnFrame({ children }: { children: React.ReactNode }) {
  return (
    <PageFade>
      <StudentHeader signOut nav />
      <main className={studentMain}>{children}</main>
      <StudentFooter />
    </PageFade>
  );
}

export function LearnSkeleton() {
  return (
    <div role="status" aria-label="Loading your learning" className="flex flex-col gap-5">
      <Skeleton className="h-8 w-64 max-w-full" />
      <Skeleton className="h-4 w-72 max-w-full" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
    </div>
  );
}

/** Greeting plus the pathway of each given curriculum. `backToAll` links to /learn from a single pathway. */
export function LearnContent({
  student,
  paths,
  backToAll = false,
}: {
  student: { full_name: string | null; username: string };
  paths: LearningPath[];
  backToAll?: boolean;
}) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-[1.625rem] leading-tight font-semibold sm:text-[1.875rem]" data-testid="greeting">
          {greeting({ fullName: student.full_name, username: student.username }, new Date())}
        </h1>
        <p className="text-base text-muted-foreground">Read each chapter in any order. Your exams are one tab away.</p>
        {backToAll ? (
          <Link href="/learn" className={cn(linkClass, "mt-1 w-fit pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center")}>
            All my learning
          </Link>
        ) : null}
      </div>
      <div className="flex flex-col gap-10">
        {paths.map((p) => (
          <LearningPathView key={p.curriculumId} path={p} />
        ))}
      </div>
    </>
  );
}
