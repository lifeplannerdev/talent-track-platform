import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireStudentWithConsent } from "@/lib/auth/require-role";
import { listLearningPaths } from "@/lib/book/pages-access";
import { LearnContent, LearnFrame, LearnSkeleton } from "../learn-screen";

export const metadata: Metadata = { title: "Learn | Talent Track Platform" };

// One curriculum's pathway (the reader's Close target). A curriculum the student cannot see (not
// assigned, no published book, no chapters, or not even an id) goes back to /learn: same answer for
// every refusal, no data.
async function Focused({ params }: { params: Promise<{ curriculumId: string }> }) {
  const profile = await requireStudentWithConsent();
  const { curriculumId } = await params;
  const paths = await listLearningPaths(profile.id);
  const path = paths.find((p) => p.curriculumId === curriculumId);
  if (!path) redirect("/learn");
  return <LearnContent student={profile} paths={[path]} backToAll={paths.length > 1} />;
}

export default function LearnCurriculumPage(props: PageProps<"/learn/[curriculumId]">) {
  return (
    <LearnFrame>
      <Suspense fallback={<LearnSkeleton />}>
        <Focused params={props.params} />
      </Suspense>
    </LearnFrame>
  );
}
