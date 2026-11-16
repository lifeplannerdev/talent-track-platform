import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "./attempts";

export type TopicScore = { topic: string; points: number; max: number };

type Common = { id: string; examSetName: string; curriculumName: string; submittedAt: string | null };

/**
 * What a student may see of their own attempt. Before release there are no numbers at all;
 * after release the stored score, pass or fail and a per-topic breakdown. Never answer keys,
 * chosen options or question-by-question results.
 */
export type StudentResult =
  | { status: "in_progress"; id: string }
  | ({ status: "submitted" } & Common)
  | ({
      status: "released";
      releasedAt: string | null;
      points: number;
      maxPoints: number;
      percent: number;
      passed: boolean;
    } & Common & { topics: TopicScore[] });

type ViewRow = {
  id: string;
  exam_set_id: string;
  status: "in_progress" | "submitted" | "released";
  deadline_at: string;
  submitted_at: string | null;
  released_at: string | null;
  points: number | null;
  max_points: number | null;
  passed: boolean | null;
};

/** One decimal place, e.g. 57.1. */
export function percentOf(points: number, max: number): number {
  return max > 0 ? Math.round((points / max) * 1000) / 10 : 0;
}

/**
 * The session student's own attempt, or null if it is not theirs (or does not exist).
 * Reads through the student_attempts view with the session client, so RLS and the view's
 * masking decide what is visible. studentId must be the session user (requireRole).
 */
export async function getStudentResult(studentId: string, attemptId: string): Promise<StudentResult | null> {
  if (!isUuid(attemptId) || !isUuid(studentId)) return null;
  const supabase = await createClient();
  const { data: attempt, error } = await supabase
    .from("student_attempts")
    .select("id, exam_set_id, status, deadline_at, submitted_at, released_at, points, max_points, passed")
    .eq("id", attemptId)
    .eq("student_id", studentId)
    .maybeSingle<ViewRow>();
  if (error) throw new Error(`Could not read result: ${error.message}`);
  if (!attempt) return null;
  if (attempt.status === "in_progress") return { status: "in_progress", id: attempt.id };

  const { data: set } = await supabase
    .from("exam_sets")
    .select("name, curriculums(name)")
    .eq("id", attempt.exam_set_id)
    .maybeSingle<{ name: string; curriculums: { name: string } | null }>();
  const common: Common = {
    id: attempt.id,
    examSetName: set?.name ?? "",
    curriculumName: set?.curriculums?.name ?? "",
    submittedAt: attempt.submitted_at,
  };

  if (attempt.status !== "released" || attempt.points === null || attempt.max_points === null || attempt.passed === null) {
    return { status: "submitted", ...common };
  }

  return {
    status: "released",
    ...common,
    releasedAt: attempt.released_at,
    points: attempt.points,
    maxPoints: attempt.max_points,
    percent: percentOf(attempt.points, attempt.max_points),
    passed: attempt.passed,
    topics: await topicBreakdown(studentId, attempt.id),
  };
}

/**
 * Per-topic points of a released attempt from the scoring snapshot stored on
 * attempt_questions (migration 0007), so it always adds up to the stored total even if
 * questions were edited later. attempt_questions is staff-only, so this runs with the service
 * role, but only after checking again that the attempt belongs to this student and is
 * released. Only topic totals leave this function.
 */
async function topicBreakdown(studentId: string, attemptId: string): Promise<TopicScore[]> {
  const db = createAdminClient();
  const { data: owned, error } = await db
    .from("attempts")
    .select("id")
    .eq("id", attemptId)
    .eq("student_id", studentId)
    .eq("status", "released")
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(`Could not read attempt: ${error.message}`);
  if (!owned) return [];

  const { data: rows, error: qError } = await db
    .from("attempt_questions")
    .select("topic, max_points, awarded_points")
    .eq("attempt_id", owned.id)
    .not("awarded_points", "is", null);
  if (qError) throw new Error(`Could not read questions: ${qError.message}`);
  const paper = (rows ?? []) as { topic: string; max_points: number; awarded_points: number }[];

  const topics = new Map<string, TopicScore>();
  for (const r of paper) {
    const t = topics.get(r.topic) ?? { topic: r.topic, points: 0, max: 0 };
    t.max += r.max_points;
    t.points += r.awarded_points;
    topics.set(t.topic, t);
  }
  return [...topics.values()].sort((a, b) => a.topic.localeCompare(b.topic));
}
