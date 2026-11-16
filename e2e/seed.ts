import { createClient } from "@supabase/supabase-js";
import { usernameToEmail } from "../src/lib/auth/username";
import {
  BLOCK_CURRICULUM,
  EXAM_CURRICULUM_HELD,
  EXAM_CURRICULUM_OPEN,
  NEXT_CURRICULUM,
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

/** Recreates the e2e users and assignments from scratch (idempotent). Uses the local service role. */
export async function seed() {
  const db = adminDb();

  const { data: list, error: listError } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw listError;
  const emails = [
    STAFF.email,
    usernameToEmail(STUDENT_NEW.username),
    usernameToEmail(STUDENT_CONSENTED.username),
    usernameToEmail(STUDENT_EXAM.username),
    usernameToEmail(STUDENT_EXAM_OPEN.username),
    usernameToEmail(STUDENT_BLOCK.username),
  ];
  for (const u of list.users.filter((u) => u.email && emails.includes(u.email))) {
    const { error } = await db.auth.admin.deleteUser(u.id);
    if (error) throw error;
  }

  const create = async (
    email: string,
    password: string,
    meta: Record<string, string>,
  ) => {
    const { data, error } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: meta,
    });
    if (error) throw error;
    return data.user.id;
  };

  await create(STAFF.email, STAFF.password, { role: "staff", username: "e2e.staff", full_name: STAFF.fullName });
  const newId = await create(usernameToEmail(STUDENT_NEW.username), STUDENT_NEW.password, {
    role: "student",
    username: STUDENT_NEW.username,
    full_name: STUDENT_NEW.fullName,
  });
  const doneId = await create(usernameToEmail(STUDENT_CONSENTED.username), STUDENT_CONSENTED.password, {
    role: "student",
    username: STUDENT_CONSENTED.username,
    full_name: STUDENT_CONSENTED.fullName,
  });

  const { error: consentError } = await db
    .from("profiles")
    .update({ consent_at: new Date().toISOString() })
    .eq("id", doneId);
  if (consentError) throw consentError;

  const names = ["E2E Curriculum A", NEXT_CURRICULUM, "E2E Curriculum C"];
  const { data: curriculums, error: cError } = await db
    .from("curriculums")
    .upsert(names.map((name) => ({ name })), { onConflict: "name" })
    .select("id, name");
  if (cError) throw cError;
  const id = (name: string) => curriculums!.find((c) => c.name === name)!.id;

  // A is already passed (position 1), B is the next open one (position 2), C comes later.
  const { error: aError } = await db.from("assignments").insert([
    { student_id: newId, curriculum_id: id("E2E Curriculum C"), position: 3, status: "open" },
    { student_id: newId, curriculum_id: id(NEXT_CURRICULUM), position: 2, status: "open" },
    { student_id: newId, curriculum_id: id("E2E Curriculum A"), position: 1, status: "passed" },
  ]);
  if (aError) throw aError;

  await seedExam(STUDENT_EXAM, EXAM_CURRICULUM_HELD, true, create);
  await seedExam(STUDENT_EXAM_OPEN, EXAM_CURRICULUM_OPEN, false, create);
  await seedExam(STUDENT_BLOCK, BLOCK_CURRICULUM, true, create, {
    questionCount: 2,
    maxAttempts: 2,
    passMarkPercent: 100,
    extraStems: 3,
    grant: false,
  });
}

/**
 * A consented student with one assigned curriculum, a 3-question German exam set and one
 * attempt grant. Users were deleted above (cascading their attempts), so the curriculum and
 * its exam set can be recreated from scratch.
 */
async function seedExam(
  student: { username: string; password: string; fullName: string },
  curriculumName: string,
  holdResult: boolean,
  create: (email: string, password: string, meta: Record<string, string>) => Promise<string>,
  opts: { questionCount?: number; maxAttempts?: number; passMarkPercent?: number; extraStems?: number; grant?: boolean } = {},
) {
  const db = adminDb();
  const studentId = await create(usernameToEmail(student.username), student.password, {
    role: "student",
    username: student.username,
    full_name: student.fullName,
  });
  const { error: consentError } = await db
    .from("profiles")
    .update({ consent_at: new Date().toISOString() })
    .eq("id", studentId);
  if (consentError) throw consentError;

  const { error: delError } = await db.from("curriculums").delete().eq("name", curriculumName);
  if (delError) throw delError;
  const { data: curriculum, error: cError } = await db
    .from("curriculums")
    .insert({ name: curriculumName })
    .select("id")
    .single();
  if (cError) throw cError;
  const { data: set, error: sError } = await db
    .from("exam_sets")
    .insert({
      curriculum_id: curriculum.id,
      name: holdResult ? "Grundlagen (held)" : "Grundlagen",
      question_count: opts.questionCount ?? 3,
      time_limit_min: 30,
      pass_mark_percent: opts.passMarkPercent ?? 60,
      max_attempts: opts.maxAttempts ?? 1,
      hold_result: holdResult,
    })
    .select("id")
    .single();
  if (sError) throw sError;

  const options = [
    { id: "a", de: "Ja", en: "Yes" },
    { id: "b", de: "Nein", en: "No" },
    { id: "c", de: "Vielleicht", en: "Maybe" },
  ];
  const stems = [
    ["Ist Berlin die Hauptstadt von Frankreich?", "Is Berlin the capital of France?"],
    ["Hat eine Woche acht Tage?", "Does a week have eight days?"],
    ["Ist Wasser bei Raumtemperatur fest?", "Is water solid at room temperature?"],
    ["Ist der Mond aus Käse?", "Is the moon made of cheese?"],
    ["Hat ein Jahr dreizehn Monate?", "Does a year have thirteen months?"],
    ["Ist Schnee schwarz?", "Is snow black?"],
  ].slice(0, 3 + (opts.extraStems ?? 0));
  const { error: qError } = await db.from("questions").insert(
    stems.map(([de, en]) => ({
      exam_set_id: set.id,
      topic: "allgemein",
      difficulty: "easy",
      stem_de: de,
      stem_en: en,
      options,
      correct_option_id: "b",
      points: 1,
      status: "approved",
    })),
  );
  if (qError) throw qError;

  const { error: aError } = await db
    .from("assignments")
    .insert({ student_id: studentId, curriculum_id: curriculum.id, position: 1, status: "open" });
  if (aError) throw aError;
  if (opts.grant === false) return;
  const { error: gError } = await db.from("attempt_grants").insert({ student_id: studentId, exam_set_id: set.id });
  if (gError) throw gError;
}
