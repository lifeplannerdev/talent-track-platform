import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { BookOpenIcon } from "lucide-react";
import { requireAdmin } from "@/lib/auth/require-role";
import { listContent, type BookStatus } from "@/lib/book/read";
import { PageHeader } from "@/components/app/page-header";
import { staffMain } from "@/components/app/styles";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Content | Talent Track Platform" };

const STATUS: Record<BookStatus, { label: string; variant: "outline" | "warning" | "success" }> = {
  none: { label: "No book", variant: "outline" },
  draft: { label: "Draft", variant: "warning" },
  published: { label: "Published", variant: "success" },
};

async function ContentList() {
  // Admin only: a trainer or student is redirected before anything is read.
  await requireAdmin();
  const rows = await listContent();

  if (rows.length === 0) {
    return (
      <Empty className="border" data-testid="content-empty">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BookOpenIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>No curriculums yet</EmptyTitle>
          <EmptyDescription>Create a curriculum first. Each curriculum can have one book.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((r) => {
        const s = STATUS[r.status];
        return (
          <li key={r.curriculumId}>
            <Card size="sm" data-testid="content-card" className="relative h-full transition-shadow focus-within:ring-2 focus-within:ring-ring hover:ring-primary/40">
              <CardHeader>
                <CardTitle className="min-w-0">
                  <Link
                    href={`/staff/content/${r.curriculumId}`}
                    className="outline-none after:absolute after:inset-0 after:content-['']"
                  >
                    {r.name}
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-muted-foreground">
                <Badge variant={s.variant}>{s.label}</Badge>
                <span>
                  {r.status === "none"
                    ? "Upload a PDF to start"
                    : `${r.pageCount} ${r.pageCount === 1 ? "page" : "pages"}, ${r.chapterCount} ${r.chapterCount === 1 ? "chapter" : "chapters"}`}
                </span>
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

export default function ContentPage() {
  return (
    <main className={staffMain}>
      <PageHeader
        title="Content"
        description="One book per curriculum. Upload a PDF, mark where each chapter starts, then publish it for students."
      />
      <Suspense
        fallback={
          <div role="status" aria-label="Loading content" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        }
      >
        <ContentList />
      </Suspense>
    </main>
  );
}
