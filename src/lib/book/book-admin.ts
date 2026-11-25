import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ChapterInput } from "@/lib/book/chapters";

// Service-role wrappers around the three atomic book functions (migration 0028) and the friendly
// messages for their error codes. Callers pass the admin id from requireAdmin(), never a client id.

export type BookFnResult = { ok: true } | { ok: false; message: string };

const GENERIC = "The book could not be saved. Please try again.";

const MESSAGES: Record<string, string> = {
  not_admin: "Only an admin can change a book.",
  book_published: "Unpublish the book before replacing the PDF.",
  no_pages: "The upload has no pages. Choose the PDF again.",
  too_many_pages: "The PDF has more than 400 pages. Split it and try again.",
  invalid_pages: "The uploaded pages are not valid. Choose the PDF again.",
  invalid_status: "That book status is not valid.",
  no_book: "This curriculum has no book yet. Upload a PDF first.",
  no_curriculum: "This curriculum no longer exists.",
  invalid_chapters: "The chapters are not valid. Check the titles and start pages.",
  no_chapters: "A published book needs a chapter that starts on page 1.",
};

export function bookErrorMessage(code: string | undefined): string {
  if (code && MESSAGES[code]) return MESSAGES[code];
  console.error("book function failed", code ?? "unknown");
  return GENERIC;
}

// PostgREST puts the raised message in `message` (code is the SQLSTATE, P0001).
function codeOf(error: { message?: string }): string | undefined {
  const m = (error.message ?? "").trim();
  return /^[a-z_]+$/.test(m) ? m : undefined;
}

export type UploadedPage = { page: number; width: number; height: number; path: string; thumb: string };

export async function finalizeBookUpload(adminId: string, curriculumId: string, uploadId: string, pages: UploadedPage[]): Promise<BookFnResult> {
  const { error } = await createAdminClient().rpc("finalize_book_upload", {
    p_admin: adminId,
    p_curriculum: curriculumId,
    p_upload: uploadId,
    p_pages: pages,
  });
  return error ? { ok: false, message: bookErrorMessage(codeOf(error)) } : { ok: true };
}

export async function saveChaptersFn(adminId: string, curriculumId: string, chapters: ChapterInput[]): Promise<BookFnResult> {
  const payload = chapters.map((c) => ({ ...(c.id ? { id: c.id } : {}), title: c.title, start_page: c.startPage }));
  const { error } = await createAdminClient().rpc("save_chapters", {
    p_admin: adminId,
    p_curriculum: curriculumId,
    p_chapters: payload,
  });
  return error ? { ok: false, message: bookErrorMessage(codeOf(error)) } : { ok: true };
}

export async function setBookStatusFn(adminId: string, curriculumId: string, status: "draft" | "published"): Promise<BookFnResult> {
  const { error } = await createAdminClient().rpc("set_book_status", {
    p_admin: adminId,
    p_curriculum: curriculumId,
    p_status: status,
  });
  return error ? { ok: false, message: bookErrorMessage(codeOf(error)) } : { ok: true };
}
