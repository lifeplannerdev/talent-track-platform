import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { drawPaper, InsufficientPoolError } from "./draw";
import { canFillPaper, chooseExamSet } from "./exam-set-choice";
import { scoreAttempt } from "./scoring";
import type { Question, QuestionOption } from "./types";

// Attempt lifecycle. Every function here runs with the service role and must only be
// called from server code that has authenticated the student (requireRole) and passes the
// session's user id. The atomic writes live in SQL functions (migration 0004); the deadline
// is always checked with database time.

/** Refusals of saving and submitting (raised by save_answer / close_attempt). */
export type AttemptErrorCode = "not_found" | "closed" | "deadline_passed" | "invalid_option";

const SQL_CODES = new Set<string>(["not_found", "closed", "deadline_passed", "invalid_option"]);

export class AttemptError extends Error {
  code: AttemptErrorCode;
  constructor(code: AttemptErrorCode) {
    super(code);
    this.name = "AttemptError";
    this.code = code;
  }
}

/**
 * Why a new attempt cannot start (startAttempt):
 *   not_open          the curriculum is not assigned to the student
 *   blocked / passed  the assignment status
 *   in_progress       another start won a race (one exam at a time per curriculum)
 *   calculating       an earlier attempt is submitted but not scored yet (start_attempt's
 *                     scoring_pending; scoring it is retried on the next read or sweep)
 *   no_attempts_left  attempts used >= curriculum max_attempts + extra_attempts
 *   exam_set_used     the chosen exam set was taken meanwhile (repeats not allowed)
 *   unavailable       no exam set can be given (all used without allow_repeats, none with
 *                     enough approved questions, or too few unseen questions in the chosen one)
 */
export type StartErrorCode =
  | "not_open"
  | "blocked"
  | "passed"
  | "in_progress"
  | "calculating"
  | "no_attempts_left"
  | "exam_set_used"
  | "unavailable";

export class StartError extends Error {
  code: StartErrorCode;
  constructor(code: StartErrorCode) {
    super(code);
    this.name = "StartError";
    this.code = code;
  }
}

/** start_attempt's refusals (migration 0020) as StartError codes. */
const START_CODES: Record<string, StartErrorCode> = {
  not_open: "not_open",
  blocked: "blocked",
  passed: "passed",
  in_progress: "in_progress",
  scoring_pending: "calculating",
  no_attempts_left: "no_attempts_left",
  exam_set_used: "exam_set_used",
  // Staff changed the exam set or its questions between our read and the start.
  exam_set_not_found: "unavailable",
  invalid_draw: "unavailable",
  question_already_seen: "unavailable",
};

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
export async function fetchAll<T>(
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
  /** When the attempt started; with deadlineAt it gives the full duration for the reminders. */
  startedAt: string;
  deadlineAt: string;
  /** Minutes between time reminders (exam_sets.reminder_interval_min); 0 = off. */
  reminderIntervalMin: number;
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

/** One of the student's attempts with its curriculum, as read after settleAttempts. */
export type SettledAttempt = {
  id: string;
  examSetId: string;
  curriculumId: string;
  status: AttemptStatus;
  startedAt: string;
  submittedAt: string | null;
  points: number | null;
  maxPoints: number | null;
  passed: boolean | null;
};

type AttemptListRow = {
  id: string;
  exam_set_id: string;
  status: AttemptStatus;
  started_at: string;
  submitted_at: string | null;
  points: number | null;
  max_points: number | null;
  passed: boolean | null;
  exam_sets: { curriculum_id: string };
};

async function readAttempts(studentId: string, curriculumId?: string): Promise<SettledAttempt[]> {
  const db = createAdminClient();
  const rows = await fetchAll((from, to) => {
    let q = db
      .from("attempts")
      .select("id, exam_set_id, status, started_at, submitted_at, points, max_points, passed, exam_sets!inner(curriculum_id)")
      .eq("student_id", studentId);
    if (curriculumId) q = q.eq("exam_sets.curriculum_id", curriculumId);
    return q.order("started_at").order("id").range(from, to).overrideTypes<AttemptListRow[], { merge: false }>();
  }, "Could not read attempts");
  return rows.map((a) => ({
    id: a.id,
    examSetId: a.exam_set_id,
    curriculumId: a.exam_sets.curriculum_id,
    status: a.status,
    startedAt: a.started_at,
    submittedAt: a.submitted_at,
    points: a.points,
    maxPoints: a.max_points,
    passed: a.passed,
  }));
}

/**
 * The student's attempts (in one curriculum, or all), oldest first, after healing them: an
 * expired in-progress attempt is submitted and scored (lazy expiry), and a submitted attempt
 * without a score (a submit interrupted between close and score) is scored now. A failure to
 * score is logged and leaves the attempt 'submitted' (shown as "being calculated"); the next
 * read or the daily sweep retries it. After any failure the rows are read again, so a step that
 * closed an attempt before scoring failed is reported as submitted, never as still in progress.
 * studentId must come from the session (or be staff-chosen).
 */
export async function settleAttempts(studentId: string, curriculumId?: string): Promise<SettledAttempt[]> {
  const before = await readAttempts(studentId, curriculumId);
  let changed = false;
  for (const a of before) {
    try {
      if (a.status === "in_progress") changed = (await expireIfDue(a.id)) || changed;
      else if (a.status === "submitted") {
        await finalizeAttempt(a.id);
        changed = true;
      }
    } catch (e) {
      console.error(`settleAttempts: could not settle attempt ${a.id}`, e);
      // The close may have succeeded before scoring failed: read the attempts again.
      changed = true;
    }
  }
  return changed ? readAttempts(studentId, curriculumId) : before;
}

/**
 * Starts the student's next attempt in the curriculum, or returns the one in progress. The
 * exam set is chosen here (chooseExamSet: a random set the student has not used, or with
 * allow_repeats the least recently used one) among the sets whose approved questions can fill a
 * paper; the paper is drawn with drawPaper (unseen questions first; seen ones only with
 * allow_repeats). start_attempt (migration 0020) re-checks everything under the assignment lock.
 * Throws StartError (see StartErrorCode). studentId must be the session user.
 */
export async function startAttempt(studentId: string, curriculumId: string): Promise<{ attemptId: string }> {
  if (!isUuid(studentId) || !isUuid(curriculumId)) throw new StartError("not_open");
  const attempts = await settleAttempts(studentId, curriculumId);
  const open = attempts.find((a) => a.status === "in_progress");
  if (open) return { attemptId: open.id };

  const db = createAdminClient();
  const { data: assignment, error: aError } = await db
    .from("assignments")
    .select("status, extra_attempts, allow_repeats, curriculums(max_attempts)")
    .eq("student_id", studentId)
    .eq("curriculum_id", curriculumId)
    .maybeSingle<{
      status: "open" | "passed" | "blocked";
      extra_attempts: number;
      allow_repeats: boolean;
      curriculums: { max_attempts: number };
    }>();
  if (aError) throw toError(aError, "Could not read the assignment");
  if (!assignment) throw new StartError("not_open");
  if (assignment.status === "blocked") throw new StartError("blocked");
  if (assignment.status === "passed") throw new StartError("passed");
  if (attempts.some((a) => a.status === "submitted")) throw new StartError("calculating");
  const used = attempts.filter((a) => a.status === "released").length;
  if (used >= assignment.curriculums.max_attempts + assignment.extra_attempts) throw new StartError("no_attempts_left");

  const { data: sets, error: setsError } = await db
    .from("exam_sets")
    .select("id, question_count, topic_mix")
    .eq("curriculum_id", curriculumId)
    .order("created_at")
    .order("id")
    .returns<{ id: string; question_count: number; topic_mix: Record<string, number> | null }[]>();
  if (setsError) throw toError(setsError, "Could not read exam sets");
  const setIds = (sets ?? []).map((s) => s.id);
  const pool = setIds.length
    ? await fetchAll(
        (from, to) =>
          db
            .from("questions")
            .select("id, exam_set_id, topic, difficulty, options, status, points")
            .in("exam_set_id", setIds)
            .eq("status", "approved")
            .order("id")
            .range(from, to),
        "Could not read questions",
      )
    : [];

  const lastUsed = new Map<string, string>();
  for (const a of attempts) {
    const prev = lastUsed.get(a.examSetId);
    if (!prev || a.startedAt > prev) lastUsed.set(a.examSetId, a.startedAt);
  }
  const usable = (sets ?? []).filter((s) =>
    canFillPaper(
      { questionCount: s.question_count, topicMix: s.topic_mix },
      pool.filter((q) => q.exam_set_id === s.id).map((q) => q.topic as string),
    ),
  );
  const chosenId = chooseExamSet(
    usable.map((s) => ({ id: s.id, lastUsedAt: lastUsed.get(s.id) ?? null })),
    new Set(lastUsed.keys()),
    assignment.allow_repeats,
    secureRandom,
  );
  const chosen = usable.find((s) => s.id === chosenId);
  if (!chosen) throw new StartError("unavailable");

  // Seen = every question of the chosen exam set in any earlier attempt of this student.
  const seen = await fetchAll(
    (from, to) =>
      db
        .from("attempt_questions")
        .select("id, question_id, attempts!inner(student_id), questions!inner(exam_set_id)")
        .eq("attempts.student_id", studentId)
        .eq("questions.exam_set_id", chosen.id)
        .order("id")
        .range(from, to),
    "Could not read seen questions",
  );

  const questions: Question[] = pool
    .filter((q) => q.exam_set_id === chosen.id)
    .map((q) => ({
      id: q.id,
      examSetId: chosen.id,
      topic: q.topic,
      difficulty: q.difficulty,
      stemDe: "",
      stemEn: "",
      options: q.options as QuestionOption[],
      correctOptionId: "",
      points: q.points,
      status: q.status,
    }));
  const topicMix = chosen.topic_mix && Object.keys(chosen.topic_mix).length > 0 ? chosen.topic_mix : undefined;

  let draw;
  try {
    draw = drawPaper({
      pool: questions,
      seenIds: new Set(seen.map((s) => s.question_id as string)),
      count: chosen.question_count,
      topicMix,
      allowSeen: assignment.allow_repeats,
      rng: secureRandom,
    });
  } catch (e) {
    if (e instanceof InsufficientPoolError) throw new StartError("unavailable");
    throw e;
  }

  const { data: attemptId, error } = await db.rpc("start_attempt", {
    p_student_id: studentId,
    p_exam_set_id: chosen.id,
    p_draw: draw.map((d) => ({ question_id: d.questionId, option_order: d.optionOrder })),
  });
  if (error) {
    const code = START_CODES[error.message];
    if (code) throw new StartError(code);
    throw new Error(`Could not start attempt: ${error.message}`);
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
      .select("id, status, started_at, deadline_at, exam_sets(name, reminder_interval_min)")
      .eq("id", attemptId)
      .eq("student_id", studentId)
      .maybeSingle<{
        id: string;
        status: AttemptStatus;
        started_at: string;
        deadline_at: string;
        exam_sets: { name: string; reminder_interval_min: number };
      }>();

  let { data: attempt, error } = await read();
  if (error) throw toError(error, "Could not read attempt");
  if (!attempt) return null;
  // Lazy expiry, and scoring of an interrupted submit, so the result shows at once.
  if (attempt.status === "submitted") {
    try {
      await finalizeAttempt(attempt.id);
    } catch (e) {
      console.error(`getAttemptForStudent: could not score attempt ${attempt.id}`, e);
    }
  }
  if (attempt.status === "submitted" || (attempt.status === "in_progress" && (await expireIfDue(attempt.id)))) {
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
    startedAt: new Date(attempt.started_at).toISOString(),
    deadlineAt: new Date(attempt.deadline_at).toISOString(),
    reminderIntervalMin: attempt.exam_sets.reminder_interval_min,
    serverNow: new Date(now as string).toISOString(),
    questions,
    answers,
  };
}

/**
 * Scores the student's own attempt if it is submitted without a score (an interrupted submit),
 * so the result can be shown. A failure is logged and the attempt stays "being calculated".
 */
export async function scorePendingAttempt(studentId: string, attemptId: string): Promise<void> {
  if (!isUuid(studentId) || !isUuid(attemptId)) return;
  const status = await getAttemptStatus(studentId, attemptId);
  if (status !== "submitted") return;
  try {
    await finalizeAttempt(attemptId);
  } catch (e) {
    console.error(`scorePendingAttempt: could not score attempt ${attemptId}`, e);
  }
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
    .select("status, points, deadline_at, exam_set_id, pass_mark_percent, exam_sets(pass_mark_percent)")
    .eq("id", attemptId)
    .maybeSingle<{
      status: AttemptStatus;
      points: number | null;
      deadline_at: string;
      exam_set_id: string;
      /** Snapshot taken by start_attempt (0019); null only for legacy rows. */
      pass_mark_percent: number | null;
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
  // A paper without questions would score 0 of 0 (a "pass"): never score it. It stays submitted
  // (shown as being calculated everywhere) until someone repairs the data.
  if (paper.length === 0) {
    console.error(`finalizeAttempt: attempt ${attemptId} has no questions; not scored`);
    return;
  }

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
  const chosen: Record<string, string | null> = {};
  for (const r of paper) chosen[r.questions.id] = byAq.get(r.id) ?? null;

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
  // The pass mark in force when the attempt started (record_score checks the same value).
  const result = scoreAttempt(questions, chosen, attempt.pass_mark_percent ?? attempt.exam_sets.pass_mark_percent);

  const { error: scoreError } = await db.rpc("record_score", {
    p_attempt_id: attemptId,
    p_points: result.points,
    p_max_points: result.max,
    p_passed: result.passed,
    // Per-question snapshot of what was scored (key, points, topic as read now). Readers use
    // it so later question edits never contradict the stored total (migration 0007).
    p_questions: paper.map((r) => ({
      attempt_question_id: r.id,
      correct_option_id: r.questions.correct_option_id,
      max_points: r.questions.points,
      awarded_points: result.byQuestion[r.questions.id] ?? 0,
      topic: r.questions.topic,
    })),
  });
  if (scoreError) throw toError(scoreError, "Could not record score");
  // record_score has released the attempt and set the assignment outcome (passed, or blocked
  // after the last allowed failed attempt) in the same transaction (migration 0020).
}

/** What submitAttempt hands back: the stored result (released the moment it is scored). */
export type SubmitResult = {
  status: AttemptStatus;
  points: number | null;
  maxPoints: number | null;
  passed: boolean | null;
};

/**
 * Submits the attempt (idempotent) and scores it once; record_score releases it and decides
 * the assignment (passed, or blocked after the last allowed failed attempt) in the same
 * transaction. Returns the stored result. The caller checks ownership first.
 */
export async function submitAttempt(attemptId: string): Promise<SubmitResult> {
  const db = createAdminClient();
  const { error } = await db.rpc("close_attempt", { p_attempt_id: attemptId, p_only_if_expired: false });
  if (error) throw toError(error, "Could not submit attempt");
  await finalizeAttempt(attemptId);
  const { data, error: readError } = await db
    .from("attempts")
    .select("status, points, max_points, passed")
    .eq("id", attemptId)
    .single<{ status: AttemptStatus; points: number | null; max_points: number | null; passed: boolean | null }>();
  if (readError) throw toError(readError, "Could not read attempt");
  return { status: data.status, points: data.points, maxPoints: data.max_points, passed: data.passed };
}

/**
 * Submits every in-progress attempt past its deadline and scores (so releases) it, plus any
 * submitted attempt left unscored by an interrupted submit. Returns how many it submitted.
 */
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
