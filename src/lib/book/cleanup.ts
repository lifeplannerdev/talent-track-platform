import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { folderNewestAt, listFolderFiles, listUploadFolders, removeBookFiles } from "@/lib/book/storage";

export const ABANDONED_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * After a successful finalize: delete the previous live folder and abandoned folders older than
 * 24 h. Never the new folder, never the folder that is live NOW (re-read first: another admin may
 * have finalized in between), never a folder younger than 24 h or of unknown age.
 * Returns the folders removed. Throws on a Storage error (caller logs the code).
 */
export async function cleanupOldUploads(input: {
  curriculumId: string;
  newUploadId: string;
  previousUploadId: string | null;
  now?: number;
}): Promise<string[]> {
  const { curriculumId, newUploadId, previousUploadId } = input;
  const now = input.now ?? Date.now();
  const { data, error } = await createAdminClient()
    .from("books")
    .select("upload_id")
    .eq("curriculum_id", curriculumId)
    .maybeSingle<{ upload_id: string | null }>();
  if (error) throw new Error(error.code ?? "books_read_failed");
  const live = data?.upload_id ?? null;

  const removed: string[] = [];
  for (const folder of await listUploadFolders(curriculumId)) {
    if (folder === newUploadId || folder === live) continue;
    let doomed = folder === previousUploadId;
    if (!doomed) {
      const newest = await folderNewestAt(curriculumId, folder);
      doomed = newest !== null && newest < now - ABANDONED_AFTER_MS;
    }
    if (!doomed) continue;
    await removeBookFiles(await listFolderFiles(curriculumId, folder));
    removed.push(folder);
  }
  return removed;
}
