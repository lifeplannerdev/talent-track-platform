import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "./attempts";

// Extra attempts (spec change 1, replaces grants). Every student has the curriculum's
// max_attempts free attempts; staff add more per student and curriculum, at any time, which also
// lifts a block. The check and the write run atomically in the SQL function
// public.give_extra_attempts (migration 0021, service role only).

export type ExtraAttemptsErrorCode = "not_staff" | "invalid_n" | "not_assigned" | "already_passed";

const CODES = new Set<string>(["not_staff", "invalid_n", "not_assigned", "already_passed"]);

export class ExtraAttemptsError extends Error {
  code: ExtraAttemptsErrorCode;
  constructor(code: ExtraAttemptsErrorCode) {
    super(code);
    this.name = "ExtraAttemptsError";
    this.code = code;
  }
}

/** Bounds of n per call (give_extra_attempts refuses anything else). */
export const MIN_EXTRA_ATTEMPTS = 1;
export const MAX_EXTRA_ATTEMPTS = 10;

/**
 * Gives the student n (1..10) more attempts in the curriculum and, with allowRepeats, lets
 * exam sets they already had be given again (false never switches an earlier true off). A
 * blocked assignment opens in the same transaction when the new allowance exceeds the attempts
 * used (0024). `stillBlocked`: the student still has no attempt to start (attempts used >=
 * max_attempts + extra_attempts after the grant, whatever the stored status says, e.g. after staff
 * lowered the limit); null when that could not be read (the grant itself committed). Throws
 * ExtraAttemptsError.
 *
 * staffId must be the id of the authenticated staff session (requireRole('staff') in the
 * calling action); the database also refuses a giver who is not staff.
 */
export async function giveExtraAttempts(
  staffId: string,
  studentId: string,
  curriculumId: string,
  n: number,
  allowRepeats: boolean,
): Promise<{ stillBlocked: boolean | null }> {
  if (!Number.isInteger(n) || n < MIN_EXTRA_ATTEMPTS || n > MAX_EXTRA_ATTEMPTS) throw new ExtraAttemptsError("invalid_n");
  if (!isUuid(staffId)) throw new ExtraAttemptsError("not_staff");
  if (!isUuid(studentId) || !isUuid(curriculumId)) throw new ExtraAttemptsError("not_assigned");
  const db = createAdminClient();
  const { error } = await db.rpc("give_extra_attempts", {
    p_staff_id: staffId,
    p_student_id: studentId,
    p_curriculum_id: curriculumId,
    p_n: n,
    p_allow_repeats: allowRepeats === true,
  });
  if (error) {
    if (CODES.has(error.message)) throw new ExtraAttemptsError(error.message as ExtraAttemptsErrorCode);
    throw new Error(`Could not give extra attempts: ${error.message}`);
  }
  return { stillBlocked: await stillBlockedAfterGrant(studentId, curriculumId) };
}

/**
 * After a committed grant: attempts used (submitted or released over the curriculum's exam sets)
 * >= max_attempts + extra_attempts. Display only; a failing read is logged (ids only) and gives
 * null, never an error, so staff are not led to give the attempts twice.
 */
async function stillBlockedAfterGrant(studentId: string, curriculumId: string): Promise<boolean | null> {
  const db = createAdminClient();
  try {
    const [assignment, curriculum, used] = await Promise.all([
      db.from("assignments").select("extra_attempts").eq("student_id", studentId).eq("curriculum_id", curriculumId).maybeSingle<{ extra_attempts: number }>(),
      db.from("curriculums").select("max_attempts").eq("id", curriculumId).maybeSingle<{ max_attempts: number }>(),
      db
        .from("attempts")
        .select("id, exam_sets!inner(curriculum_id)", { count: "exact", head: true })
        .eq("student_id", studentId)
        .eq("exam_sets.curriculum_id", curriculumId)
        .in("status", ["submitted", "released"]),
    ]);
    const error = assignment.error ?? curriculum.error ?? used.error;
    if (error || !assignment.data || !curriculum.data || used.count === null) {
      throw new Error(error?.message ?? "missing row");
    }
    return used.count >= curriculum.data.max_attempts + assignment.data.extra_attempts;
  } catch {
    console.error(`giveExtraAttempts: status after the grant could not be read (student ${studentId}, curriculum ${curriculumId})`);
    return null;
  }
}
