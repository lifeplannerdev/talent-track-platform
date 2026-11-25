import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/attempts";
import { chapterRanges, type ChapterRange } from "@/lib/book/chapters";
import { signReadUrls } from "@/lib/book/storage";

// Student side of the curriculum book. Callers pass the session user id (requireRole('student')),
// never a client id. The service role is used only after the checks: the student has an assignment
// for the curriculum, the book is published and the chapter is an ACTIVE chapter of that book.
// Archived chapters are invisible; ranges come from the active chapters only. No gating in 2A:
// an assigned student reads any active chapter (unlocking arrives with slice 2B).

const URL_TTL_SECONDS = 300;

export type LearningPath = {
  curriculumId: string;
  name: string;
  chapters: { id: string; title: string; startPage: number; endPage: number; pageCount: number }[];
};

export type ChapterReading =
  | {
      ok: true;
      curriculumName: string;
      chapterTitle: string;
      chapterIndex: number;
      chapterCount: number;
      pages: { page: number; url: string; thumbUrl: string; width: number; height: number }[];
      prev: { chapterId: string } | null;
      next: { chapterId: string } | null;
    }
  | { ok: false; reason: "not_found" };

const NOT_FOUND = { ok: false, reason: "not_found" } as const;

type ActiveChapter = { id: string; title: string; start_page: number };

function rangesOf(chapters: ActiveChapter[], pageCount: number): (ChapterRange & { id: string })[] {
  return chapterRanges(
    chapters.map((c) => ({ id: c.id, title: c.title, startPage: c.start_page })),
    pageCount,
  ) as (ChapterRange & { id: string })[];
}

/** The student's assigned curriculums whose book is published and has chapters, by assignment position. */
export async function listLearningPaths(studentId: string): Promise<LearningPath[]> {
  if (!isUuid(studentId)) return [];
  const admin = createAdminClient();
  const { data: assigned, error } = await admin
    .from("assignments")
    .select("curriculum_id, position, curriculums(name)")
    .eq("student_id", studentId)
    .order("position");
  if (error) throw new Error(`Could not read assignments: ${error.code}`);
  const ids = (assigned ?? []).map((a) => a.curriculum_id as string);
  if (ids.length === 0) return [];
  const { data: books, error: bookError } = await admin
    .from("books")
    .select("curriculum_id, status, page_count")
    .in("curriculum_id", ids);
  if (bookError) throw new Error(`Could not read books: ${bookError.code}`);
  const bookOf = new Map((books ?? []).map((b) => [b.curriculum_id as string, b]));
  return buildPaths(
    (assigned ?? []).map((a) => ({
      curriculumId: a.curriculum_id as string,
      name: (a.curriculums as unknown as { name: string } | null)?.name ?? "",
      pageCount: bookOf.get(a.curriculum_id as string)?.page_count ?? 0,
      status: bookOf.get(a.curriculum_id as string)?.status ?? "",
    })),
  );
}

async function buildPaths(
  rows: { curriculumId: string; name: string; pageCount: number; status: string }[],
): Promise<LearningPath[]> {
  const published = rows.filter((r) => r.status === "published");
  if (published.length === 0) return [];
  const { data, error } = await createAdminClient()
    .from("chapters")
    .select("id, curriculum_id, title, start_page")
    .in("curriculum_id", published.map((r) => r.curriculumId))
    .is("archived_at", null)
    .order("start_page");
  if (error) throw new Error(`Could not read chapters: ${error.code}`);
  const byCurriculum = new Map<string, ActiveChapter[]>();
  for (const c of data ?? []) {
    const list = byCurriculum.get(c.curriculum_id as string) ?? [];
    list.push({ id: c.id, title: c.title, start_page: c.start_page as number });
    byCurriculum.set(c.curriculum_id as string, list);
  }
  const out: LearningPath[] = [];
  for (const r of published) {
    const chapters = byCurriculum.get(r.curriculumId) ?? [];
    if (chapters.length === 0) continue;
    out.push({
      curriculumId: r.curriculumId,
      name: r.name,
      chapters: rangesOf(chapters, r.pageCount).map((c) => ({
        id: c.id,
        title: c.title,
        startPage: c.startPage,
        endPage: c.endPage,
        pageCount: c.pageCount,
      })),
    });
  }
  return out;
}

/**
 * One chapter's pages with short-lived signed urls. Every refusal is the same { ok: false,
 * reason: 'not_found' } so nothing about existence leaks. `options.ttlSeconds` is a test seam.
 */
export async function getChapterForReading(
  studentId: string,
  curriculumId: string,
  chapterId: string,
  options: { ttlSeconds?: number } = {},
): Promise<ChapterReading> {
  if (!isUuid(studentId) || !isUuid(curriculumId) || !isUuid(chapterId)) return NOT_FOUND;
  const admin = createAdminClient();

  const [assignment, book, chapters] = await Promise.all([
    admin.from("assignments").select("curriculum_id, curriculums(name)").eq("student_id", studentId).eq("curriculum_id", curriculumId).maybeSingle(),
    admin.from("books").select("status, page_count").eq("curriculum_id", curriculumId).maybeSingle(),
    admin.from("chapters").select("id, title, start_page").eq("curriculum_id", curriculumId).is("archived_at", null).order("start_page"),
  ]);
  if (assignment.error) throw new Error(`Could not read the assignment: ${assignment.error.code}`);
  if (book.error) throw new Error(`Could not read the book: ${book.error.code}`);
  if (chapters.error) throw new Error(`Could not read chapters: ${chapters.error.code}`);
  if (!assignment.data || !book.data || book.data.status !== "published") return NOT_FOUND;

  const active = (chapters.data ?? []).map((c) => ({ id: c.id, title: c.title, start_page: c.start_page as number }));
  const ranges = rangesOf(active, book.data.page_count);
  const index = ranges.findIndex((r) => r.id === chapterId);
  if (index < 0) return NOT_FOUND;
  const range = ranges[index];

  const { data: pages, error: pagesError } = await admin
    .from("book_pages")
    .select("page_number, path, thumb_path, width, height")
    .eq("curriculum_id", curriculumId)
    .gte("page_number", range.startPage)
    .lte("page_number", range.endPage)
    .order("page_number");
  if (pagesError) throw new Error(`Could not read pages: ${pagesError.code}`);

  const ttl = options.ttlSeconds ?? URL_TTL_SECONDS;
  const urls = await signReadUrls((pages ?? []).flatMap((p) => [p.path as string, p.thumb_path as string]), ttl);
  const signed = [];
  for (const p of pages ?? []) {
    const url = urls.get(p.path as string);
    const thumbUrl = urls.get(p.thumb_path as string);
    if (!url || !thumbUrl) return NOT_FOUND; // a missing file is not a readable chapter
    signed.push({ page: p.page_number as number, url, thumbUrl, width: p.width as number, height: p.height as number });
  }

  return {
    ok: true,
    curriculumName: (assignment.data.curriculums as unknown as { name: string } | null)?.name ?? "",
    chapterTitle: range.title,
    chapterIndex: index,
    chapterCount: ranges.length,
    pages: signed,
    prev: index > 0 ? { chapterId: ranges[index - 1].id } : null,
    next: index < ranges.length - 1 ? { chapterId: ranges[index + 1].id } : null,
  };
}
