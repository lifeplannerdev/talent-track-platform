import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAll, isUuid } from "./attempts";
import { attemptFilterQuery, type AttemptRowStatus } from "./attempt-status";
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

export type ResultFilters = { batch?: string; curriculumId?: string; status?: string };
export type ResultListItem = ReviewListItem & {
  status: AttemptRowStatus;
  batch: string | null;
  startedAt: string;
  releasedAt: string | null;
};

type ResultRow = Omit<AttemptRow, "student" | "exam_sets"> & {
  started_at: string;
  student: { full_name: string | null; username: string; batch: string | null } | null;
  exam_sets: { name: string; curriculum_id: string; curriculums: { name: string } | null } | null;
};

const RESULT_FIELDS =
  "id, status, started_at, deadline_at, submitted_at, released_at, points, max_points, passed, " +
  "student:profiles!attempts_student_id_fkey!inner(full_name, username, batch), " +
  "exam_sets!inner(name, curriculum_id, curriculums(name))";

function toResult(a: ResultRow): ResultListItem {
  return {
    id: a.id,
    studentName: nameOf(a.student),
    curriculumName: a.exam_sets?.curriculums?.name ?? "",
    examSetName: a.exam_sets?.name ?? "",
    submittedAt: a.submitted_at,
    points: a.points,
    maxPoints: a.max_points,
    passed: a.passed,
    status: a.status,
    batch: a.student?.batch ?? null,
    startedAt: a.started_at,
    releasedAt: a.released_at,
  };
}

/** Display order of the Attempts list: running first, then newest submission, newest start, id. */
function byListOrder(x: ResultRow, y: ResultRow): number {
  if (x.submitted_at !== y.submitted_at) {
    if (x.submitted_at === null) return -1;
    if (y.submitted_at === null) return 1;
    const d = Date.parse(y.submitted_at) - Date.parse(x.submitted_at);
    if (d !== 0) return d;
  }
  const s = Date.parse(y.started_at) - Date.parse(x.started_at);
  if (s !== 0) return s;
  return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
}

/**
 * Every attempt for the read-only staff Attempts list (in progress, being scored, or scored and
 * shown to the student at once), newest first (running ones first), with the filter options.
 * Filters: batch (exact), curriculum id, status (see attemptFilterQuery: in_progress, scoring,
 * passed, not_passed; anything else means all). A curriculum id that is not a uuid matches nothing.
 */
export async function listResults(
  filters: ResultFilters,
): Promise<{ rows: ResultListItem[]; batches: string[]; curriculums: { id: string; name: string }[] }> {
  const supabase = await createClient();
  const query = attemptFilterQuery(filters.status ?? "");
  const curriculumId = filters.curriculumId || undefined;
  const batch = filters.batch || undefined;

  const [rows, students, curriculums] = await Promise.all([
    curriculumId && !isUuid(curriculumId)
      ? Promise.resolve([] as ResultRow[])
      : fetchAll((from, to) => {
          let q = supabase.from("attempts").select(RESULT_FIELDS).in("status", query.statuses);
          if (query.passed !== undefined) q = q.eq("passed", query.passed);
          if (batch) q = q.eq("student.batch", batch);
          if (curriculumId) q = q.eq("exam_sets.curriculum_id", curriculumId);
          // Page by id (never changes), so an attempt submitted meanwhile is neither skipped nor
          // listed twice; the display order is applied after collection (byListOrder).
          return q
            .order("id")
            .range(from, to)
            .overrideTypes<ResultRow[], { merge: false }>();
        }, "Could not read attempts"),
    fetchAll(
      (from, to) => supabase.from("profiles").select("batch").eq("role", "student").not("batch", "is", null).order("id").range(from, to),
      "Could not read batches",
    ),
    fetchAll((from, to) => supabase.from("curriculums").select("id, name").order("name").range(from, to), "Could not read curriculums"),
  ]);

  return {
    rows: [...rows].sort(byListOrder).map(toResult),
    batches: [...new Set(students.map((p) => p.batch as string))].sort(),
    curriculums: curriculums.map((c) => ({ id: c.id as string, name: c.name as string })),
  };
}

/** The most recently submitted attempts (being scored or scored), for the staff dashboard. */
export async function listRecentAttempts(limit = 5): Promise<ResultListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attempts")
    .select(RESULT_FIELDS)
    .in("status", ["submitted", "released"])
    .order("submitted_at", { ascending: false })
    .order("id")
    .limit(limit)
    .overrideTypes<ResultRow[], { merge: false }>();
  if (error) throw new Error(`Could not read attempts: ${error.message}`);
  return (data ?? []).map(toResult);
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
    .select(ATTEMPT_FIELDS)
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
