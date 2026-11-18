import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "./attempts";
import { formatPercent, percentValue } from "./percent";

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
      /** Exact share of the points (0 to 100), for the bar. Show percentLabel as text. */
      percent: number;
      /** The headline result, e.g. "92%" or "66.7%" (formatPercent). */
      percentLabel: string;
      passed: boolean;
      /** The pass mark snapshot taken when the attempt started (null only for legacy attempts). */
      passMarkPercent: number | null;
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

/** One row of the student's own results list. Numbers are null until the result is released. */
export type StudentResultListItem = {
  id: string;
  status: "submitted" | "released";
  curriculumName: string;
  examSetName: string;
  submittedAt: string | null;
  points: number | null;
  maxPoints: number | null;
  passed: boolean | null;
};

/**
 * The session student's submitted and released attempts, newest first, through the
 * student_attempts view with the session client (the view masks the numbers until release).
 * In-progress attempts are left out. studentId must be the session user (requireRole).
 */
export async function listStudentResults(studentId: string): Promise<StudentResultListItem[]> {
  if (!isUuid(studentId)) return [];
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("student_attempts")
    .select("id, exam_set_id, status, submitted_at, points, max_points, passed")
    .eq("student_id", studentId)
    .in("status", ["submitted", "released"])
    .order("submitted_at", { ascending: false })
    .order("id")
    .returns<Omit<ViewRow, "deadline_at" | "released_at">[]>();
  if (error) throw new Error(`Could not read results: ${error.message}`);
  const attempts = rows ?? [];
  if (attempts.length === 0) return [];

  // Exam sets of curriculums no longer assigned are not readable; their rows keep blank names.
  const { data: sets, error: setsError } = await supabase
    .from("exam_sets")
    .select("id, name, curriculums(name)")
    .in("id", [...new Set(attempts.map((a) => a.exam_set_id))])
    .returns<{ id: string; name: string; curriculums: { name: string } | null }[]>();
  if (setsError) throw new Error(`Could not read exam sets: ${setsError.message}`);

  return attempts.map((a) => {
    const set = sets?.find((s) => s.id === a.exam_set_id);
    const released = a.status === "released";
    return {
      id: a.id,
      status: released ? "released" : "submitted",
      curriculumName: set?.curriculums?.name ?? "",
      examSetName: set?.name ?? "",
      submittedAt: a.submitted_at,
      points: released ? a.points : null,
      maxPoints: released ? a.max_points : null,
      passed: released ? a.passed : null,
    };
  });
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

  const details = await releasedDetails(studentId, attempt.id);
  return {
    status: "released",
    ...common,
    releasedAt: attempt.released_at,
    points: attempt.points,
    maxPoints: attempt.max_points,
    percent: percentValue(attempt.points, attempt.max_points),
    percentLabel: formatPercent(attempt.points, attempt.max_points),
    passed: attempt.passed,
    passMarkPercent: details.passMarkPercent,
    topics: details.topics,
  };
}

/**
 * The pass mark snapshot (attempts.pass_mark_percent, migration 0019) and the per-topic points
 * of a released attempt from the scoring snapshot on attempt_questions (migration 0007), so the
 * breakdown always adds up to the stored total and the pass mark is the one the attempt was
 * scored against, even if staff edited questions or the exam set later. Both are not readable by
 * students, so this runs with the service role, but only after checking again that the attempt
 * belongs to this student and is released. Only the pass mark and topic totals leave it.
 */
async function releasedDetails(
  studentId: string,
  attemptId: string,
): Promise<{ passMarkPercent: number | null; topics: TopicScore[] }> {
  const db = createAdminClient();
  const { data: owned, error } = await db
    .from("attempts")
    .select("id, pass_mark_percent")
    .eq("id", attemptId)
    .eq("student_id", studentId)
    .eq("status", "released")
    .maybeSingle<{ id: string; pass_mark_percent: number | null }>();
  if (error) throw new Error(`Could not read attempt: ${error.message}`);
  if (!owned) return { passMarkPercent: null, topics: [] };

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
  return {
    passMarkPercent: owned.pass_mark_percent,
    topics: [...topics.values()].sort((a, b) => a.topic.localeCompare(b.topic)),
  };
}
