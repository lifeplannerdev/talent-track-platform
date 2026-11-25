import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// The only module that talks to the book-pages bucket. Private bucket, no policies for sessions:
// every call here uses the service role. Paths are {curriculum_id}/{upload_id}/{page}.webp (and
// {page}.thumb.webp); the bucket accepts image/webp up to 5 MiB.

export const BOOK_BUCKET = "book-pages";
const REMOVE_CHUNK = 100;
const LIST_PAGE = 1000;

/** Signed read URLs for the given paths (missing files are left out of the map). */
export async function signReadUrls(paths: string[], ttlSeconds: number): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (paths.length === 0) return out;
  const { data, error } = await createAdminClient().storage.from(BOOK_BUCKET).createSignedUrls(paths, ttlSeconds);
  if (error) {
    console.error("signReadUrls failed", error.name ?? "unknown");
    return out;
  }
  for (const row of data ?? []) {
    if (row.path && row.signedUrl && !row.error) out.set(row.path, row.signedUrl);
  }
  return out;
}

/** A signed URL the browser can PUT one webp file to (valid for a couple of hours at most). */
export async function createUploadUrl(path: string): Promise<string | null> {
  const { data, error } = await createAdminClient().storage.from(BOOK_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    console.error("createUploadUrl failed", error?.name ?? "unknown");
    return null;
  }
  return data.signedUrl;
}

/** Deletes files (in chunks). Throws on a Storage error so callers can log the code. */
export async function removeBookFiles(paths: string[]): Promise<void> {
  const bucket = createAdminClient().storage.from(BOOK_BUCKET);
  for (let i = 0; i < paths.length; i += REMOVE_CHUNK) {
    const { error } = await bucket.remove(paths.slice(i, i + REMOVE_CHUNK));
    if (error) throw new Error(error.name ?? "storage_remove_failed");
  }
}

async function listNames(prefix: string): Promise<{ name: string; isFolder: boolean }[]> {
  const bucket = createAdminClient().storage.from(BOOK_BUCKET);
  const rows: { name: string; isFolder: boolean }[] = [];
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await bucket.list(prefix, { limit: LIST_PAGE, offset });
    if (error) throw new Error(error.name ?? "storage_list_failed");
    for (const r of data ?? []) rows.push({ name: r.name, isFolder: r.id === null });
    if (!data || data.length < LIST_PAGE) break;
  }
  return rows;
}

/** Upload ids (folder names) that exist under this curriculum's folder. */
export async function listUploadFolders(curriculumId: string): Promise<string[]> {
  return (await listNames(curriculumId)).filter((r) => r.isFolder).map((r) => r.name);
}

/** Full paths of the files inside one upload folder. */
export async function listFolderFiles(curriculumId: string, uploadId: string): Promise<string[]> {
  const prefix = `${curriculumId}/${uploadId}`;
  return (await listNames(prefix)).filter((r) => !r.isFolder).map((r) => `${prefix}/${r.name}`);
}

/** Newest file timestamp (ms) in an upload folder, or null when it cannot be determined. */
export async function folderNewestAt(curriculumId: string, uploadId: string): Promise<number | null> {
  const bucket = createAdminClient().storage.from(BOOK_BUCKET);
  let newest: number | null = null;
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await bucket.list(`${curriculumId}/${uploadId}`, { limit: LIST_PAGE, offset });
    if (error) throw new Error(error.name ?? "storage_list_failed");
    for (const f of data ?? []) {
      if (f.id === null) continue;
      const t = Math.max(Date.parse(f.updated_at ?? "") || 0, Date.parse(f.created_at ?? "") || 0);
      if (!t) return null; // age unknown: the caller keeps the folder
      newest = Math.max(newest ?? 0, t);
    }
    if (!data || data.length < LIST_PAGE) break;
  }
  return newest;
}
