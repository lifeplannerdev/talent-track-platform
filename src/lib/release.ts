import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "./attempts";

/**
 * Staff release: makes a held attempt's stored score visible to the student. Only a
 * 'submitted' attempt with a score is released; the SQL function public.release_attempt
 * (migration 0006) sets released_at, released_by and status, and the assignment outcome in
 * the same transaction. Releasing again is a no-op. It never takes or changes points.
 *
 * staffId must be the id of the authenticated staff session (requireRole('staff')); the
 * database also refuses a releaser who is not staff.
 */
export async function releaseAttempt(attemptId: string, staffId: string): Promise<void> {
  if (!isUuid(attemptId) || !isUuid(staffId)) throw new Error("releaseAttempt: invalid id");
  const db = createAdminClient();
  const { error } = await db.rpc("release_attempt", { p_attempt_id: attemptId, p_released_by: staffId });
  if (error) throw new Error(`Could not release attempt: ${error.message}`);
}
