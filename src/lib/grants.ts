import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { findOpenAttemptId, isUuid } from "./attempts";

// Staff grants. Attempts are never created automatically: a student can only start an exam
// with an unused grant, and grants come only from here. The check, the insert and the unblock
// after a block run atomically in the SQL function public.grant_attempt (migrations 0008, 0009).
// The in-progress and held-result guards are per curriculum, because blocking is.

export type GrantErrorCode =
  | "not_staff"
  | "not_assigned"
  | "exam_set_not_found"
  | "assignment_passed"
  | "in_progress"
  | "result_pending"
  | "grant_exists";

const GRANT_CODES = new Set<string>([
  "not_staff",
  "not_assigned",
  "exam_set_not_found",
  "assignment_passed",
  "in_progress",
  "result_pending",
  "grant_exists",
]);

export class GrantError extends Error {
  code: GrantErrorCode;
  constructor(code: GrantErrorCode) {
    super(code);
    this.name = "GrantError";
    this.code = code;
  }
}

export type GrantResult = { ok: true } | { ok: false; unseenAvailable: number; needed: number };

/**
 * Gives the student one more attempt at the exam set (a first attempt, a retake, or the
 * override after a block, which also sets the assignment back to 'open'). Returns the shortfall
 * and writes nothing when the student's unseen approved questions cannot fill a paper.
 * Throws GrantError for a refusal (see GrantErrorCode). A blocked student who already holds an
 * unused grant for the set is unblocked and ok is returned (recovery, nothing is stacked).
 *
 * staffId must be the id of the authenticated staff session (requireRole('staff')); the
 * database also refuses a granter who is not staff.
 */
export async function grantAttempt(studentId: string, examSetId: string, staffId: string): Promise<GrantResult> {
  if (!isUuid(studentId) || !isUuid(examSetId) || !isUuid(staffId)) throw new Error("grantAttempt: invalid id");
  // Lazy expiry: an attempt whose deadline has passed is submitted (and scored) first, so it
  // no longer counts as in progress.
  await findOpenAttemptId(studentId, examSetId);

  const db = createAdminClient();
  const { data, error } = await db.rpc("grant_attempt", {
    p_student_id: studentId,
    p_exam_set_id: examSetId,
    p_staff_id: staffId,
  });
  if (error) {
    if (GRANT_CODES.has(error.message)) throw new GrantError(error.message as GrantErrorCode);
    throw new Error(`Could not grant attempt: ${error.message}`);
  }
  const result = data as { ok: boolean; unseen_available?: number; needed?: number };
  if (result.ok) return { ok: true };
  return { ok: false, unseenAvailable: result.unseen_available ?? 0, needed: result.needed ?? 0 };
}
