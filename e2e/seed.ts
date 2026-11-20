import { createClient } from "@supabase/supabase-js";
import { usernameToEmail } from "../src/lib/auth/username";
import {
  BLOCK_CURRICULUM,
  BLOCK_OTHER_CURRICULUM,
  EXAM_CURRICULUM,
  EXAM_CURRICULUM_OPEN,
  EXAM_CURRICULUM_TWO,
  NEW_CURRICULUM_EMPTY,
  NEW_CURRICULUM_PASSED,
  NEW_CURRICULUM_READY,
  STAFF,
  STUDENT_BLOCK,
  STUDENT_CONSENTED,
  STUDENT_EXAM,
  STUDENT_EXAM_OPEN,
  STUDENT_NEW,
} from "./fixtures";

export function adminDb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const OPTIONS = [
  { id: "a", de: "Ja", en: "Yes" },
  { id: "b", de: "Nein", en: "No" },
  { id: "c", de: "Vielleicht", en: "Maybe" },
];
// Every key is "b" (Nein). Exam sets of one curriculum take consecutive stems.
const STEMS = [
  ["Ist Berlin die Hauptstadt von Frankreich?", "Is Berlin the capital of France?"],
  ["Hat eine Woche acht Tage?", "Does a week have eight days?"],
  ["Ist Wasser bei Raumtemperatur fest?", "Is water solid at room temperature?"],
  ["Ist der Mond aus Käse?", "Is the moon made of cheese?"],
  ["Hat ein Jahr dreizehn Monate?", "Does a year have thirteen months?"],
  ["Ist Schnee schwarz?", "Is snow black?"],
];

type SetSpec = { name: string; questionCount: number };
type CurriculumSpec = {
  name: string;
  /** Exam sets in order; each gets questionCount approved questions (next stems). */
  sets: SetSpec[];
  /** Without it the database default applies (90%, migration 0019). */
  passMarkPercent?: number;
  status?: "open" | "passed" | "blocked";
};

/** Deletes the curriculum by name (cascading its exam sets, questions, assignments) and builds it again. */
async function recreateCurriculum(spec: CurriculumSpec): Promise<string> {
  const db = adminDb();
  const { error: delError } = await db.from("curriculums").delete().eq("name", spec.name);
  if (delError) throw delError;
  const { data: curriculum, error: cError } = await db.from("curriculums").insert({ name: spec.name }).select("id").single();
  if (cError) throw cError;
  let next = 0;
  for (const s of spec.sets) {
    const { data: set, error: sError } = await db
      .from("exam_sets")
      .insert({
        curriculum_id: curriculum.id,
        name: s.name,
        question_count: s.questionCount,
        time_limit_min: 30,
        ...(spec.passMarkPercent === undefined ? {} : { pass_mark_percent: spec.passMarkPercent }),
      })
      .select("id")
      .single();
    if (sError) throw sError;
    const stems = STEMS.slice(next, next + s.questionCount);
    next += s.questionCount;
    const { error: qError } = await db.from("questions").insert(
      stems.map(([de, en]) => ({
        exam_set_id: set.id,
        topic: "allgemein",
        difficulty: "easy",
        stem_de: de,
        stem_en: en,
        options: OPTIONS,
        correct_option_id: "b",
        points: 1,
        status: "approved",
      })),
    );
    if (qError) throw qError;
  }
  return curriculum.id as string;
}

/** Recreates the e2e users, curriculums and assignments from scratch (idempotent). Uses the local service role. */
export async function seed() {
  const db = adminDb();

  const { data: list, error: listError } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw listError;
  const emails = [
    STAFF.email,
    ...[STUDENT_NEW, STUDENT_CONSENTED, STUDENT_EXAM, STUDENT_EXAM_OPEN, STUDENT_BLOCK].map((s) => usernameToEmail(s.username)),
  ];
  for (const u of list.users.filter((u) => u.email && emails.includes(u.email))) {
    const { error } = await db.auth.admin.deleteUser(u.id);
    if (error) throw error;
  }

  const create = async (email: string, password: string, meta: Record<string, string>) => {
    const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: meta });
    if (error) throw error;
    return data.user.id;
  };
  const student = async (s: { username: string; password: string; fullName: string }, consented: boolean) => {
    const id = await create(usernameToEmail(s.username), s.password, {
      role: "student",
      username: s.username,
      full_name: s.fullName,
    });
    if (consented) {
      const { error } = await db.from("profiles").update({ consent_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    }
    return id;
  };
  const assign = async (studentId: string, curriculums: CurriculumSpec[]) => {
    for (const [i, spec] of curriculums.entries()) {
      const curriculumId = await recreateCurriculum(spec);
      const { error } = await db
        .from("assignments")
        .insert({ student_id: studentId, curriculum_id: curriculumId, position: i + 1, status: spec.status ?? "open" });
      if (error) throw error;
    }
  };

  await create(STAFF.email, STAFF.password, { role: "staff", username: "e2e.staff", full_name: STAFF.fullName });
  await student(STUDENT_CONSENTED, true);

  await assign(await student(STUDENT_NEW, false), [
    { name: NEW_CURRICULUM_PASSED, sets: [], status: "passed" },
    { name: NEW_CURRICULUM_READY, sets: [{ name: "Grundlagen B", questionCount: 3 }] },
    { name: NEW_CURRICULUM_EMPTY, sets: [] },
  ]);
  await assign(await student(STUDENT_EXAM, true), [
    {
      name: EXAM_CURRICULUM,
      passMarkPercent: 60,
      sets: [
        { name: "Grundlagen 1", questionCount: 3 },
        { name: "Grundlagen 2", questionCount: 3 },
      ],
    },
    {
      name: EXAM_CURRICULUM_TWO,
      sets: [
        { name: "Alltag 1", questionCount: 3 },
        { name: "Alltag 2", questionCount: 3 },
      ],
    },
  ]);
  await assign(await student(STUDENT_EXAM_OPEN, true), [
    { name: EXAM_CURRICULUM_OPEN, sets: [{ name: "Grundlagen", questionCount: 3 }] },
  ]);
  await assign(await student(STUDENT_BLOCK, true), [
    {
      name: BLOCK_CURRICULUM,
      passMarkPercent: 100,
      sets: [
        { name: "Block 1", questionCount: 2 },
        { name: "Block 2", questionCount: 2 },
      ],
    },
    { name: BLOCK_OTHER_CURRICULUM, sets: [{ name: "Andere 1", questionCount: 2 }] },
  ]);
}
