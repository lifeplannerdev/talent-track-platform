import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAll, isUuid } from "@/lib/attempts";
import type { QuestionOption, QuestionStatus } from "@/lib/types";
import type { TopicMix } from "@/lib/exam-set-fields";
import { canFillPaper } from "@/lib/exam-set-choice";
import { effectiveStatus } from "@/lib/staff-overview-core";
import { rowToDetails, type StudentDetails } from "@/lib/student-details";

// Readers for the staff management pages (students, curriculums, exam sets, questions). They use
// the staff session (reads are scoped by role through RLS: admin sees all, a trainer only their own students); callers authenticate with requireRole('staff').

type AssignmentStatus = "open" | "passed" | "blocked";

export type StudentListRow = {
  id: string;
  username: string;
  fullName: string;
  batch: string | null;
  track: string | null;
  /** The student's trainer (name; null = none, or not readable by this session). */
  trainerName: string | null;
  /** Per curriculum: the stored status and the effective one staff see (same rule as the Blocked page). */
  assignments: { name: string; status: AssignmentStatus; effectiveStatus: AssignmentStatus; position: number }[];
};

export type StudentFilters = { q?: string; batch?: string; track?: string };

export async function listStudents(filters: StudentFilters): Promise<{ rows: StudentListRow[]; batches: string[] }> {
  const db = await createClient();
  const [profiles, staffProfiles, assignments, examSets, attempts] = await Promise.all([
    fetchAll(
      (from, to) =>
        db
          .from("profiles")
          .select("id, username, full_name, batch, track, trainer_id")
          .eq("role", "student")
          .order("username")
          .range(from, to),
      "Could not read students",
    ),
    // Only an admin can read other staff profiles (RLS); a trainer gets just their own row here.
    fetchAll(
      (from, to) => db.from("profiles").select("id, username, full_name").in("role", ["admin", "trainer"]).order("id").range(from, to),
      "Could not read trainers",
    ),
    fetchAll(
      (from, to) =>
        db
          .from("assignments")
          .select("id, student_id, curriculum_id, position, status, extra_attempts, curriculums(name, max_attempts)")
          .order("id")
          .range(from, to),
      "Could not read assignments",
    ),
    fetchAll((from, to) => db.from("exam_sets").select("id, curriculum_id").order("id").range(from, to), "Could not read exam sets"),
    fetchAll(
      (from, to) => db.from("attempts").select("id, student_id, exam_set_id, status, points").order("id").range(from, to),
      "Could not read attempts",
    ),
  ]);
  const curriculumOfSet = new Map(examSets.map((s) => [s.id as string, s.curriculum_id as string]));
  // Per student and curriculum: attempts used (submitted or released) and whether one is still running or unscored.
  const tally = new Map<string, { used: number; busy: boolean }>();
  for (const t of attempts as { student_id: string; exam_set_id: string; status: string; points: number | null }[]) {
    const key = `${t.student_id}:${curriculumOfSet.get(t.exam_set_id)}`;
    const v = tally.get(key) ?? { used: 0, busy: false };
    if (t.status === "submitted" || t.status === "released") v.used += 1;
    if (t.status === "in_progress" || (t.status === "submitted" && t.points === null)) v.busy = true;
    tally.set(key, v);
  }
  const byStudent = new Map<string, StudentListRow["assignments"]>();
  for (const a of assignments as unknown as {
    student_id: string;
    curriculum_id: string;
    position: number;
    status: AssignmentStatus;
    extra_attempts: number;
    curriculums: { name: string; max_attempts: number } | null;
  }[]) {
    const list = byStudent.get(a.student_id) ?? [];
    const t = tally.get(`${a.student_id}:${a.curriculum_id}`) ?? { used: 0, busy: false };
    const allowance = (a.curriculums?.max_attempts ?? 0) + (a.extra_attempts ?? 0);
    list.push({
      name: a.curriculums?.name ?? "",
      status: a.status,
      effectiveStatus: effectiveStatus(a.status, t.used, allowance, t.busy),
      position: a.position,
    });
    byStudent.set(a.student_id, list);
  }
  const batches = [...new Set(profiles.map((p) => p.batch as string | null).filter((b): b is string => Boolean(b)))].sort();
  const trainerNames = new Map(
    staffProfiles.map((t) => [t.id as string, ((t.full_name as string | null) ?? (t.username as string)) as string]),
  );
  const q = (filters.q ?? "").trim().toLowerCase();
  const rows = profiles
    .map((p) => ({
      id: p.id as string,
      username: p.username as string,
      fullName: (p.full_name as string | null) ?? p.username,
      batch: p.batch as string | null,
      track: p.track as string | null,
      trainerName: trainerNames.get(p.trainer_id as string) ?? null,
      assignments: (byStudent.get(p.id) ?? []).sort((x, y) => x.position - y.position),
    }))
    .filter((r) => !q || r.username.includes(q) || r.fullName.toLowerCase().includes(q))
    .filter((r) => !filters.batch || r.batch === filters.batch)
    .filter((r) => !filters.track || r.track === filters.track);
  return { rows, batches };
}

export type StudentDetail = {
  id: string;
  username: string;
  fullName: string;
  batch: string | null;
  track: string | null;
  trainerId: string | null;
  /** The details row (null until the first save: older students have none). */
  details: StudentDetails | null;
  assignments: {
    curriculumId: string;
    name: string;
    position: number;
    /** The stored assignment status. */
    status: AssignmentStatus;
    /** What staff see (same rule as the Blocked page): open with every attempt used and nothing running = blocked. */
    effectiveStatus: AssignmentStatus;
    /** Attempts in this curriculum that count (submitted or released). */
    attemptsUsed: number;
    /** Every attempt in this curriculum, including one in progress. */
    attemptsTotal: number;
    /** Allowance: the curriculum's attempts per student plus this student's extra attempts. */
    maxAttempts: number;
    extraAttempts: number;
    allowance: number;
    allowRepeats: boolean;
    /** Exam sets of the curriculum the student has not had yet that can fill a paper (canFillPaper). */
    examSetsLeft: number;
    examSets: { id: string; name: string }[];
  }[];
  unassigned: { id: string; name: string }[];
  /** Every finished attempt (released = scored, submitted = still being scored), newest first, with the stored score. */
  results: {
    id: string;
    status: "submitted" | "released";
    curriculumName: string;
    examSetName: string;
    submittedAt: string | null;
    points: number | null;
    maxPoints: number | null;
    passed: boolean | null;
  }[];
};

export async function getStudentDetail(id: string): Promise<StudentDetail | null> {
  if (!isUuid(id)) return null;
  const db = await createClient();
  const { data: profile, error: pError } = await db
    .from("profiles")
    .select("id, username, full_name, batch, track, trainer_id")
    .eq("id", id)
    .eq("role", "student")
    .maybeSingle();
  if (pError) throw new Error(`Could not read the student: ${pError.message}`);
  if (!profile) return null;
  const { data: detailsRow, error: dError } = await db.from("student_details").select("*").eq("student_id", id).maybeSingle();
  if (dError) throw new Error("Could not read the student details");

  const [{ data: assignments, error: aError }, { data: curriculums, error: cError }, { data: attempts, error: tError }] = await Promise.all([
    db.from("assignments").select("curriculum_id, position, status, extra_attempts, allow_repeats").eq("student_id", id).order("position"),
    db.from("curriculums").select("id, name, max_attempts, exam_sets(id, name, created_at, question_count, topic_mix)").order("name"),
    db
      .from("attempts")
      .select("id, exam_set_id, status, submitted_at, points, max_points, passed")
      .eq("student_id", id)
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .order("id"),
  ]);
  if (aError || cError || tError) throw new Error("Could not read the student");

  type C = {
    id: string;
    name: string;
    max_attempts: number;
    exam_sets: { id: string; name: string; created_at: string; question_count: number; topic_mix: TopicMix | null }[];
  };
  const all = (curriculums ?? []) as C[];
  const curriculumOfSet = new Map<string, string>();
  const setInfo = new Map<string, { name: string; curriculumName: string }>();
  for (const c of all)
    for (const s of c.exam_sets) {
      curriculumOfSet.set(s.id, c.id);
      setInfo.set(s.id, { name: s.name, curriculumName: c.name });
    }
  const assigned = new Set((assignments ?? []).map((a) => a.curriculum_id as string));
  // Approved questions of the assigned curriculums' exam sets, for the canFillPaper rule (as on the Blocked page).
  const assignedSetIds = all.filter((c) => assigned.has(c.id)).flatMap((c) => c.exam_sets.map((s) => s.id));
  const approved = assignedSetIds.length
    ? await fetchAll(
        (from, to) =>
          db.from("questions").select("id, exam_set_id, topic").eq("status", "approved").in("exam_set_id", assignedSetIds).order("id").range(from, to),
        "Could not read questions",
      )
    : [];
  const topicsOf = (setId: string) => approved.filter((q) => q.exam_set_id === setId).map((q) => q.topic as string);

  return {
    id: profile.id,
    username: profile.username,
    fullName: profile.full_name ?? profile.username,
    batch: profile.batch,
    track: profile.track,
    trainerId: profile.trainer_id as string | null,
    details: detailsRow ? rowToDetails(detailsRow as Record<string, unknown>) : null,
    assignments: (assignments ?? []).map((a) => {
      const c = all.find((x) => x.id === a.curriculum_id);
      const mine = (attempts ?? []).filter((t) => curriculumOfSet.get(t.exam_set_id) === a.curriculum_id);
      const usedSets = new Set(mine.map((t) => t.exam_set_id as string));
      const maxAttempts = c?.max_attempts ?? 0;
      const extraAttempts = (a.extra_attempts as number) ?? 0;
      const attemptsUsed = mine.filter((t) => t.status === "submitted" || t.status === "released").length;
      // In progress, or submitted and still being scored: the outcome is not known yet.
      const busy = mine.some((t) => t.status === "in_progress" || (t.status === "submitted" && t.points === null));
      return {
        curriculumId: a.curriculum_id,
        name: c?.name ?? "",
        position: a.position,
        status: a.status as AssignmentStatus,
        effectiveStatus: effectiveStatus(a.status as AssignmentStatus, attemptsUsed, maxAttempts + extraAttempts, busy),
        attemptsUsed,
        attemptsTotal: mine.length,
        maxAttempts,
        extraAttempts,
        allowance: maxAttempts + extraAttempts,
        allowRepeats: a.allow_repeats === true,
        examSetsLeft: (c?.exam_sets ?? []).filter(
          (s) => !usedSets.has(s.id) && canFillPaper({ questionCount: s.question_count, topicMix: s.topic_mix }, topicsOf(s.id)),
        ).length,
        examSets: [...(c?.exam_sets ?? [])]
          .sort((x, y) => x.created_at.localeCompare(y.created_at))
          .map((s) => ({ id: s.id, name: s.name })),
      };
    }),
    unassigned: all.filter((c) => !assigned.has(c.id)).map((c) => ({ id: c.id, name: c.name })),
    results: (attempts ?? [])
      .filter((t) => t.status === "submitted" || t.status === "released")
      .map((t) => ({
        id: t.id as string,
        status: t.status as "submitted" | "released",
        curriculumName: setInfo.get(t.exam_set_id)?.curriculumName ?? "",
        examSetName: setInfo.get(t.exam_set_id)?.name ?? "",
        submittedAt: t.submitted_at as string | null,
        points: t.points as number | null,
        maxPoints: t.max_points as number | null,
        passed: t.passed as boolean | null,
      })),
  };
}

/** Active trainers for the admin's trainer picker (an admin session reads every profile). */
export async function listActiveTrainers(): Promise<{ id: string; name: string }[]> {
  const db = await createClient();
  const { data, error } = await db.from("profiles").select("id, username, full_name").eq("role", "trainer").eq("active", true).order("username");
  if (error) throw new Error(`Could not read trainers: ${error.message}`);
  return (data ?? []).map((t) => ({ id: t.id as string, name: (t.full_name as string | null) ?? (t.username as string) }));
}

export type ExamSetSummary = {
  id: string;
  curriculumId: string;
  curriculumName: string;
  name: string;
  questionCount: number;
  timeLimitMin: number;
  passMarkPercent: number;
  topicMix: TopicMix;
  reminderIntervalMin: number;
  approvedCount: number;
  draftCount: number;
  approvedTopics: { topic: string }[];
};

/** Every curriculum (with its attempts per student) with its exam sets and their question pool sizes. */
export async function listCurriculumsWithSets(): Promise<{ id: string; name: string; maxAttempts: number; examSets: ExamSetSummary[] }[]> {
  const db = await createClient();
  const [{ data: curriculums, error }, questions] = await Promise.all([
    db
      .from("curriculums")
      .select("id, name, max_attempts, exam_sets(id, name, question_count, time_limit_min, pass_mark_percent, topic_mix, reminder_interval_min, created_at)")
      .order("name"),
    fetchAll(
      (from, to) => db.from("questions").select("exam_set_id, status, topic").order("id").range(from, to),
      "Could not read questions",
    ),
  ]);
  if (error) throw new Error(`Could not read curriculums: ${error.message}`);
  type Row = {
    id: string;
    name: string;
    max_attempts: number;
    exam_sets: {
      id: string;
      name: string;
      question_count: number;
      time_limit_min: number;
      pass_mark_percent: number;
      topic_mix: TopicMix | null;
      reminder_interval_min: number;
      created_at: string;
    }[];
  };
  return ((curriculums ?? []) as Row[]).map((c) => ({
    id: c.id,
    name: c.name,
    maxAttempts: c.max_attempts,
    examSets: [...c.exam_sets]
      .sort((x, y) => x.created_at.localeCompare(y.created_at))
      .map((s) => {
        const qs = questions.filter((q) => q.exam_set_id === s.id);
        const approved = qs.filter((q) => q.status === "approved");
        return {
          id: s.id,
          curriculumId: c.id,
          curriculumName: c.name,
          name: s.name,
          questionCount: s.question_count,
          timeLimitMin: s.time_limit_min,
          passMarkPercent: s.pass_mark_percent,
          topicMix: s.topic_mix ?? {},
          reminderIntervalMin: s.reminder_interval_min,
          approvedCount: approved.length,
          draftCount: qs.length - approved.length,
          approvedTopics: approved.map((q) => ({ topic: q.topic as string })),
        };
      }),
  }));
}

export type StaffQuestion = {
  id: string;
  examSetId: string;
  topic: string;
  difficulty: string;
  stemDe: string;
  stemEn: string;
  options: QuestionOption[];
  correctOptionId: string;
  points: number;
  status: QuestionStatus;
  /** Drawn into at least one attempt (edits do not change stored results). */
  used: boolean;
};

export type QuestionFilters = { curriculum?: string; examSet?: string; status?: string; topic?: string };

export async function listQuestions(filters: QuestionFilters): Promise<{ questions: StaffQuestion[]; topics: string[] }> {
  const db = await createClient();
  let setIds: string[] | null = null;
  if (filters.examSet) setIds = isUuid(filters.examSet) ? [filters.examSet] : [];
  else if (filters.curriculum) {
    if (!isUuid(filters.curriculum)) setIds = [];
    else {
      const { data, error } = await db.from("exam_sets").select("id").eq("curriculum_id", filters.curriculum);
      if (error) throw new Error(`Could not read exam sets: ${error.message}`);
      setIds = (data ?? []).map((s) => s.id as string);
    }
  }
  if (setIds && setIds.length === 0) return { questions: [], topics: [] };

  const rows = await fetchAll((from, to) => {
    let query = db
      .from("questions")
      .select("id, exam_set_id, topic, difficulty, stem_de, stem_en, options, correct_option_id, points, status, attempt_questions(count)")
      .order("created_at")
      .order("id");
    if (setIds) query = query.in("exam_set_id", setIds);
    if (filters.status === "draft" || filters.status === "approved") query = query.eq("status", filters.status);
    return query.range(from, to);
  }, "Could not read questions");

  const topics = [...new Set(rows.map((r) => r.topic as string))].sort();
  const questions = rows
    .filter((r) => !filters.topic || r.topic === filters.topic)
    .map((r) => ({
      id: r.id as string,
      examSetId: r.exam_set_id as string,
      topic: r.topic as string,
      difficulty: r.difficulty as string,
      stemDe: r.stem_de as string,
      stemEn: r.stem_en as string,
      options: r.options as QuestionOption[],
      correctOptionId: r.correct_option_id as string,
      points: r.points as number,
      status: r.status as QuestionStatus,
      used: ((r.attempt_questions as { count: number }[] | null)?.[0]?.count ?? 0) > 0,
    }));
  return { questions, topics };
}

export async function getQuestion(id: string): Promise<StaffQuestion | null> {
  if (!isUuid(id)) return null;
  const db = await createClient();
  const { data: r, error } = await db
    .from("questions")
    .select("id, exam_set_id, topic, difficulty, stem_de, stem_en, options, correct_option_id, points, status, attempt_questions(count)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not read the question: ${error.message}`);
  if (!r) return null;
  return {
    id: r.id,
    examSetId: r.exam_set_id,
    topic: r.topic,
    difficulty: r.difficulty,
    stemDe: r.stem_de,
    stemEn: r.stem_en,
    options: r.options as QuestionOption[],
    correctOptionId: r.correct_option_id,
    points: r.points,
    status: r.status as QuestionStatus,
    used: ((r.attempt_questions as unknown as { count: number }[] | null)?.[0]?.count ?? 0) > 0,
  };
}
