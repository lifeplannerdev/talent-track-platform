"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { isUuid } from "@/lib/attempts";
import { ExtraAttemptsError, giveExtraAttempts, type ExtraAttemptsErrorCode } from "@/lib/extra-attempts";

export type ExtraAttemptsActionResult =
  | { ok: true; stillBlocked: boolean }
  | { ok: false; error: ExtraAttemptsErrorCode | "invalid_request" | "failed" };

/**
 * Gives a student n (1..10) extra attempts in a curriculum, optionally allowing exam sets they
 * already had to be given again; a block is lifted when the new allowance exceeds the attempts used
 * (`stillBlocked` otherwise). Authenticates itself (a student or
 * anonymous caller is redirected by requireRole and nothing changes); the giver is the staff
 * session, never a client value.
 */
export async function giveExtraAttemptsAction(input: {
  studentId: string;
  curriculumId: string;
  n: number;
  allowRepeats: boolean;
}): Promise<ExtraAttemptsActionResult> {
  const profile = await requireRole("staff");
  if (typeof input !== "object" || input === null || !isUuid(input.studentId) || !isUuid(input.curriculumId)) {
    return { ok: false, error: "invalid_request" };
  }
  let stillBlocked: boolean;
  try {
    ({ stillBlocked } = await giveExtraAttempts(profile.id, input.studentId, input.curriculumId, input.n, input.allowRepeats === true));
  } catch (e) {
    if (e instanceof ExtraAttemptsError) return { ok: false, error: e.code };
    console.error("giveExtraAttemptsAction failed", e);
    return { ok: false, error: "failed" };
  }
  revalidatePath("/staff");
  revalidatePath("/staff/blocked");
  revalidatePath("/staff/grants");
  revalidatePath(`/staff/students/${input.studentId}`);
  return { ok: true, stillBlocked };
}
