import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { isUuid } from "@/lib/attempts";
import { requireAdmin } from "@/lib/auth/require-role";
import { getBookForEditor } from "@/lib/book/read";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { linkClass, staffMain } from "@/components/app/styles";
import { Skeleton } from "@/components/ui/skeleton";
import { BookUploader } from "./book-uploader";
import { ChaptersCard } from "./chapter-list";
import { PublishCard } from "./publish-card";

export const metadata: Metadata = { title: "Book | Talent Track Platform" };

async function Editor({ params }: { params: Promise<{ curriculumId: string }> }) {
  // Admin only: the readers below rely on this gate.
  await requireAdmin();
  const { curriculumId } = await params;
  if (!isUuid(curriculumId)) notFound();
  const supabase = await createClient();
  const { data: curriculum } = await supabase.from("curriculums").select("id, name").eq("id", curriculumId).maybeSingle();
  if (!curriculum) notFound();
  const book = await getBookForEditor(curriculumId);

  return (
    <>
      <PageHeader
        title={curriculum.name}
        description="Book and chapters. Students see a published book only."
        actions={
          <Link href="/staff/content" className={`${linkClass} inline-flex min-h-9 items-center gap-1.5 pointer-coarse:min-h-11`}>
            <ArrowLeftIcon className="size-4" aria-hidden="true" />
            All content
          </Link>
        }
      />
      <BookUploader
        curriculumId={curriculumId}
        book={book ? { status: book.status, pageCount: book.pageCount } : null}
      />
      {book ? (
        <>
          {/* A new upload remounts the editor; saved chapters are adopted by the card itself. */}
          <ChaptersCard
            key={book.uploadId ?? "book"}
            curriculumId={curriculumId}
            pageCount={book.pageCount}
            pages={book.pages}
            chapters={book.chapters}
          />
          <PublishCard
            curriculumId={curriculumId}
            status={book.status}
            hasFirstChapter={book.chapters.some((c) => c.startPage === 1)}
          />
        </>
      ) : null}
    </>
  );
}

export default function ContentEditorPage({ params }: { params: Promise<{ curriculumId: string }> }) {
  return (
    <main className={staffMain}>
      <Suspense
        fallback={
          <div role="status" aria-label="Loading book" className="flex flex-col gap-4">
            <Skeleton className="h-12 w-1/2" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-56 w-full" />
          </div>
        }
      >
        <Editor params={params} />
      </Suspense>
    </main>
  );
}
