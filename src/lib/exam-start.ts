import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { fetchAll, settleAttempts } from "./attempts";
import { canFillPaper, chooseExamSet } from "./exam-set-choice";

/**
 * One card per assigned curriculum (spec change 1: curriculums are independent, any order).
 *   ready        the student can start; the exam set is chosen for them at start
 *   in_progress  an attempt runs (attemptId to resume)
 *   calculating  the latest attempt is submitted but its score is not recorded yet (attemptId)
 *   passed       the curriculum is passed
 *   blocked      blocked, or open with no attempts left (only staff can give more)
 *   unavailable  attempts are left but no exam set can be given (every set used without
 *                allow_repeats, or none with enough approved questions): contact the trainer
 */
export type CurriculumCardKind = "ready" | "in_progress" | "passed" | "blocked" | "unavailable" | "calculating";

export type CurriculumCard = {
  curriculumId: string;
  name: string;
  position: number;
  kind: CurriculumCardKind;
  /** curriculums.max_attempts + extra_attempts - attempts used (submitted or released), at least 0. */
  attemptsLeft: number;
  attemptId?: string;
};

/** The start page's state: the cards, ordered by position (empty when nothing is assigned). */
export type ExamStartState = CurriculumCard[];

type AssignmentDetail = {
  curriculum_id: string;
  extra_attempts: number;
  allow_repeats: boolean;
  curriculums: { name: string; max_attempts: number };
};

/**
 * The session student's curriculum cards. Which curriculums are assigned is read through the
 * student-safe student_assignments view (session client), so only the session user's own
 * assignments appear; the details students cannot read (allowance, exam set pools) are read with
 * the service role for those curriculums of this student only. Reading also heals the student's
 * attempts (lazy expiry, scoring an interrupted submit). studentId must be the session user.
 */
export async function getExamStartState(studentId: string): Promise<ExamStartState> {
  // Settle first: scoring an expired or interrupted attempt can move the assignment to passed or
  // blocked (record_score), so statuses are read only afterwards.
  const attempts = await settleAttempts(studentId);
  const supabase = await createClient();
  const { data: mine, error } = await supabase
    .from("student_assignments")
    .select("student_id, curriculum_id, position, status")
    .order("position", { ascending: true })
    .returns<{ student_id: string; curriculum_id: string; position: number; status: "open" | "passed" | "blocked" }[]>();
  if (error) throw new Error(`Could not read assignments: ${error.message}`);
  const assignments = (mine ?? []).filter((a) => a.student_id === studentId);
  if (assignments.length === 0) return [];
  const curriculumIds = assignments.map((a) => a.curriculum_id);

  const admin = createAdminClient();
  const [{ data: details, error: dError }, { data: sets, error: sError }] = await Promise.all([
    admin
      .from("assignments")
      .select("curriculum_id, extra_attempts, allow_repeats, curriculums(name, max_attempts)")
      .eq("student_id", studentId)
      .in("curriculum_id", curriculumIds)
      .returns<AssignmentDetail[]>(),
    admin
      .from("exam_sets")
      .select("id, curriculum_id, question_count, topic_mix")
      .in("curriculum_id", curriculumIds)
      .returns<{ id: string; curriculum_id: string; question_count: number; topic_mix: Record<string, number> | null }[]>(),
  ]);
  if (dError) throw new Error(`Could not read assignments: ${dError.message}`);
  if (sError) throw new Error(`Could not read exam sets: ${sError.message}`);
  const setIds = (sets ?? []).map((s) => s.id);
  const approved = setIds.length
    ? await fetchAll(
        (from, to) =>
          admin
            .from("questions")
            .select("id, exam_set_id, topic")
            .in("exam_set_id", setIds)
            .eq("status", "approved")
            .order("id")
            .range(from, to),
        "Could not read questions",
      )
    : [];

  return assignments.map((a): CurriculumCard => {
    const detail = details?.find((d) => d.curriculum_id === a.curriculum_id);
    const mineHere = attempts.filter((t) => t.curriculumId === a.curriculum_id);
    const used = mineHere.filter((t) => t.status === "submitted" || t.status === "released").length;
    const allowance = (detail?.curriculums.max_attempts ?? 0) + (detail?.extra_attempts ?? 0);
    const card = {
      curriculumId: a.curriculum_id,
      name: detail?.curriculums.name ?? "",
      position: a.position,
      attemptsLeft: Math.max(0, allowance - used),
    };

    const running = mineHere.find((t) => t.status === "in_progress");
    if (running) return { ...card, kind: "in_progress", attemptId: running.id };
    const pending = mineHere.filter((t) => t.status === "submitted").at(-1);
    if (pending) return { ...card, kind: "calculating", attemptId: pending.id };
    if (a.status === "passed") return { ...card, kind: "passed" };
    if (a.status === "blocked" || card.attemptsLeft === 0) return { ...card, kind: "blocked" };

    // Same choice rule as startAttempt: sets that can fill a paper, unused or (with repeats) any.
    const usable = (sets ?? []).filter(
      (s) =>
        s.curriculum_id === a.curriculum_id &&
        canFillPaper(
          { questionCount: s.question_count, topicMix: s.topic_mix },
          approved.filter((q) => q.exam_set_id === s.id).map((q) => q.topic as string),
        ),
    );
    const usedSets = new Set(mineHere.map((t) => t.examSetId));
    const choice = chooseExamSet(
      usable.map((s) => ({ id: s.id, lastUsedAt: null })),
      usedSets,
      detail?.allow_repeats ?? false,
      () => 0,
    );
    return { ...card, kind: choice ? "ready" : "unavailable" };
  });
}
