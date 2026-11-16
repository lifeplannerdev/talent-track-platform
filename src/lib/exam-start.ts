import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { findOpenAttemptId } from "./attempts";

export type ExamSetInfo = {
  id: string;
  name: string;
  curriculumName: string;
  questionCount: number;
  timeLimitMin: number;
};

export type ExamStartState =
  | { kind: "none" }
  | { kind: "in_progress"; examSet: ExamSetInfo; attemptId: string }
  | { kind: "ready"; examSet: ExamSetInfo }
  | { kind: "awaiting_review"; examSet: ExamSetInfo; attemptId: string }
  | { kind: "waiting"; curriculumName: string; examSet: ExamSetInfo | null };

/**
 * What the student can do next: their next open curriculum (lowest position, via the
 * student-safe student_assignments view) and, within it, an attempt to resume, a grant to
 * use, a held attempt awaiting review, or nothing yet. studentId must be the session user.
 */
export async function getExamStartState(studentId: string): Promise<ExamStartState> {
  const supabase = await createClient();
  const { data: next, error: nextError } = await supabase
    .from("student_assignments")
    .select("curriculum_id, position")
    .eq("status", "open")
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle<{ curriculum_id: string; position: number }>();
  if (nextError) throw new Error(`Could not read assignments: ${nextError.message}`);
  if (!next) return { kind: "none" };

  const [{ data: curriculum }, { data: sets, error: setsError }] = await Promise.all([
    supabase.from("curriculums").select("name").eq("id", next.curriculum_id).maybeSingle<{ name: string }>(),
    supabase
      .from("exam_sets")
      .select("id, name, question_count, time_limit_min")
      .eq("curriculum_id", next.curriculum_id)
      .order("created_at", { ascending: true }),
  ]);
  if (setsError) throw new Error(`Could not read exam sets: ${setsError.message}`);
  const curriculumName = curriculum?.name ?? "";
  const examSets: ExamSetInfo[] = (sets ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    curriculumName,
    questionCount: s.question_count,
    timeLimitMin: s.time_limit_min,
  }));
  if (examSets.length === 0) return { kind: "waiting", curriculumName, examSet: null };

  for (const examSet of examSets) {
    const attemptId = await findOpenAttemptId(studentId, examSet.id);
    if (attemptId) return { kind: "in_progress", examSet, attemptId };
  }

  // Grants are not readable by students, so they are read with the service role for this student only.
  const admin = createAdminClient();
  const setIds = examSets.map((s) => s.id);
  const [{ data: grants, error: grantError }, { data: held, error: heldError }] = await Promise.all([
    admin
      .from("attempt_grants")
      .select("exam_set_id")
      .eq("student_id", studentId)
      .in("exam_set_id", setIds)
      .is("used_attempt_id", null),
    admin
      .from("attempts")
      .select("id, exam_set_id")
      .eq("student_id", studentId)
      .in("exam_set_id", setIds)
      .eq("status", "submitted")
      .order("submitted_at", { ascending: false })
      .limit(1),
  ]);
  if (grantError) throw new Error(`Could not read grants: ${grantError.message}`);
  if (heldError) throw new Error(`Could not read attempts: ${heldError.message}`);

  const granted = examSets.find((s) => grants?.some((g) => g.exam_set_id === s.id));
  if (granted) return { kind: "ready", examSet: granted };

  const pending = held?.[0];
  if (pending) {
    return { kind: "awaiting_review", examSet: examSets.find((s) => s.id === pending.exam_set_id)!, attemptId: pending.id };
  }
  return { kind: "waiting", curriculumName, examSet: examSets[0] };
}
