import { Suspense } from "react";
import type { Metadata } from "next";
import { StudentHeader } from "@/components/app/student-header";
import { studentMain } from "@/components/app/styles";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { requireRole } from "@/lib/auth/require-role";
import { logout } from "@/app/login/actions";
import { acceptConsent } from "./actions";

export const metadata: Metadata = { title: "Consent | TalentTrack" };

async function ConsentContent() {
  const profile = await requireRole("student");
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-[1.75rem] font-semibold">Before you start</h1>
        <p className="text-base text-muted-foreground">
          Hello {profile.full_name ?? profile.username}. Please read and accept to continue.
        </p>
      </div>
      <div className="flex max-w-[62ch] flex-col gap-4 text-[1.0625rem] leading-relaxed">
        <p>
          TalentTrack stores your exam answers and results so that your instructors can assess your progress. Your
          answers are timed and saved automatically while you work.
        </p>
        <p>
          Only your instructors can see your results, and only after they release them. Your consent is recorded with
          the date and time.
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <form action={acceptConsent}>
          <Button type="submit" size="lg" className="w-full sm:w-auto">
            I agree and continue
          </Button>
        </form>
        <form action={logout}>
          <Button type="submit" size="lg" variant="outline" className="w-full sm:w-auto">
            Sign out
          </Button>
        </form>
      </div>
    </div>
  );
}

function ConsentSkeleton() {
  return (
    <div role="status" aria-label="Loading consent" className="flex flex-col gap-4">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-11 w-48" />
    </div>
  );
}

export default function ConsentPage() {
  return (
    <>
      <StudentHeader />
      <main className={studentMain}>
        <Suspense fallback={<ConsentSkeleton />}>
          <ConsentContent />
        </Suspense>
      </main>
    </>
  );
}
