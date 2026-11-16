// Pure logic of the staff overview (dashboard, Blocked page, Give attempts page). No database
// access here, so it is unit-tested on fixed input; src/lib/staff-overview.ts loads the rows.
//
// "Attempts used" matches release_attempt (migration 0008): the student's attempts for the
// exam set with status 'submitted' or 'released'.

type Person = { full_name: string | null; username: string; batch: string | null } | null;
const nameOf = (p: Person) => p?.full_name || p?.username || "Unknown";

export type AssignmentRow = {
  student_id: string;
  curriculum_id: string;
  status: "open" | "passed" | "blocked";
  student: Person;
  curriculums: { name: string } | null;
};
export type ExamSetRow = { id: string; name: string; curriculum_id: string; max_attempts: number; created_at: string };
export type AttemptRow = {
  id: string;
  student_id: string;
  exam_set_id: string;
  status: "in_progress" | "submitted" | "released";
  points: number | null;
  max_points: number | null;
  submitted_at: string | null;
};
/** Unused grants only. */
export type GrantRow = { student_id: string; exam_set_id: string };

export type OverviewInput = {
  assignments: AssignmentRow[];
  examSets: ExamSetRow[];
  attempts: AttemptRow[];
  grants: GrantRow[];
};

export type BlockedStudent = {
  studentId: string;
  studentName: string;
  batch: string | null;
  curriculumId: string;
  curriculumName: string;
  /** The exam set of the student's latest scored attempt in the curriculum (else its first set). */
  examSetId: string | null;
  examSetName: string;
  attemptsUsed: number;
  maxAttempts: number | null;
  lastPoints: number | null;
  lastMaxPoints: number | null;
  lastAttemptAt: string | null;
};

export type GrantableRow = {
  studentId: string;
  studentName: string;
  batch: string | null;
  curriculumName: string;
  examSetId: string;
  examSetName: string;
  attemptsUsed: number;
  maxAttempts: number;
};

export type Dashboard = {
  /** Every student profile. */
  studentTotal: number;
  /** Distinct students with at least one assignment in that status. */
  byStatus: { open: number; passed: number; blocked: number };
  /** Submitted attempts not released yet (the review list). */
  awaitingReview: number;
  /** Distinct blocked students (same as byStatus.blocked). */
  blockedTotal: number;
  /** Up to five blocked students, once each (their most recently failed blocked curriculum). */
  blockedPreview: BlockedStudent[];
};

const key = (a: string, b: string) => `${a}:${b}`;

function attemptsUsedBy(attempts: AttemptRow[]) {
  const used = new Map<string, number>();
  for (const a of attempts) {
    if (a.status === "submitted" || a.status === "released") {
      const k = key(a.student_id, a.exam_set_id);
      used.set(k, (used.get(k) ?? 0) + 1);
    }
  }
  return used;
}

/** Every blocked assignment, most recently failed first, then by name. */
export function blockedFrom({ assignments, examSets, attempts }: OverviewInput): BlockedStudent[] {
  const used = attemptsUsedBy(attempts);
  const rows = assignments
    .filter((a) => a.status === "blocked")
    .map((a): BlockedStudent => {
      const sets = examSets.filter((s) => s.curriculum_id === a.curriculum_id);
      const setIds = new Set(sets.map((s) => s.id));
      const last = attempts
        .filter((t) => t.student_id === a.student_id && setIds.has(t.exam_set_id) && t.points !== null)
        .sort((x, y) => (y.submitted_at ?? "").localeCompare(x.submitted_at ?? ""))[0];
      const set = sets.find((s) => s.id === last?.exam_set_id) ?? sets[0];
      return {
        studentId: a.student_id,
        studentName: nameOf(a.student),
        batch: a.student?.batch ?? null,
        curriculumId: a.curriculum_id,
        curriculumName: a.curriculums?.name ?? "",
        examSetId: set?.id ?? null,
        examSetName: set?.name ?? "",
        attemptsUsed: set ? (used.get(key(a.student_id, set.id)) ?? 0) : 0,
        maxAttempts: set?.max_attempts ?? null,
        lastPoints: last?.points ?? null,
        lastMaxPoints: last?.max_points ?? null,
        lastAttemptAt: last?.submitted_at ?? null,
      };
    });
  return rows.sort(
    (x, y) =>
      (y.lastAttemptAt ?? "").localeCompare(x.lastAttemptAt ?? "") || x.studentName.localeCompare(y.studentName),
  );
}

/**
 * Students who can be given an attempt now, one row per open assignment and exam set. A whole
 * curriculum is hidden while the student has any attempt in it in progress or held (submitted,
 * not released), matching grant_attempt's per-curriculum guards; a set with an unused grant is
 * hidden too.
 */
export function grantableFrom({ assignments, examSets, attempts, grants }: OverviewInput): GrantableRow[] {
  const used = attemptsUsedBy(attempts);
  const curriculumOf = new Map(examSets.map((s) => [s.id, s.curriculum_id]));
  const granted = new Set(grants.map((g) => key(g.student_id, g.exam_set_id)));
  const busy = new Set(
    attempts
      .filter((a) => a.status === "in_progress" || a.status === "submitted")
      .map((a) => key(a.student_id, curriculumOf.get(a.exam_set_id) ?? "")),
  );
  const rows: GrantableRow[] = [];
  for (const a of assignments) {
    if (a.status !== "open" || busy.has(key(a.student_id, a.curriculum_id))) continue;
    for (const s of examSets) {
      if (s.curriculum_id !== a.curriculum_id) continue;
      const k = key(a.student_id, s.id);
      if (granted.has(k)) continue;
      rows.push({
        studentId: a.student_id,
        studentName: nameOf(a.student),
        batch: a.student?.batch ?? null,
        curriculumName: a.curriculums?.name ?? "",
        examSetId: s.id,
        examSetName: s.name,
        attemptsUsed: used.get(k) ?? 0,
        maxAttempts: s.max_attempts,
      });
    }
  }
  return rows.sort((x, y) => x.studentName.localeCompare(y.studentName) || x.examSetName.localeCompare(y.examSetName));
}

export function summarizeDashboard(input: OverviewInput & { studentTotal: number }): Dashboard {
  const byStatus = { open: 0, passed: 0, blocked: 0 };
  for (const status of ["open", "passed", "blocked"] as const) {
    byStatus[status] = new Set(input.assignments.filter((a) => a.status === status).map((a) => a.student_id)).size;
  }
  const seen = new Set<string>();
  const preview: BlockedStudent[] = [];
  for (const b of blockedFrom(input)) {
    if (seen.has(b.studentId)) continue;
    seen.add(b.studentId);
    preview.push(b);
    if (preview.length === 5) break;
  }
  return {
    studentTotal: input.studentTotal,
    byStatus,
    awaitingReview: input.attempts.filter((a) => a.status === "submitted").length,
    blockedTotal: byStatus.blocked,
    blockedPreview: preview,
  };
}
