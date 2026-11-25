"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import type { ReaderPage } from "./book-reader";

// The flip library is a DOM library: loaded only in the browser, with a calm skeleton meanwhile.
const BookReader = dynamic(() => import("./book-reader").then((m) => m.BookReader), {
  ssr: false,
  loading: () => (
    <div
      data-testid="reader-skeleton"
      role="status"
      aria-label="Loading the reader"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background p-6"
    >
      <Skeleton className="h-[min(70vh,40rem)] w-[min(90vw,28rem)]" />
    </div>
  ),
});

export function ReaderLoader({
  curriculumId,
  chapterTitle,
  pages,
}: {
  curriculumId: string;
  chapterTitle: string;
  pages: ReaderPage[];
}) {
  const router = useRouter();
  return (
    <main id="main-content" tabIndex={-1} className="outline-none">
      <BookReader
        chapterTitle={chapterTitle}
        pages={pages}
        onClose={() => router.push(`/learn/${curriculumId}`)}
        onExpired={() => router.refresh()}
      />
    </main>
  );
}
