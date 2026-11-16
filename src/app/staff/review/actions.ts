"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { isUuid } from "@/lib/attempts";
import { releaseAttempt } from "@/lib/release";

export type ReleaseResult = { ok: true } | { ok: false; error: "invalid_request" | "failed" };

/**
 * Releases a held attempt. Authenticates itself (a student or anonymous caller is redirected
 * by requireRole and nothing is released); the releaser is the staff session, never a client
 * value. It takes only the attempt id: the stored score cannot be changed through it.
 */
export async function releaseAttemptAction(attemptId: string): Promise<ReleaseResult> {
  const profile = await requireRole("staff");
  if (!isUuid(attemptId)) return { ok: false, error: "invalid_request" };
  try {
    await releaseAttempt(attemptId, profile.id);
  } catch (e) {
    console.error("releaseAttemptAction failed", e);
    return { ok: false, error: "failed" };
  }
  revalidatePath("/staff/review");
  revalidatePath(`/staff/review/${attemptId}`);
  return { ok: true };
}
