import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireStudentWithConsent } from "@/lib/auth/require-role";
import { getChapterForReading } from "@/lib/book/pages-access";
import { ReaderLoader } from "@/components/reader/reader-loader";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Reading | Talent Track Platform" };

// Full-screen exception to the narrow student column (DESIGN.md, "Book reader"). The student is the
// session user; every refusal is the same not-found page with no page data.
async function Reader({ params }: { params: Promise<{ curriculumId: string; chapterId: string }> }) {
  const profile = await requireStudentWithConsent();
  const { curriculumId, chapterId } = await params;
  const reading = await getChapterForReading(profile.id, curriculumId, chapterId);
  if (!reading.ok) notFound();
  return <ReaderLoader curriculumId={curriculumId} chapterTitle={reading.chapterTitle} pages={reading.pages} />;
}

export default function ReaderPage(props: PageProps<"/learn/[curriculumId]/read/[chapterId]">) {
  return (
    <Suspense
      fallback={
        <main id="main-content" tabIndex={-1} role="status" aria-label="Loading the reader" className="flex flex-1 items-center justify-center p-6 outline-none">
          <Skeleton className="h-[min(70vh,40rem)] w-[min(90vw,28rem)]" />
        </main>
      }
    >
      <Reader params={props.params} />
    </Suspense>
  );
}
