import { Suspense } from "react";
import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/require-role";
import { logout } from "@/app/login/actions";
import { acceptConsent } from "./actions";

export const metadata: Metadata = { title: "Consent | TalentTrack" };

async function ConsentCard() {
  const profile = await requireRole("student");
  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle className="text-xl">Before you start</CardTitle>
        <CardDescription>
          Hello {profile.full_name ?? profile.username}. Please read and accept to continue.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p>
          TalentTrack stores your exam answers and results so that your instructors can assess
          your progress. Your answers are timed and saved automatically while you work.
        </p>
        <p>
          Only your instructors can see your results, and only after they release them. Your
          consent is recorded with the date and time.
        </p>
      </CardContent>
      <CardFooter className="flex flex-col gap-2">
        <form action={acceptConsent} className="w-full">
          <Button type="submit" className="h-9 w-full">
            I agree and continue
          </Button>
        </form>
        <form action={logout} className="w-full">
          <Button type="submit" variant="outline" className="h-9 w-full">
            Sign out
          </Button>
        </form>
      </CardFooter>
    </Card>
  );
}

export default function ConsentPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <Suspense fallback={<p role="status">Loading…</p>}>
        <ConsentCard />
      </Suspense>
    </main>
  );
}
