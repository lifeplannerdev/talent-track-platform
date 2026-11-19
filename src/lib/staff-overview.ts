import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "./attempts";
import {
  blockedFrom,
  extraAttemptCandidatesFrom,
  summarizeDashboard,
  type AssignmentRow,
  type AttemptRow,
  type BlockedStudent,
  type Dashboard,
  type ExamSetRow,
  type ExtraAttemptRow,
} from "./staff-overview-core";

export type { BlockedStudent, Dashboard, ExtraAttemptRow } from "./staff-overview-core";

// Staff dashboard, Blocked page and Extra attempts page readers. They use the session client, so
// RLS decides: staff read everything (including students' marks); anyone else gets nothing.
// Callers still authenticate with requireRole('staff') first. The logic is in staff-overview-core.

async function load() {
  const supabase = await createClient();
  const [assignments, examSets, attempts] = await Promise.all([
    fetchAll(
      (from, to) =>
        supabase
          .from("assignments")
          .select(
            "student_id, curriculum_id, status, extra_attempts, allow_repeats, " +
              "student:profiles!assignments_student_id_fkey(full_name, username, batch), curriculums(name, max_attempts)",
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
          .select("id, name, curriculum_id, created_at")
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
  ]);
  return { supabase, input: { assignments, examSets, attempts } };
}

/** Every blocked student (status 'blocked', or open with no attempts left), most recently failed first. */
export async function listBlockedStudents(): Promise<BlockedStudent[]> {
  return blockedFrom((await load()).input);
}

/** Students who need extra attempts: blocked, or short of unused exam sets (see extraAttemptCandidatesFrom). */
export async function listExtraAttemptCandidates(): Promise<ExtraAttemptRow[]> {
  return extraAttemptCandidatesFrom((await load()).input);
}

export async function getDashboard(): Promise<Dashboard> {
  const { supabase, input } = await load();
  const { count, error } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "student");
  if (error) throw new Error(`Could not count students: ${error.message}`);
  return summarizeDashboard({ ...input, studentTotal: count ?? 0 });
}
