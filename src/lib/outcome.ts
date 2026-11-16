import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Applies a RELEASED attempt's result to the student's assignment. Call it only at release
 * (submitAttempt for sets without held results, or the staff release in Task 6).
 * A pass marks the assignment for the exam set's curriculum as passed. A fail changes
 * nothing yet (Task 7 adds the blocking rule). Unreleased attempts are ignored, so an
 * assignment never reveals a held result.
 */
export async function applyOutcome(attemptId: string): Promise<void> {
  const db = createAdminClient();
  const { data: attempt, error } = await db
    .from("attempts")
    .select("status, passed, student_id, exam_sets(curriculum_id)")
    .eq("id", attemptId)
    .maybeSingle<{ status: string; passed: boolean | null; student_id: string; exam_sets: { curriculum_id: string } }>();
  if (error) throw new Error(`Could not read attempt: ${error.message}`);
  if (!attempt || attempt.status !== "released" || attempt.passed !== true) return;

  const { error: updateError } = await db
    .from("assignments")
    .update({ status: "passed" })
    .eq("student_id", attempt.student_id)
    .eq("curriculum_id", attempt.exam_sets.curriculum_id);
  if (updateError) throw new Error(`Could not update assignment: ${updateError.message}`);
}
