import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "./attempts";

// Staff dashboard, Blocked page and grants page readers. They use the session client, so RLS
// decides: staff read everything (including students' marks); anyone else gets nothing.
// Callers still authenticate with requireRole('staff') first.
//
// "Attempts used" matches release_attempt (migration 0008): the student's attempts for the
// exam set with status 'submitted' or 'released'.

type Person = { full_name: string | null; username: string; batch: string | null } | null;
const nameOf = (p: Person) => p?.full_name || p?.username || "Unknown";

type AssignmentRow = {
  student_id: string;
  curriculum_id: string;
  status: "open" | "passed" | "blocked";
  student: Person;
  curriculums: { name: string } | null;
};
type ExamSetRow = { id: string; name: string; curriculum_id: string; max_attempts: number; created_at: string };
type AttemptRow = {
  id: string;
  student_id: string;
  exam_set_id: string;
  status: "in_progress" | "submitted" | "released";
  points: number | null;
  max_points: number | null;
  submitted_at: string | null;
};
type GrantRow = { student_id: string; exam_set_id: string };

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
  /** The five most recently failed blocked assignments (student and curriculum). */
  blockedPreview: BlockedStudent[];
};

async function load() {
  const supabase = await createClient();
  const [assignments, examSets, attempts, grants] = await Promise.all([
    fetchAll(
      (from, to) =>
        supabase
          .from("assignments")
          .select(
            "student_id, curriculum_id, status, student:profiles!assignments_student_id_fkey(full_name, username, batch), curriculums(name)",
          )
          .order("id")
          .range(from, to)
          .overrideTypes<AssignmentRow[], { merge: false }>(),
      "Could not read assignments",
    ),
    fetchAll(
      (from, to) =>
        supabase
          .from("exam_sets")
          .select("id, name, curriculum_id, max_attempts, created_at")
          .order("created_at")
          .order("id")
          .range(from, to)
          .overrideTypes<ExamSetRow[], { merge: false }>(),
      "Could not read exam sets",
    ),
    fetchAll(
      (from, to) =>
        supabase
          .from("attempts")
          .select("id, student_id, exam_set_id, status, points, max_points, submitted_at")
          .order("id")
          .range(from, to)
          .overrideTypes<AttemptRow[], { merge: false }>(),
      "Could not read attempts",
    ),
    fetchAll(
      (from, to) =>
        supabase
          .from("attempt_grants")
          .select("student_id, exam_set_id")
          .is("used_attempt_id", null)
          .order("id")
          .range(from, to)
          .overrideTypes<GrantRow[], { merge: false }>(),
      "Could not read grants",
    ),
  ]);
  return { supabase, assignments, examSets, attempts, grants };
}

type Loaded = Awaited<ReturnType<typeof load>>;

const key = (studentId: string, examSetId: string) => `${studentId}:${examSetId}`;

function attemptsUsedBy(attempts: AttemptRow[]) {
  const used = new Map<string, number>();
  for (const a of attempts) {
    if (a.status === "submitted" || a.status === "released") {
      used.set(key(a.student_id, a.exam_set_id), (used.get(key(a.student_id, a.exam_set_id)) ?? 0) + 1);
    }
  }
  return used;
}

function blockedFrom({ assignments, examSets, attempts }: Loaded): BlockedStudent[] {
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
  // Most recently failed first, then by name.
  return rows.sort(
    (x, y) =>
      (y.lastAttemptAt ?? "").localeCompare(x.lastAttemptAt ?? "") || x.studentName.localeCompare(y.studentName),
  );
}

/** Every blocked student (assignment status 'blocked'), most recently failed first. */
export async function listBlockedStudents(): Promise<BlockedStudent[]> {
  return blockedFrom(await load());
}

/**
 * Students who can be given an attempt now, one row per open assignment and exam set: no unused
 * grant, no attempt in progress and no held attempt awaiting release for that set.
 */
export async function listGrantable(): Promise<GrantableRow[]> {
  const { assignments, examSets, attempts, grants } = await load();
  const used = attemptsUsedBy(attempts);
  const granted = new Set(grants.map((g) => key(g.student_id, g.exam_set_id)));
  const busy = new Set(
    attempts.filter((a) => a.status === "in_progress" || a.status === "submitted").map((a) => key(a.student_id, a.exam_set_id)),
  );
  const rows: GrantableRow[] = [];
  for (const a of assignments) {
    if (a.status !== "open") continue;
    for (const s of examSets) {
      if (s.curriculum_id !== a.curriculum_id) continue;
      const k = key(a.student_id, s.id);
      if (granted.has(k) || busy.has(k)) continue;
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

export async function getDashboard(): Promise<Dashboard> {
  const loaded = await load();
  const { count, error } = await loaded.supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "student");
  if (error) throw new Error(`Could not count students: ${error.message}`);

  const byStatus = { open: 0, passed: 0, blocked: 0 };
  for (const status of ["open", "passed", "blocked"] as const) {
    byStatus[status] = new Set(loaded.assignments.filter((a) => a.status === status).map((a) => a.student_id)).size;
  }
  const blocked = blockedFrom(loaded);
  return {
    studentTotal: count ?? 0,
    byStatus,
    awaitingReview: loaded.attempts.filter((a) => a.status === "submitted").length,
    blockedTotal: byStatus.blocked,
    blockedPreview: blocked.slice(0, 5),
  };
}
