import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAll, isUuid } from "./attempts";
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
  student: Person;
  releaser?: Person;
  exam_sets: { name: string; curriculums: { name: string } | null } | null;
};

const ATTEMPT_FIELDS =
  "id, status, deadline_at, submitted_at, released_at, points, max_points, passed, " +
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

export type ReviewQuestion = {
  attemptQuestionId: string;
  position: number;
  topic: string;
  stemDe: string;
  stemEn: string;
  /** In the order the student saw them. */
  options: QuestionOption[];
  correctOptionId: string;
  chosenOptionId: string | null;
  awardedPoints: number;
  maxPoints: number;
};

export type AttemptReview = ReviewListItem & {
  status: AttemptRow["status"];
  releasedAt: string | null;
  releasedBy: string | null;
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
    .select("id, position, option_order, questions(topic, stem_de, stem_en, options, correct_option_id, points)")
    .eq("attempt_id", attempt.id)
    .order("position");
  if (qError) throw new Error(`Could not read questions: ${qError.message}`);
  const paper = (rows ?? []) as unknown as {
    id: string;
    position: number;
    option_order: string[];
    questions: {
      topic: string;
      stem_de: string;
      stem_en: string;
      options: QuestionOption[];
      correct_option_id: string;
      points: number;
    };
  }[];

  const chosen = new Map<string, string>();
  if (paper.length) {
    // Same rule as scoring: only answers saved before the deadline count.
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
    questions: paper.map((r) => {
      const q = r.questions;
      const choice = chosen.get(r.id) ?? null;
      return {
        attemptQuestionId: r.id,
        position: r.position,
        topic: q.topic,
        stemDe: q.stem_de,
        stemEn: q.stem_en,
        options: r.option_order.map((id) => q.options.find((o) => o.id === id) ?? { id, de: "", en: "" }),
        correctOptionId: q.correct_option_id,
        chosenOptionId: choice,
        awardedPoints: choice === q.correct_option_id ? q.points : 0,
        maxPoints: q.points,
      };
    }),
  };
}
