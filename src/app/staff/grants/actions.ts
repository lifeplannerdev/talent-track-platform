"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { isUuid } from "@/lib/attempts";
import { GrantError, grantAttempt, type GrantErrorCode } from "@/lib/grants";

export type GrantActionResult =
  | { ok: true }
  | { ok: false; error: "shortfall"; unseenAvailable: number; needed: number }
  | { ok: false; error: GrantErrorCode | "invalid_request" | "failed" };

/**
 * Gives a student another attempt (first attempt, retake, or override after a block).
 * Authenticates itself (a student or anonymous caller is redirected by requireRole and nothing
 * is created); the granter is the staff session, never a client value.
 */
export async function grantAttemptAction(studentId: string, examSetId: string): Promise<GrantActionResult> {
  const profile = await requireRole("staff");
  if (!isUuid(studentId) || !isUuid(examSetId)) return { ok: false, error: "invalid_request" };
  let result;
  try {
    result = await grantAttempt(studentId, examSetId, profile.id);
  } catch (e) {
    if (e instanceof GrantError) return { ok: false, error: e.code };
    console.error("grantAttemptAction failed", e);
    return { ok: false, error: "failed" };
  }
  if (!result.ok) return { ok: false, error: "shortfall", unseenAvailable: result.unseenAvailable, needed: result.needed };
  revalidatePath("/staff");
  revalidatePath("/staff/blocked");
  revalidatePath("/staff/grants");
  return { ok: true };
}
