import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireStudentWithConsent } from "@/lib/auth/require-role";
import { listLearningPaths } from "@/lib/book/pages-access";
import { LearnContent, LearnFrame, LearnSkeleton } from "./learn-screen";

export const metadata: Metadata = { title: "Learn | Talent Track Platform" };

// The student's home. The student is the session user. With nothing to learn (no published book with
// chapters in an assigned curriculum) the existing exam start page is the home.
async function Learn() {
  const profile = await requireStudentWithConsent();
  const paths = await listLearningPaths(profile.id);
  if (paths.length === 0) redirect("/exam/start");
  return <LearnContent student={profile} paths={paths} />;
}

export default function LearnPage() {
  return (
    <LearnFrame>
      <Suspense fallback={<LearnSkeleton />}>
        <Learn />
      </Suspense>
    </LearnFrame>
  );
}
