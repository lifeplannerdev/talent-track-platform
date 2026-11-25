import "server-only";
import { createClient } from "@/lib/supabase/server";
import { signReadUrls } from "@/lib/book/storage";

// Staff readers (session client, RLS). Only ACTIVE chapters (archived_at is null) are counted or
// returned. Thumbnails are signed by the service role (an hour for the admin editor).

export type BookStatus = "none" | "draft" | "published";
export type ContentRow = { curriculumId: string; name: string; status: BookStatus; pageCount: number; chapterCount: number };
export type EditorBook = {
  status: "draft" | "published";
  pageCount: number;
  uploadId: string | null;
  chapters: { id: string; title: string; startPage: number }[];
  pages: { page: number; thumbUrl: string; width: number; height: number }[];
};

// Admin editor only: thumbnails load lazily and the editor stays open while the admin works, so sign
// them for an hour. Students get 300 s in their own reader code, unchanged.
const EDITOR_THUMB_TTL_SECONDS = 3600;

export async function listContent(): Promise<ContentRow[]> {
  const supabase = await createClient();
  const [curriculums, books, chapters] = await Promise.all([
    supabase.from("curriculums").select("id, name").order("name"),
    supabase.from("books").select("curriculum_id, status, page_count"),
    supabase.from("chapters").select("curriculum_id").is("archived_at", null),
  ]);
  if (curriculums.error) throw new Error(`Could not read curriculums: ${curriculums.error.code}`);
  if (books.error) throw new Error(`Could not read books: ${books.error.code}`);
  if (chapters.error) throw new Error(`Could not read chapters: ${chapters.error.code}`);

  const bookOf = new Map((books.data ?? []).map((b) => [b.curriculum_id as string, b]));
  const counts = new Map<string, number>();
  for (const c of chapters.data ?? []) counts.set(c.curriculum_id, (counts.get(c.curriculum_id) ?? 0) + 1);

  return (curriculums.data ?? []).map((c) => {
    const b = bookOf.get(c.id);
    return {
      curriculumId: c.id,
      name: c.name,
      status: b ? (b.status as "draft" | "published") : "none",
      pageCount: b?.page_count ?? 0,
      chapterCount: counts.get(c.id) ?? 0,
    };
  });
}

export async function getBookForEditor(curriculumId: string): Promise<EditorBook | null> {
  const supabase = await createClient();
  const { data: book, error } = await supabase
    .from("books")
    .select("status, page_count, upload_id")
    .eq("curriculum_id", curriculumId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the book: ${error.code}`);
  if (!book) return null;

  const [pages, chapters] = await Promise.all([
    supabase.from("book_pages").select("page_number, thumb_path, width, height").eq("curriculum_id", curriculumId).order("page_number"),
    supabase.from("chapters").select("id, title, start_page").eq("curriculum_id", curriculumId).is("archived_at", null).order("start_page"),
  ]);
  if (pages.error) throw new Error(`Could not read pages: ${pages.error.code}`);
  if (chapters.error) throw new Error(`Could not read chapters: ${chapters.error.code}`);

  const urls = await signReadUrls((pages.data ?? []).map((p) => p.thumb_path as string), EDITOR_THUMB_TTL_SECONDS);
  return {
    status: book.status as "draft" | "published",
    pageCount: book.page_count,
    uploadId: book.upload_id,
    chapters: (chapters.data ?? []).map((c) => ({ id: c.id, title: c.title, startPage: c.start_page as number })),
    pages: (pages.data ?? []).map((p) => ({
      page: p.page_number,
      thumbUrl: urls.get(p.thumb_path as string) ?? "",
      width: p.width,
      height: p.height,
    })),
  };
}
