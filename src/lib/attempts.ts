import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { drawPaper, InsufficientPoolError } from "./draw";
import { scoreAttempt } from "./scoring";
import type { Question, QuestionOption } from "./types";

// Attempt lifecycle. Every function here runs with the service role and must only be
// called from server code that has authenticated the student (requireRole) and passes the
// session's user id. The atomic writes live in SQL functions (migration 0004); the deadline
// is always checked with database time.

export type AttemptErrorCode =
  | "no_grant"
  | "in_progress"
  | "not_found"
  | "closed"
  | "deadline_passed"
  | "invalid_option"
  | "question_already_seen"
  | "exam_set_not_found"
  | "invalid_draw"
  | "insufficient_pool";

const SQL_CODES = new Set<string>([
  "no_grant",
  "in_progress",
  "not_found",
  "closed",
  "deadline_passed",
  "invalid_option",
  "question_already_seen",
  "exam_set_not_found",
  "invalid_draw",
]);

export class AttemptError extends Error {
  code: AttemptErrorCode;
  constructor(code: AttemptErrorCode) {
    super(code);
    this.name = "AttemptError";
    this.code = code;
  }
}

type DbError = { message: string; code?: string };

function toError(error: DbError, what: string): Error {
  if (SQL_CODES.has(error.message)) return new AttemptError(error.message as AttemptErrorCode);
  return new Error(`${what}: ${error.message}`);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Ids from URLs and clients are checked before they reach a uuid column. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

const PAGE_SIZE = 1000; // PostgREST's default max rows per response

/** Reads every row by paging, so the PostgREST row cap can never truncate a result silently. */
async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: DbError | null }>,
  what: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw toError(error, what);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

function secureRandom(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 2 ** 32;
}

export type AttemptStatus = "in_progress" | "submitted" | "released";

export type ExamQuestion = {
  attemptQuestionId: string;
  position: number;
  stemDe: string;
  /** In the order shown to this student (attempt_questions.option_order). German text only. */
  options: { id: string; de: string }[];
};

export type StudentAttempt = {
  id: string;
  status: AttemptStatus;
  examSetName: string;
  deadlineAt: string;
  /** Database time when this was read; the client derives its clock skew from it. */
  serverNow: string;
  questions: ExamQuestion[];
  /** attempt_question_id -> chosen option id */
  answers: Record<string, string>;
};

/** The student's open (unexpired) attempt for the exam set, submitting an expired one first. */
export async function findOpenAttemptId(studentId: string, examSetId: string): Promise<string | null> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("attempts")
    .select("id")
    .eq("student_id", studentId)
    .eq("exam_set_id", examSetId)
    .eq("status", "in_progress")
    .maybeSingle<{ id: string }>();
  if (error) throw toError(error, "Could not read attempts");
  if (!data) return null;
  // Lazy expiry: an expired attempt is submitted now and no longer counts as open.
  if (await expireIfDue(data.id)) return null;
  return data.id;
}

/** Submits the attempt if its deadline has passed (database time). Returns true if it closed it. */
async function expireIfDue(attemptId: string): Promise<boolean> {
  const db = createAdminClient();
  const { data, error } = await db.rpc("close_attempt", { p_attempt_id: attemptId, p_only_if_expired: true });
  if (error) throw toError(error, "Could not expire attempt");
  if (data === true) await finalizeAttempt(attemptId);
  return data === true;
}

export async function startAttempt(studentId: string, examSetId: string): Promise<{ attemptId: string }> {
  const existing = await findOpenAttemptId(studentId, examSetId);
  if (existing) return { attemptId: existing };

  const db = createAdminClient();
  const { data: set, error: setError } = await db
    .from("exam_sets")
    .select("question_count, topic_mix")
    .eq("id", examSetId)
    .maybeSingle<{ question_count: number; topic_mix: Record<string, number> | null }>();
  if (setError) throw toError(setError, "Could not read exam set");
  if (!set) throw new AttemptError("exam_set_not_found");

  const { data: grant, error: grantError } = await db
    .from("attempt_grants")
    .select("id")
    .eq("student_id", studentId)
    .eq("exam_set_id", examSetId)
    .is("used_attempt_id", null)
    .limit(1);
  if (grantError) throw toError(grantError, "Could not read grants");
  if (!grant?.length) throw new AttemptError("no_grant");

  const pool = await fetchAll(
    (from, to) =>
      db
        .from("questions")
        .select("id, topic, difficulty, options, status, points")
        .eq("exam_set_id", examSetId)
        .eq("status", "approved")
        .order("id")
        .range(from, to),
    "Could not read questions",
  );

  // Seen = every question of this exam set in any earlier attempt of this student.
  const seen = await fetchAll(
    (from, to) =>
      db
        .from("attempt_questions")
        .select("id, question_id, attempts!inner(student_id), questions!inner(exam_set_id)")
        .eq("attempts.student_id", studentId)
        .eq("questions.exam_set_id", examSetId)
        .order("id")
        .range(from, to),
    "Could not read seen questions",
  );

  const questions: Question[] = pool.map((q) => ({
    id: q.id,
    examSetId,
    topic: q.topic,
    difficulty: q.difficulty,
    stemDe: "",
    stemEn: "",
    options: q.options as QuestionOption[],
    correctOptionId: "",
    points: q.points,
    status: q.status,
  }));
  const topicMix = set.topic_mix && Object.keys(set.topic_mix).length > 0 ? set.topic_mix : undefined;

  let draw;
  try {
    draw = drawPaper({
      pool: questions,
      seenIds: new Set(seen.map((s) => s.question_id as string)),
      count: set.question_count,
      topicMix,
      rng: secureRandom,
    });
  } catch (e) {
    if (e instanceof InsufficientPoolError) throw new AttemptError("insufficient_pool");
    throw e;
  }

  const { data: attemptId, error } = await db.rpc("start_attempt", {
    p_student_id: studentId,
    p_exam_set_id: examSetId,
    p_draw: draw.map((d) => ({ question_id: d.questionId, option_order: d.optionOrder })),
  });
  if (error) {
    // A concurrent start (double click, second tab) may have won; hand back its attempt.
    if (error.message === "no_grant" || error.message === "in_progress") {
      const winner = await findOpenAttemptId(studentId, examSetId);
      if (winner) return { attemptId: winner };
    }
    throw toError(error, "Could not start attempt");
  }
  return { attemptId: attemptId as string };
}

/**
 * The student's own attempt with its stored paper (resume), or null if it is not theirs.
 * Never includes correct answers or points. Submits the attempt first if it has expired.
 */
export async function getAttemptForStudent(studentId: string, attemptId: string): Promise<StudentAttempt | null> {
  if (!isUuid(attemptId)) return null;
  const db = createAdminClient();
  const read = () =>
    db
      .from("attempts")
      .select("id, status, deadline_at, exam_sets(name)")
      .eq("id", attemptId)
      .eq("student_id", studentId)
      .maybeSingle<{ id: string; status: AttemptStatus; deadline_at: string; exam_sets: { name: string } }>();

  let { data: attempt, error } = await read();
  if (error) throw toError(error, "Could not read attempt");
  if (!attempt) return null;
  if (attempt.status === "in_progress" && (await expireIfDue(attempt.id))) {
    ({ data: attempt, error } = await read());
    if (error) throw toError(error, "Could not read attempt");
    if (!attempt) return null;
  }

  const { data: rows, error: qError } = await db
    .from("attempt_questions")
    .select("id, position, option_order, questions(stem_de, options)")
    .eq("attempt_id", attempt.id)
    .order("position");
  if (qError) throw toError(qError, "Could not read questions");
  const paper = (rows ?? []) as unknown as {
    id: string;
    position: number;
    option_order: string[];
    questions: { stem_de: string; options: QuestionOption[] };
  }[];

  const questions: ExamQuestion[] = paper.map((r) => ({
    attemptQuestionId: r.id,
    position: r.position,
    stemDe: r.questions.stem_de,
    options: r.option_order.map((id) => ({
      id,
      de: r.questions.options.find((o) => o.id === id)?.de ?? "",
    })),
  }));

  const answers: Record<string, string> = {};
  if (paper.length) {
    const { data: saved, error: aError } = await db
      .from("answers")
      .select("attempt_question_id, option_id")
      .in(
        "attempt_question_id",
        paper.map((r) => r.id),
      );
    if (aError) throw toError(aError, "Could not read answers");
    for (const a of saved ?? []) answers[a.attempt_question_id] = a.option_id;
  }

  const { data: now, error: nowError } = await db.rpc("db_now");
  if (nowError) throw toError(nowError, "Could not read the database clock");

  return {
    id: attempt.id,
    status: attempt.status,
    examSetName: attempt.exam_sets.name,
    deadlineAt: new Date(attempt.deadline_at).toISOString(),
    serverNow: new Date(now as string).toISOString(),
    questions,
    answers,
  };
}

/** Status of the student's own attempt, or null if it is not theirs. Lightweight ownership check. */
export async function getAttemptStatus(studentId: string, attemptId: string): Promise<AttemptStatus | null> {
  if (!isUuid(attemptId)) return null;
  const db = createAdminClient();
  const { data, error } = await db
    .from("attempts")
    .select("status")
    .eq("id", attemptId)
    .eq("student_id", studentId)
    .maybeSingle<{ status: AttemptStatus }>();
  if (error) throw toError(error, "Could not read attempt");
  return data?.status ?? null;
}

export async function saveAnswer(
  studentId: string,
  attemptId: string,
  attemptQuestionId: string,
  optionId: string,
): Promise<void> {
  const db = createAdminClient();
  const { error } = await db.rpc("save_answer", {
    p_student_id: studentId,
    p_attempt_id: attemptId,
    p_attempt_question_id: attemptQuestionId,
    p_option_id: optionId,
  });
  if (!error) return;
  // Lazy expiry: the save arrived after the deadline, so submit what was saved in time.
  if (error.message === "deadline_passed") await expireIfDue(attemptId);
  throw toError(error, "Could not save answer");
}

/**
 * Scores a submitted attempt that has no score yet, with the questions' points and answer key
 * as they are now, counting only answers saved before the deadline. Safe to call repeatedly.
 */
async function finalizeAttempt(attemptId: string): Promise<void> {
  const db = createAdminClient();
  const { data: attempt, error } = await db
    .from("attempts")
    .select("status, points, deadline_at, exam_set_id, exam_sets(pass_mark_percent)")
    .eq("id", attemptId)
    .maybeSingle<{
      status: AttemptStatus;
      points: number | null;
      deadline_at: string;
      exam_set_id: string;
      exam_sets: { pass_mark_percent: number };
    }>();
  if (error) throw toError(error, "Could not read attempt");
  if (!attempt || attempt.status !== "submitted" || attempt.points !== null) return;

  const { data: rows, error: qError } = await db
    .from("attempt_questions")
    .select("id, questions(id, topic, difficulty, stem_de, stem_en, options, correct_option_id, points, status)")
    .eq("attempt_id", attemptId);
  if (qError) throw toError(qError, "Could not read questions");
  const paper = (rows ?? []) as unknown as {
    id: string;
    questions: {
      id: string;
      topic: string;
      difficulty: string;
      stem_de: string;
      stem_en: string;
      options: QuestionOption[];
      correct_option_id: string;
      points: number;
      status: Question["status"];
    };
  }[];

  const chosen: Record<string, string | null> = {};
  if (paper.length) {
    const { data: saved, error: aError } = await db
      .from("answers")
      .select("attempt_question_id, option_id")
      .in(
        "attempt_question_id",
        paper.map((r) => r.id),
      )
      .lte("saved_at", attempt.deadline_at);
    if (aError) throw toError(aError, "Could not read answers");
    const byAq = new Map((saved ?? []).map((a) => [a.attempt_question_id as string, a.option_id as string]));
    for (const r of paper) chosen[r.questions.id] = byAq.get(r.id) ?? null;
  }

  const questions: Question[] = paper.map(({ questions: q }) => ({
    id: q.id,
    examSetId: attempt.exam_set_id,
    topic: q.topic,
    difficulty: q.difficulty,
    stemDe: q.stem_de,
    stemEn: q.stem_en,
    options: q.options,
    correctOptionId: q.correct_option_id,
    points: q.points,
    status: q.status,
  }));
  const result = scoreAttempt(questions, chosen, attempt.exam_sets.pass_mark_percent);

  const { error: scoreError } = await db.rpc("record_score", {
    p_attempt_id: attemptId,
    p_points: result.points,
    p_max_points: result.max,
    p_passed: result.passed,
  });
  if (scoreError) throw toError(scoreError, "Could not record score");
  // For sets without held results record_score has already released the attempt and set the
  // assignment outcome in the same transaction (release_attempt, migration 0005).
}

/** Submits the attempt (idempotent) and scores it once. Releases at once only for non-held sets. */
export async function submitAttempt(attemptId: string): Promise<void> {
  const db = createAdminClient();
  const { error } = await db.rpc("close_attempt", { p_attempt_id: attemptId, p_only_if_expired: false });
  if (error) throw toError(error, "Could not submit attempt");
  await finalizeAttempt(attemptId);
}

/** Submits every in-progress attempt past its deadline. Returns how many it submitted. */
export async function sweepExpired(): Promise<number> {
  const db = createAdminClient();
  const { data: closed, error } = await db.rpc("close_expired_attempts");
  if (error) throw toError(error, "Could not sweep attempts");

  // Score the ones just closed plus any submitted attempt left unscored by an interrupted submit.
  const pending = await fetchAll(
    (from, to) => db.from("attempts").select("id").eq("status", "submitted").is("points", null).order("id").range(from, to),
    "Could not read unscored attempts",
  );
  // One failing attempt must not stop the rest; it stays unscored and is retried next sweep.
  for (const { id } of pending) {
    try {
      await finalizeAttempt(id);
    } catch (e) {
      console.error(`sweepExpired: could not score attempt ${id}`, e);
    }
  }

  return (closed as string[] | null)?.length ?? 0;
}
