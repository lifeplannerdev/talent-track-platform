import { createClient } from "@supabase/supabase-js";
import { assertLocalUrl } from "../scripts/local-url.mjs";
import { usernameToEmail } from "../src/lib/auth/username";
import { buildInviteLink } from "../src/lib/invite-link";
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
  STUDENT_OF_ONE,
  STUDENT_OF_TWO,
  STUDENT_BY_TRAINER,
  TRAINER_ONE,
  TRAINER_TWO,
} from "./fixtures";

/** Service-role client for the e2e fixtures; refuses any target but the local stack. */
export function adminDb() {
  assertLocalUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
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
  const studentEmails = [STUDENT_NEW, STUDENT_CONSENTED, STUDENT_EXAM, STUDENT_EXAM_OPEN, STUDENT_BLOCK, STUDENT_OF_ONE, STUDENT_OF_TWO, STUDENT_BY_TRAINER].map(
    (s) => usernameToEmail(s.username),
  );
  const staffEmails = [STAFF.email, TRAINER_ONE.email, TRAINER_TWO.email];
  const remove = async (id: string) => {
    const { error } = await db.auth.admin.deleteUser(id);
    if (error) throw error;
  };
  // Students first: profiles.trainer_id restricts deleting a trainer who still has students (also
  // students a spec made through the trainer's session).
  for (const u of list.users.filter((u) => u.email && studentEmails.includes(u.email))) await remove(u.id);
  const trainerIds = list.users.filter((u) => u.email && [TRAINER_ONE.email, TRAINER_TWO.email].includes(u.email)).map((u) => u.id);
  if (trainerIds.length > 0) {
    const { data: owned, error: ownedError } = await db.from("profiles").select("id").in("trainer_id", trainerIds);
    if (ownedError) throw ownedError;
    for (const p of owned ?? []) await remove(p.id);
  }
  for (const u of list.users.filter((u) => u.email && staffEmails.includes(u.email))) await remove(u.id);

  const create = async (email: string, password: string, meta: Record<string, string>) => {
    const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: meta });
    if (error) throw error;
    return data.user.id;
  };
  const student = async (s: { username: string; password: string; fullName: string }, consented: boolean, trainerId?: string) => {
    const id = await create(usernameToEmail(s.username), s.password, {
      role: "student",
      username: s.username,
      full_name: s.fullName,
      ...(trainerId ? { trainer_id: trainerId } : {}),
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

  await create(STAFF.email, STAFF.password, { role: "admin", username: "e2e.staff", full_name: STAFF.fullName });
  await student(STUDENT_CONSENTED, true);

  const trainer = async (t: { username: string; email: string; password: string; fullName: string }) =>
    create(t.email, t.password, { role: "trainer", username: t.username, full_name: t.fullName });
  const trainerOne = await trainer(TRAINER_ONE);
  const trainerTwo = await trainer(TRAINER_TWO);
  for (const [s, owner] of [[STUDENT_OF_ONE, trainerOne], [STUDENT_OF_TWO, trainerTwo]] as const) {
    const id = await student(s, true, owner);
    const { error } = await db.from("student_details").insert({ student_id: id, contact_email: s.contactEmail });
    if (error) throw error;
    const { error: aError } = await db
      .from("assignments")
      .insert({ student_id: id, curriculum_id: "00000000-0000-4000-8000-00000000c002", position: 1 });
    if (aError) throw aError;
  }

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

/**
 * Test-only: a fresh invite link for an existing user, made by the same code createInviteLink
 * uses, with the local service role. It is never served over HTTP and never logged.
 */
export async function inviteLinkFor(username: string): Promise<string> {
  const db = adminDb();
  const { data, error } = await db.from("profiles").select("id").eq("username", username).single();
  if (error) throw error;
  const made = await buildInviteLink(db, data.id, "http://localhost:3000");
  if (!made.ok) throw new Error("could not make an invite link");
  return made.link;
}
