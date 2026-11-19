// Pure logic of the staff overview (dashboard, Blocked page, Extra attempts page). No database
// access here, so it is unit-tested on fixed input; src/lib/staff-overview.ts loads the rows.
//
// Spec change 1: the allowance is per curriculum and student (curriculums.max_attempts +
// assignments.extra_attempts); "attempts used" matches record_score (migration 0020): the
// student's attempts over all exam sets of the curriculum with status 'submitted' or 'released'.

import { canFillPaper } from "./exam-set-choice";

type Person = { full_name: string | null; username: string; batch: string | null } | null;
const nameOf = (p: Person) => p?.full_name || p?.username || "Unknown";

export type AssignmentRow = {
  student_id: string;
  curriculum_id: string;
  status: "open" | "passed" | "blocked";
  extra_attempts: number;
  allow_repeats: boolean;
  student: Person;
  curriculums: { name: string; max_attempts: number } | null;
};
export type ExamSetRow = {
  id: string;
  name: string;
  curriculum_id: string;
  created_at: string;
  question_count: number;
  topic_mix: Record<string, number> | null;
};
/** Approved questions only (their exam set and topic), for the canFillPaper rule. */
export type QuestionRow = { exam_set_id: string; topic: string };
export type AttemptRow = {
  id: string;
  student_id: string;
  exam_set_id: string;
  status: "in_progress" | "submitted" | "released";
  points: number | null;
  max_points: number | null;
  submitted_at: string | null;
};

export type OverviewInput = {
  assignments: AssignmentRow[];
  examSets: ExamSetRow[];
  attempts: AttemptRow[];
  questions: QuestionRow[];
};

export type BlockedStudent = {
  studentId: string;
  studentName: string;
  batch: string | null;
  curriculumId: string;
  curriculumName: string;
  attemptsUsed: number;
  /** curriculums.max_attempts + extra_attempts. */
  allowance: number;
  /** Exam sets of the curriculum the student has not had yet that can fill a paper. */
  examSetsLeft: number;
  /** Staff already allowed repeating exam sets for this student here. */
  allowRepeats: boolean;
  /** The exam set of the student's latest scored attempt in the curriculum ("" if none). */
  lastExamSetName: string;
  lastPoints: number | null;
  lastMaxPoints: number | null;
  lastAttemptAt: string | null;
};

export type ExtraAttemptRow = {
  studentId: string;
  studentName: string;
  batch: string | null;
  curriculumId: string;
  curriculumName: string;
  /** blocked: needs extra attempts; no_exam_sets_left: has attempts but every exam set was used. */
  reason: "blocked" | "no_exam_sets_left";
  attemptsUsed: number;
  allowance: number;
  examSetsLeft: number;
  allowRepeats: boolean;
};

export type Dashboard = {
  /** Every student profile. */
  studentTotal: number;
  /** Distinct students with at least one curriculum in that (effective) status. */
  byStatus: { open: number; passed: number; blocked: number };
  /** Distinct blocked students (same as byStatus.blocked). */
  blockedTotal: number;
  /** Up to five blocked students, once each (their most recently failed blocked curriculum). */
  blockedPreview: BlockedStudent[];
  /** Distinct students with attempts left in a curriculum but no unused exam set. */
  examSetsShort: number;
};

/** Per assignment: allowance, attempts used, unused exam sets, busy, effective status, last score. */
function facts({ examSets, attempts, questions }: OverviewInput, a: AssignmentRow) {
  const sets = examSets.filter((s) => s.curriculum_id === a.curriculum_id);
  const setIds = new Set(sets.map((s) => s.id));
  const mine = attempts.filter((t) => t.student_id === a.student_id && setIds.has(t.exam_set_id));
  const used = mine.filter((t) => t.status === "submitted" || t.status === "released").length;
  const allowance = (a.curriculums?.max_attempts ?? 0) + a.extra_attempts;
  const usedSets = new Set(mine.map((t) => t.exam_set_id));
  // Same rule as startAttempt and the student's card: only sets whose approved questions can fill a paper.
  const usable = sets.filter((s) =>
    canFillPaper(
      { questionCount: s.question_count, topicMix: s.topic_mix },
      questions.filter((q) => q.exam_set_id === s.id).map((q) => q.topic),
    ),
  );
  const examSetsLeft = usable.filter((s) => !usedSets.has(s.id)).length;
  // In progress, or submitted and still being scored: the outcome is not known yet.
  const busy = mine.some((t) => t.status === "in_progress" || (t.status === "submitted" && t.points === null));
  const status: AssignmentRow["status"] =
    a.status === "open" && used >= allowance && !busy ? "blocked" : a.status;
  const last = mine
    .filter((t) => t.points !== null)
    .sort((x, y) => (y.submitted_at ?? "").localeCompare(x.submitted_at ?? ""))[0];
  return { used, allowance, examSetsLeft, usableSets: usable.length, busy, status, last, sets };
}

/** Blocked assignments (status 'blocked', or open with no attempts left), latest failure first, then by name. */
export function blockedFrom(input: OverviewInput): BlockedStudent[] {
  const rows: BlockedStudent[] = [];
  for (const a of input.assignments) {
    const f = facts(input, a);
    if (f.status !== "blocked") continue;
    rows.push({
      studentId: a.student_id,
      studentName: nameOf(a.student),
      batch: a.student?.batch ?? null,
      curriculumId: a.curriculum_id,
      curriculumName: a.curriculums?.name ?? "",
      attemptsUsed: f.used,
      allowance: f.allowance,
      examSetsLeft: f.examSetsLeft,
      allowRepeats: a.allow_repeats,
      lastExamSetName: f.sets.find((s) => s.id === f.last?.exam_set_id)?.name ?? "",
      lastPoints: f.last?.points ?? null,
      lastMaxPoints: f.last?.max_points ?? null,
      lastAttemptAt: f.last?.submitted_at ?? null,
    });
  }
  return rows.sort(
    (x, y) =>
      (y.lastAttemptAt ?? "").localeCompare(x.lastAttemptAt ?? "") || x.studentName.localeCompare(y.studentName),
  );
}

/**
 * Students who need staff for their next attempt, one row per curriculum: blocked (see
 * blockedFrom), or open with attempts left but no unused exam set that can fill a paper, and
 * repeats not allowed or no set usable at all (they see "contact your trainer"). Ordered by student name, then curriculum name.
 */
export function extraAttemptCandidatesFrom(input: OverviewInput): ExtraAttemptRow[] {
  const rows: ExtraAttemptRow[] = [];
  for (const a of input.assignments) {
    const f = facts(input, a);
    let reason: ExtraAttemptRow["reason"] | null = null;
    if (f.status === "blocked") reason = "blocked";
    else if (
      f.status === "open" &&
      !f.busy &&
      f.used < f.allowance &&
      f.examSetsLeft === 0 &&
      (!a.allow_repeats || f.usableSets === 0)
    ) {
      reason = "no_exam_sets_left";
    }
    if (!reason) continue;
    rows.push({
      studentId: a.student_id,
      studentName: nameOf(a.student),
      batch: a.student?.batch ?? null,
      curriculumId: a.curriculum_id,
      curriculumName: a.curriculums?.name ?? "",
      reason,
      attemptsUsed: f.used,
      allowance: f.allowance,
      examSetsLeft: f.examSetsLeft,
      allowRepeats: a.allow_repeats,
    });
  }
  return rows.sort((x, y) => x.studentName.localeCompare(y.studentName) || x.curriculumName.localeCompare(y.curriculumName));
}

export function summarizeDashboard(input: OverviewInput & { studentTotal: number }): Dashboard {
  const byStatus = { open: 0, passed: 0, blocked: 0 };
  const effective = input.assignments.map((a) => ({ student: a.student_id, status: facts(input, a).status }));
  for (const status of ["open", "passed", "blocked"] as const) {
    byStatus[status] = new Set(effective.filter((a) => a.status === status).map((a) => a.student)).size;
  }
  const seen = new Set<string>();
  const preview: BlockedStudent[] = [];
  for (const b of blockedFrom(input)) {
    if (seen.has(b.studentId)) continue;
    seen.add(b.studentId);
    preview.push(b);
    if (preview.length === 5) break;
  }
  const short = extraAttemptCandidatesFrom(input).filter((r) => r.reason === "no_exam_sets_left");
  return {
    studentTotal: input.studentTotal,
    byStatus,
    blockedTotal: byStatus.blocked,
    blockedPreview: preview,
    examSetsShort: new Set(short.map((r) => r.studentId)).size,
  };
}
