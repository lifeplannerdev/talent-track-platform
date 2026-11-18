import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAll, isUuid } from "./attempts";
import { formatPercent } from "./percent";
import type { QuestionOption } from "./types";

// Staff review readers. They use the session client, so RLS decides: staff can read
// attempts, questions and answers; anyone else gets nothing. Callers still authenticate
// with requireRole('staff') first.

type Person = { full_name: string | null; username: string } | null;
const nameOf = (p: Person) => p?.full_name || p?.username || "Unknown";

export type ReviewListItem = {
  id: string;
  studentName: string;
  curriculumName: string;
  examSetName: string;
  submittedAt: string | null;
  points: number | null;
  maxPoints: number | null;
  passed: boolean | null;
};

type AttemptRow = {
  id: string;
  status: "in_progress" | "submitted" | "released";
  deadline_at: string;
  submitted_at: string | null;
  released_at: string | null;
  points: number | null;
  max_points: number | null;
  passed: boolean | null;
  pass_mark_percent: number | null;
  student: Person;
  releaser?: Person;
  exam_sets: { name: string; curriculums: { name: string } | null } | null;
};

const ATTEMPT_FIELDS =
  "id, status, deadline_at, submitted_at, released_at, points, max_points, passed, pass_mark_percent, " +
  "student:profiles!attempts_student_id_fkey(full_name, username), exam_sets(name, curriculums(name))";

function toItem(a: AttemptRow): ReviewListItem {
  return {
    id: a.id,
    studentName: nameOf(a.student),
    curriculumName: a.exam_sets?.curriculums?.name ?? "",
    examSetName: a.exam_sets?.name ?? "",
    submittedAt: a.submitted_at,
    points: a.points,
    maxPoints: a.max_points,
    passed: a.passed,
  };
}

/** Submitted attempts that are not released yet, newest first. */
export async function listSubmittedAttempts(): Promise<ReviewListItem[]> {
  const supabase = await createClient();
  const rows = await fetchAll(
    (from, to) =>
      supabase
        .from("attempts")
        .select(ATTEMPT_FIELDS)
        .eq("status", "submitted")
        .order("submitted_at", { ascending: false })
        .order("id")
        .range(from, to)
        .overrideTypes<AttemptRow[], { merge: false }>(),
    "Could not read submitted attempts",
  );
  return rows.map(toItem);
}

export type ResultStatus = "submitted" | "released";
export type ResultFilters = { batch?: string; curriculumId?: string; status?: string };
export type ResultListItem = ReviewListItem & { status: ResultStatus; batch: string | null; releasedAt: string | null };

type ResultRow = Omit<AttemptRow, "student" | "exam_sets"> & {
  student: { full_name: string | null; username: string; batch: string | null } | null;
  exam_sets: { name: string; curriculum_id: string; curriculums: { name: string } | null } | null;
};

/**
 * Every scored attempt (held = 'submitted', or 'released'), newest first, for the staff results
 * list, with the filter options. Filters: batch (exact), curriculum id, status. An unknown status
 * is ignored; a curriculum id that is not a uuid matches nothing.
 */
export async function listResults(
  filters: ResultFilters,
): Promise<{ rows: ResultListItem[]; batches: string[]; curriculums: { id: string; name: string }[] }> {
  const supabase = await createClient();
  const status: ResultStatus[] =
    filters.status === "submitted" || filters.status === "released" ? [filters.status] : ["submitted", "released"];
  const curriculumId = filters.curriculumId || undefined;
  const batch = filters.batch || undefined;

  const [rows, students, curriculums] = await Promise.all([
    curriculumId && !isUuid(curriculumId)
      ? Promise.resolve([] as ResultRow[])
      : fetchAll((from, to) => {
          let q = supabase
            .from("attempts")
            .select(
              "id, status, deadline_at, submitted_at, released_at, points, max_points, passed, " +
                "student:profiles!attempts_student_id_fkey!inner(full_name, username, batch), " +
                "exam_sets!inner(name, curriculum_id, curriculums(name))",
            )
            .in("status", status);
          if (batch) q = q.eq("student.batch", batch);
          if (curriculumId) q = q.eq("exam_sets.curriculum_id", curriculumId);
          return q
            .order("submitted_at", { ascending: false })
            .order("id")
            .range(from, to)
            .overrideTypes<ResultRow[], { merge: false }>();
        }, "Could not read results"),
    fetchAll(
      (from, to) => supabase.from("profiles").select("batch").eq("role", "student").not("batch", "is", null).order("id").range(from, to),
      "Could not read batches",
    ),
    fetchAll((from, to) => supabase.from("curriculums").select("id, name").order("name").range(from, to), "Could not read curriculums"),
  ]);

  return {
    rows: rows.map((a) => ({
      id: a.id,
      studentName: nameOf(a.student),
      curriculumName: a.exam_sets?.curriculums?.name ?? "",
      examSetName: a.exam_sets?.name ?? "",
      submittedAt: a.submitted_at,
      points: a.points,
      maxPoints: a.max_points,
      passed: a.passed,
      status: a.status as ResultStatus,
      batch: a.student?.batch ?? null,
      releasedAt: a.released_at,
    })),
    batches: [...new Set(students.map((p) => p.batch as string))].sort(),
    curriculums: curriculums.map((c) => ({ id: c.id as string, name: c.name as string })),
  };
}

/** Key, topic and points come from the scoring snapshot (null until the attempt is scored). */
export type ReviewQuestion = {
  attemptQuestionId: string;
  position: number;
  topic: string | null;
  stemDe: string;
  stemEn: string;
  /** In the order the student saw them. */
  options: QuestionOption[];
  correctOptionId: string | null;
  chosenOptionId: string | null;
  awardedPoints: number | null;
  maxPoints: number | null;
};

export type AttemptReview = ReviewListItem & {
  status: AttemptRow["status"];
  releasedAt: string | null;
  releasedBy: string | null;
  /** The headline result ("92%"), or null when not scored yet. */
  percentLabel: string | null;
  /** The pass mark snapshot taken when the attempt started (null only for legacy attempts). */
  passMarkPercent: number | null;
  questions: ReviewQuestion[];
};

/** One attempt with every question, the student's choice and the key, or null if not visible. */
export async function getAttemptReview(attemptId: string): Promise<AttemptReview | null> {
  if (!isUuid(attemptId)) return null;
  const supabase = await createClient();
  const { data: attempt, error } = await supabase
    .from("attempts")
    .select(`${ATTEMPT_FIELDS}, releaser:profiles!attempts_released_by_fkey(full_name, username)`)
    .eq("id", attemptId)
    .maybeSingle<AttemptRow>();
  if (error) throw new Error(`Could not read attempt: ${error.message}`);
  if (!attempt) return null;

  const { data: rows, error: qError } = await supabase
    .from("attempt_questions")
    .select("id, position, option_order, topic, correct_option_id, max_points, awarded_points, questions(stem_de, stem_en, options)")
    .eq("attempt_id", attempt.id)
    .order("position");
  if (qError) throw new Error(`Could not read questions: ${qError.message}`);
  const paper = (rows ?? []) as unknown as {
    id: string;
    position: number;
    option_order: string[];
    topic: string | null;
    correct_option_id: string | null;
    max_points: number | null;
    awarded_points: number | null;
    questions: { stem_de: string; stem_en: string; options: QuestionOption[] };
  }[];

  const chosen = new Map<string, string>();
  if (paper.length) {
    // The student's choice, as scored: only answers saved before the deadline count.
    const { data: saved, error: aError } = await supabase
      .from("answers")
      .select("attempt_question_id, option_id")
      .in(
        "attempt_question_id",
        paper.map((r) => r.id),
      )
      .lte("saved_at", attempt.deadline_at);
    if (aError) throw new Error(`Could not read answers: ${aError.message}`);
    for (const a of saved ?? []) chosen.set(a.attempt_question_id, a.option_id);
  }

  return {
    ...toItem(attempt),
    status: attempt.status,
    releasedAt: attempt.released_at,
    releasedBy: attempt.releaser ? nameOf(attempt.releaser) : null,
    percentLabel: attempt.points === null || attempt.max_points === null ? null : formatPercent(attempt.points, attempt.max_points),
    passMarkPercent: attempt.pass_mark_percent,
    questions: paper.map((r) => {
      const q = r.questions;
      return {
        attemptQuestionId: r.id,
        position: r.position,
        topic: r.topic,
        stemDe: q.stem_de,
        stemEn: q.stem_en,
        options: r.option_order.map((id) => q.options.find((o) => o.id === id) ?? { id, de: "", en: "" }),
        correctOptionId: r.correct_option_id,
        chosenOptionId: chosen.get(r.id) ?? null,
        awardedPoints: r.awarded_points,
        maxPoints: r.max_points,
      };
    }),
  };
}
