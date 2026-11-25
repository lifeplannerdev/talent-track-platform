"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { isUuid } from "@/lib/attempts";
import { requireAdmin } from "@/lib/auth/require-role";
import { bookErrorMessage, finalizeBookUpload, saveChaptersFn, setBookStatusFn } from "@/lib/book/book-admin";
import { validateChapters, type ChapterInput } from "@/lib/book/chapters";
import { BOOK_MAX_PAGES } from "@/lib/book/limits";
import { createUploadUrl, listFolderFiles, listUploadFolders, removeBookFiles } from "@/lib/book/storage";
import { createAdminClient } from "@/lib/supabase/admin";

// Book authoring. Admin only: every action calls requireAdmin() first and passes that profile id
// to the atomic SQL functions (never an id from the client). Chapters are retired, never deleted,
// by save_chapters. Storage goes only through src/lib/book/storage.ts.

export type StartUploadResult = { ok: true; uploadId: string } | { ok: false; message: string };
export type MintedUrl = { page: number; imageUrl: string; thumbUrl: string; imagePath: string; thumbPath: string };
export type MintUrlsResult = { ok: true; urls: MintedUrl[] } | { ok: false; message: string };
export type ContentResult = { ok: true } | { ok: false; message: string };

const MAX_PAGES_PER_MINT = 25;
const BAD_REQUEST = "That request was not valid. Reload the page and try again.";
const PUBLISHED = "Unpublish the book before replacing the PDF.";

function revalidateContent(curriculumId: string) {
  revalidatePath("/staff/content");
  revalidatePath(`/staff/content/${curriculumId}`);
}

async function bookStatus(curriculumId: string): Promise<{ status: string; pageCount: number } | null> {
  const { data } = await createAdminClient()
    .from("books")
    .select("status, page_count")
    .eq("curriculum_id", curriculumId)
    .maybeSingle<{ status: string; page_count: number }>();
  return data ? { status: data.status, pageCount: data.page_count } : null;
}

export async function startBookUpload(curriculumId: string): Promise<StartUploadResult> {
  await requireAdmin();
  if (!isUuid(curriculumId)) return { ok: false, message: BAD_REQUEST };
  const { data: curriculum } = await createAdminClient().from("curriculums").select("id").eq("id", curriculumId).maybeSingle();
  if (!curriculum) return { ok: false, message: bookErrorMessage("no_curriculum") };
  if ((await bookStatus(curriculumId))?.status === "published") return { ok: false, message: PUBLISHED };
  return { ok: true, uploadId: randomUUID() };
}

export async function mintUploadUrls(input: { curriculumId: string; uploadId: string; pages: number[] }): Promise<MintUrlsResult> {
  await requireAdmin();
  const { curriculumId, uploadId, pages } = input ?? ({} as typeof input);
  if (!isUuid(curriculumId) || !isUuid(uploadId) || !Array.isArray(pages)) return { ok: false, message: BAD_REQUEST };
  if (pages.length === 0) return { ok: false, message: BAD_REQUEST };
  if (pages.length > MAX_PAGES_PER_MINT) return { ok: false, message: `Request at most ${MAX_PAGES_PER_MINT} pages at a time.` };
  if (pages.some((p) => !Number.isInteger(p) || p < 1 || p > BOOK_MAX_PAGES) || new Set(pages).size !== pages.length) {
    return { ok: false, message: `Page numbers must be whole numbers from 1 to ${BOOK_MAX_PAGES}.` };
  }
  if ((await bookStatus(curriculumId))?.status === "published") return { ok: false, message: PUBLISHED };

  const urls: MintedUrl[] = [];
  for (const page of pages) {
    const imagePath = `${curriculumId}/${uploadId}/${page}.webp`;
    const thumbPath = `${curriculumId}/${uploadId}/${page}.thumb.webp`;
    const [imageUrl, thumbUrl] = await Promise.all([createUploadUrl(imagePath), createUploadUrl(thumbPath)]);
    if (!imageUrl || !thumbUrl) return { ok: false, message: "Upload links could not be created. Please try again." };
    urls.push({ page, imageUrl, thumbUrl, imagePath, thumbPath });
  }
  return { ok: true, urls };
}

export async function finishBookUpload(input: {
  curriculumId: string;
  uploadId: string;
  pages: { page: number; width: number; height: number }[];
}): Promise<ContentResult> {
  const admin = await requireAdmin();
  const { curriculumId, uploadId, pages } = input ?? ({} as typeof input);
  if (!isUuid(curriculumId) || !isUuid(uploadId) || !Array.isArray(pages)) return { ok: false, message: BAD_REQUEST };
  if (pages.length === 0) return { ok: false, message: bookErrorMessage("no_pages") };
  if (pages.length > BOOK_MAX_PAGES) return { ok: false, message: bookErrorMessage("too_many_pages") };

  // Every page image and thumbnail must really be in Storage before the swap.
  let present: Set<string>;
  try {
    present = new Set(await listFolderFiles(curriculumId, uploadId));
  } catch (e) {
    console.error("finishBookUpload: listing the upload failed", e instanceof Error ? e.message : "unknown");
    return { ok: false, message: "The upload could not be checked. Please try again." };
  }
  const rows = pages.map((p) => ({
    page: p?.page,
    width: p?.width,
    height: p?.height,
    path: `${curriculumId}/${uploadId}/${p?.page}.webp`,
    thumb: `${curriculumId}/${uploadId}/${p?.page}.thumb.webp`,
  }));
  if (rows.some((r) => !present.has(r.path) || !present.has(r.thumb))) {
    return { ok: false, message: "Some pages did not finish uploading. Choose the PDF again." };
  }

  const result = await finalizeBookUpload(admin.id, curriculumId, uploadId, rows);
  if (!result.ok) return result;

  // The swap succeeded: drop the previous version and any abandoned attempts. A failure here only
  // leaves unused files behind, so it is logged and does not fail the action.
  try {
    const stale = (await listUploadFolders(curriculumId)).filter((f) => f !== uploadId);
    for (const folder of stale) await removeBookFiles(await listFolderFiles(curriculumId, folder));
  } catch (e) {
    console.error("finishBookUpload: removing old files failed", e instanceof Error ? e.message : "unknown");
  }
  revalidateContent(curriculumId);
  return { ok: true };
}

export async function saveChapterStarts(input: { curriculumId: string; chapters: ChapterInput[] }): Promise<ContentResult> {
  const admin = await requireAdmin();
  const { curriculumId, chapters } = input ?? ({} as typeof input);
  if (!isUuid(curriculumId) || !Array.isArray(chapters)) return { ok: false, message: BAD_REQUEST };
  if (chapters.some((c) => typeof c?.title !== "string" || (c.id !== undefined && !isUuid(c.id)))) {
    return { ok: false, message: BAD_REQUEST };
  }
  const book = await bookStatus(curriculumId);
  if (!book) return { ok: false, message: bookErrorMessage("no_book") };

  const checked = validateChapters(chapters, book.pageCount);
  if (!checked.ok) return checked;
  const result = await saveChaptersFn(admin.id, curriculumId, checked.chapters);
  if (!result.ok) return result;
  revalidateContent(curriculumId);
  return { ok: true };
}

export async function setBookPublished(input: { curriculumId: string; published: boolean }): Promise<ContentResult> {
  const admin = await requireAdmin();
  const { curriculumId, published } = input ?? ({} as typeof input);
  if (!isUuid(curriculumId) || typeof published !== "boolean") return { ok: false, message: BAD_REQUEST };
  const result = await setBookStatusFn(admin.id, curriculumId, published ? "published" : "draft");
  if (!result.ok) return result;
  revalidateContent(curriculumId);
  return { ok: true };
}
