// Integration tests for the staff content actions (curriculums, exam sets, questions) against the
// LOCAL Supabase stack with real staff and student sessions. See students/actions.test.ts.
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.client }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT ${path}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { StartError, startAttempt } from "@/lib/attempts";
import type { QuestionFields } from "@/lib/question-fields";
import { QUESTION_CSV_MAX_BYTES } from "@/lib/csv/limits";
import { saveCurriculum, saveExamSet } from "./curriculums/actions";
import { importQuestions, previewQuestionsImport, saveQuestion, setQuestionStatus } from "./questions/actions";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const db = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const run = randomUUID().slice(0, 8);
const userIds: string[] = [];
const curriculumIds: string[] = [];
let staffClient: SupabaseClient;
let studentClient: SupabaseClient;
let curriculumId = "";

async function must<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error) throw error;
  if (data === null || data === undefined) throw new Error("no data");
  return data;
}

let counter = 0;
async function makeUser(role: "staff" | "student") {
  counter += 1;
  const username = `t8c.${run}.${role}${counter}`;
  const email = `${username}@${role}.test`;
  const password = `test-${randomUUID()}`;
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role, username, full_name: `T8c ${role}` },
  });
  if (error) throw error;
  userIds.push(data.user.id);
  const client = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw e;
  return { id: data.user.id, client };
}

const examSetInput = (over: Record<string, unknown> = {}) => ({
  curriculumId,
  name: `Set ${randomUUID().slice(0, 6)}`,
  questionCount: 2,
  timeLimitMin: 20,
  passMarkPercent: 60,
  topicMix: {},
  ...over,
});

function questionFields(stem: string, over: Partial<QuestionFields> = {}): QuestionFields {
  return {
    topic: "Pflege",
    difficulty: "easy",
    stemDe: `${stem} (de)`,
    stemEn: `${stem} (en)`,
    options: {
      a: { de: "Ja", en: "Yes" },
      b: { de: "Nein", en: "No" },
      c: { de: "", en: "" },
      d: { de: "", en: "" },
    },
    correct: "b",
    points: "1",
    ...over,
  };
}

const CSV_HEADER =
  "topic,difficulty,stem_de,stem_en,option_a_de,option_a_en,option_b_de,option_b_en,option_c_de,option_c_en,option_d_de,option_d_en,correct,points";
const csvRow = (i: number, topic = "Pflege") =>
  `${topic},easy,Frage Nr. ${i}: Größe und Übung?,Question no. ${i}: size and practice?,Ja,Yes,Nein,No,Vielleicht,Maybe,,,b,1`;

async function newSet(over: Record<string, unknown> = {}): Promise<string> {
  session.client = staffClient;
  const r = await saveExamSet(examSetInput(over));
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.id;
}

async function questionsOf(setId: string) {
  return must(db.from("questions").select("id, stem_de, stem_en, status, options, topic").eq("exam_set_id", setId).order("stem_de"));
}

beforeAll(async () => {
  ({ client: staffClient } = await makeUser("staff"));
  ({ client: studentClient } = await makeUser("student"));
  const c = await must(db.from("curriculums").insert({ name: `T8c curriculum ${run}` }).select("id").single());
  curriculumId = c.id;
  curriculumIds.push(c.id);
});

afterAll(async () => {
  for (const id of userIds) await db.auth.admin.deleteUser(id);
  await db.from("curriculums").delete().like("name", `T8c %${run}%`);
  for (const id of curriculumIds) await db.from("curriculums").delete().eq("id", id);
});

beforeEach(() => {
  session.client = staffClient;
});

describe("saveCurriculum", () => {
  it("creates, renames, and refuses a blank or duplicate name", async () => {
    const created = await saveCurriculum({ name: `  T8c new ${run} ` });
    expect(created).toMatchObject({ ok: true });
    if (!created.ok) return;
    const row = await must(db.from("curriculums").select("name").eq("id", created.id).single());
    expect(row.name).toBe(`T8c new ${run}`);

    expect(await saveCurriculum({ id: created.id, name: `T8c renamed ${run}` })).toEqual({ ok: true, id: created.id });
    expect((await must(db.from("curriculums").select("name").eq("id", created.id).single())).name).toBe(`T8c renamed ${run}`);

    expect(await saveCurriculum({ name: " " })).toEqual({ ok: false, message: "Enter a name" });
    expect(await saveCurriculum({ name: `T8c renamed ${run}` })).toEqual({ ok: false, message: "A curriculum with this name already exists" });
    expect(await saveCurriculum({ id: randomUUID(), name: `T8c ghost ${run}` })).toEqual({ ok: false, message: "Curriculum not found" });
  });
});

describe("saveCurriculum attempts per student", () => {
  it("creates with the default of 2, saves 1..20 on edit, refuses anything else, and a rename keeps it", async () => {
    const created = await saveCurriculum({ name: `T8c attempts ${run}` });
    if (!created.ok) throw new Error(created.message);
    const maxOf = async () => (await must(db.from("curriculums").select("max_attempts").eq("id", created.id).single())).max_attempts;
    expect(await maxOf()).toBe(2);

    expect(await saveCurriculum({ id: created.id, name: `T8c attempts ${run}`, maxAttempts: 5 })).toEqual({ ok: true, id: created.id });
    expect(await maxOf()).toBe(5);
    expect(await saveCurriculum({ id: created.id, name: `T8c attempts ${run}`, maxAttempts: "20" })).toEqual({ ok: true, id: created.id });
    expect(await maxOf()).toBe(20);

    for (const bad of [0, 21, 2.5, "x"]) {
      expect(await saveCurriculum({ id: created.id, name: `T8c attempts ${run}`, maxAttempts: bad })).toEqual({
        ok: false,
        message: "Enter a whole number from 1 to 20",
        errors: { maxAttempts: "Enter a whole number from 1 to 20" },
      });
    }
    expect(await maxOf()).toBe(20);

    expect(await saveCurriculum({ id: created.id, name: `T8c attempts renamed ${run}` })).toEqual({ ok: true, id: created.id });
    expect(await maxOf()).toBe(20);

    const withThree = await saveCurriculum({ name: `T8c three ${run}`, maxAttempts: 3 });
    if (!withThree.ok) throw new Error(withThree.message);
    expect((await must(db.from("curriculums").select("max_attempts").eq("id", withThree.id).single())).max_attempts).toBe(3);
  });

  it("a student session cannot change attempts per student", async () => {
    session.client = studentClient;
    await expect(saveCurriculum({ id: curriculumId, name: "x", maxAttempts: 9 })).rejects.toThrow(/REDIRECT/);
    expect((await must(db.from("curriculums").select("max_attempts").eq("id", curriculumId).single())).max_attempts).toBe(2);
  });
});

describe("saveExamSet", () => {
  it("rejects a topic mix that does not add up to the question count and saves nothing", async () => {
    const name = `T8c bad mix ${run}`;
    const r = await saveExamSet(examSetInput({ name, questionCount: 3, topicMix: { Pflege: 1, Recht: 1 } }));
    expect(r).toEqual({ ok: false, errors: { topicMix: "Topic counts add up to 2, but the exam has 3 questions" } });
    const rows = await must(db.from("exam_sets").select("id").eq("name", name));
    expect(rows).toEqual([]);
  });

  it("rejects invalid settings field by field", async () => {
    const r = await saveExamSet(examSetInput({ passMarkPercent: 120, questionCount: 0 }));
    expect(r).toMatchObject({ ok: false, errors: { passMarkPercent: expect.any(String), questionCount: expect.any(String) } });
    expect(await saveExamSet(examSetInput({ curriculumId: randomUUID() }))).toMatchObject({ ok: false, message: "Curriculum not found" });
  });

  it("saves every setting, warns about unknown topics and a small pool, and updates on edit", async () => {
    const r = await saveExamSet(
      examSetInput({ name: `T8c full ${run}`, questionCount: 3, timeLimitMin: 480, passMarkPercent: 75, topicMix: { Pflege: 2, Recht: 1 }, reminderIntervalMin: 30 }),
    );
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.warnings).toEqual([
      'Topic "Pflege" has no approved questions in this exam set.',
      'Topic "Recht" has no approved questions in this exam set.',
      "Only 0 approved questions, but each paper needs 3. Students cannot get this exam set until more are approved.",
    ]);
    const row = await must(db.from("exam_sets").select("*").eq("id", r.id).single());
    expect(row).toMatchObject({
      curriculum_id: curriculumId,
      question_count: 3,
      time_limit_min: 480,
      reminder_interval_min: 30,
      pass_mark_percent: 75,
      topic_mix: { Pflege: 2, Recht: 1 },
    });

    const edited = await saveExamSet(examSetInput({ id: r.id, name: `T8c full ${run}`, questionCount: 1, topicMix: {}, timeLimitMin: 150, reminderIntervalMin: 0 }));
    expect(edited).toMatchObject({ ok: true, id: r.id });
    const after = await must(db.from("exam_sets").select("question_count, topic_mix, curriculum_id, time_limit_min, reminder_interval_min").eq("id", r.id).single());
    expect(after).toEqual({ question_count: 1, topic_mix: {}, curriculum_id: curriculumId, time_limit_min: 150, reminder_interval_min: 0 });
  });
});

describe("saveQuestion and setQuestionStatus", () => {
  it("saves a bilingual question as draft, validates with the CSV rules, edits it", async () => {
    const setId = await newSet();
    const r = await saveQuestion({ examSetId: setId, fields: questionFields("Wie geht's"), status: "draft" });
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    const row = await must(db.from("questions").select("*").eq("id", r.id).single());
    expect(row).toMatchObject({
      exam_set_id: setId,
      topic: "Pflege",
      difficulty: "easy",
      stem_de: "Wie geht's (de)",
      stem_en: "Wie geht's (en)",
      options: [
        { id: "a", de: "Ja", en: "Yes" },
        { id: "b", de: "Nein", en: "No" },
      ],
      correct_option_id: "b",
      points: 1,
      status: "draft",
    });

    expect(await saveQuestion({ examSetId: setId, fields: questionFields("X", { stemEn: "" }), status: "draft" })).toEqual({
      ok: false,
      message: "Missing English question text (stem_en)",
    });
    expect(await saveQuestion({ examSetId: setId, fields: questionFields("Wie geht's"), status: "draft" })).toEqual({
      ok: false,
      message: "This German question text already exists in this exam set",
    });
    expect(await saveQuestion({ examSetId: setId, fields: questionFields("Y"), status: "published" as never })).toMatchObject({ ok: false });

    const edited = await saveQuestion({ id: r.id, examSetId: setId, fields: questionFields("Wie geht's", { correct: "a", points: "3" }), status: "approved" });
    expect(edited).toEqual({ ok: true, id: r.id });
    const after = await must(db.from("questions").select("correct_option_id, points, status").eq("id", r.id).single());
    expect(after).toEqual({ correct_option_id: "a", points: 3, status: "approved" });
  });

  it("approve/draft changes pool eligibility used by drawPaper", async () => {
    // Its own curriculum, so this exam set is the only one startAttempt can choose.
    const own = await must(db.from("curriculums").insert({ name: `T8c pool ${run}` }).select("id").single());
    const setId = await newSet({ questionCount: 1, curriculumId: own.id });
    const r = await saveQuestion({ examSetId: setId, fields: questionFields("Pool"), status: "draft" });
    if (!r.ok) throw new Error(r.message);
    const student = await makeUser("student");
    await db.from("assignments").insert({ student_id: student.id, curriculum_id: own.id, position: 1 });

    await expect(startAttempt(student.id, own.id)).rejects.toMatchObject({ code: "unavailable" });
    await expect(startAttempt(student.id, own.id)).rejects.toThrow(StartError);
    expect(await setQuestionStatus(r.id, "approved")).toEqual({ ok: true });
    const { attemptId } = await startAttempt(student.id, own.id);
    const paper = await must(db.from("attempt_questions").select("question_id").eq("attempt_id", attemptId));
    expect(paper).toEqual([{ question_id: r.id }]);

    expect(await setQuestionStatus(r.id, "draft")).toEqual({ ok: true });
    expect((await must(db.from("questions").select("status").eq("id", r.id).single())).status).toBe("draft");
    expect(await setQuestionStatus(r.id, "deleted" as never)).toMatchObject({ ok: false });
    expect(await setQuestionStatus("nope", "approved")).toMatchObject({ ok: false });
  });
});

describe("importQuestions", () => {
  it("previews row errors before saving anything; all-or-nothing by default", async () => {
    const setId = await newSet();
    const csv = [CSV_HEADER, csvRow(1), "Pflege,easy,Nur Deutsch,,Ja,Yes,Nein,No,,,,,a,1", csvRow(3)].join("\n");
    const preview = await previewQuestionsImport(setId, csv);
    expect(preview).toEqual({
      ok: true,
      validCount: 2,
      errors: [{ row: 2, message: "Missing English question text (stem_en)" }],
      topics: { Pflege: 2 },
    });
    expect(await questionsOf(setId)).toEqual([]);

    const r = await importQuestions({ examSetId: setId, csvText: csv, status: "draft", onlyValid: false });
    expect(r).toEqual({
      ok: false,
      message: "Nothing was imported: 1 row has errors. Fix them, or choose to import only the valid rows.",
      errors: [{ row: 2, message: "Missing English question text (stem_en)" }],
    });
    expect(await questionsOf(setId)).toEqual([]);

    const onlyValid = await importQuestions({ examSetId: setId, csvText: csv, status: "draft", onlyValid: true });
    expect(onlyValid).toEqual({ ok: true, inserted: 2, skipped: 1 });
    const rows = await questionsOf(setId);
    expect(rows.map((q) => q.status)).toEqual(["draft", "draft"]);
    expect(rows[0].stem_de).toBe("Frage Nr. 1: Größe und Übung?");
  });

  it("imports 20 questions as approved in one go, and refuses re-importing the same questions", async () => {
    const setId = await newSet();
    const csv = [CSV_HEADER, ...Array.from({ length: 20 }, (_, i) => csvRow(i + 1, i % 2 ? "Recht" : "Pflege"))].join("\n");
    expect(await importQuestions({ examSetId: setId, csvText: csv, status: "approved", onlyValid: false })).toEqual({
      ok: true,
      inserted: 20,
      skipped: 0,
    });
    const rows = await questionsOf(setId);
    expect(rows).toHaveLength(20);
    expect(rows.every((q) => q.status === "approved")).toBe(true);
    expect(rows.find((q) => q.stem_de.startsWith("Frage Nr. 2:"))?.topic).toBe("Recht");

    const again = await previewQuestionsImport(setId, csv);
    expect(again).toMatchObject({ ok: true, validCount: 0 });
    expect((again as { errors: { message: string }[] }).errors[0].message).toBe("This German question text already exists in this exam set");
    expect(await importQuestions({ examSetId: setId, csvText: csv, status: "approved", onlyValid: true })).toMatchObject({ ok: false });
    expect(await questionsOf(setId)).toHaveLength(20);
  });

  it("rejects a file with no columns or an unknown exam set", async () => {
    const setId = await newSet();
    expect(await importQuestions({ examSetId: setId, csvText: "foo,bar\n1,2", status: "draft", onlyValid: true })).toMatchObject({ ok: false });
    expect(await importQuestions({ examSetId: randomUUID(), csvText: [CSV_HEADER, csvRow(1)].join("\n"), status: "draft", onlyValid: false })).toEqual({
      ok: false,
      message: "Exam set not found",
      errors: [],
    });
    expect(await questionsOf(setId)).toEqual([]);
  });
});

describe("question CSV size cap (bytes)", () => {
  it("accepts a file just under 2 MB through the actions and refuses one over 2 MB in bytes", async () => {
    const setId = await newSet();
    const good = csvRow(1);
    // Padding rows fail validation (no topic) without touching the database.
    const pad = ",easy,x,y,a,a,b,b,,,,,a,1\n";
    const head = `${CSV_HEADER}\n${good}\n`;
    const bytes = (t: string) => new TextEncoder().encode(t).length;
    const under = head + pad.repeat(Math.floor((QUESTION_CSV_MAX_BYTES - bytes(head) - 1) / pad.length));
    expect(bytes(under)).toBeLessThanOrEqual(QUESTION_CSV_MAX_BYTES);
    expect(bytes(under)).toBeGreaterThan(QUESTION_CSV_MAX_BYTES - pad.length - 2);
    expect(await previewQuestionsImport(setId, under)).toMatchObject({ ok: true, validCount: 1 });
    expect(await importQuestions({ examSetId: setId, csvText: under, status: "draft", onlyValid: true })).toMatchObject({ ok: true, inserted: 1 });

    const over = `${CSV_HEADER}\n` + "ü".repeat(Math.ceil(QUESTION_CSV_MAX_BYTES / 2) + 10);
    expect(over.length).toBeLessThan(QUESTION_CSV_MAX_BYTES);
    expect(await previewQuestionsImport(setId, over)).toEqual({ ok: false, message: "The file is too large (at most 2 MB)." });
    expect(await importQuestions({ examSetId: setId, csvText: over, status: "draft", onlyValid: true })).toMatchObject({
      ok: false,
      message: "The file is too large (at most 2 MB).",
    });
    expect(await questionsOf(setId)).toHaveLength(1);
  });
});

describe("a student session cannot use any content action", () => {
  it("every action redirects and nothing changes", async () => {
    const setId = await newSet();
    session.client = studentClient;
    const name = `T8c by student ${run}`;
    await expect(saveCurriculum({ name })).rejects.toThrow(/REDIRECT/);
    await expect(saveExamSet(examSetInput({ name }))).rejects.toThrow(/REDIRECT/);
    await expect(saveQuestion({ examSetId: setId, fields: questionFields("Student"), status: "approved" })).rejects.toThrow(/REDIRECT/);
    await expect(setQuestionStatus(randomUUID(), "approved")).rejects.toThrow(/REDIRECT/);
    await expect(previewQuestionsImport(setId, [CSV_HEADER, csvRow(1)].join("\n"))).rejects.toThrow(/REDIRECT/);
    await expect(importQuestions({ examSetId: setId, csvText: [CSV_HEADER, csvRow(1)].join("\n"), status: "approved", onlyValid: true })).rejects.toThrow(/REDIRECT/);
    expect(await must(db.from("curriculums").select("id").eq("name", name))).toEqual([]);
    expect(await must(db.from("exam_sets").select("id").eq("name", name))).toEqual([]);
    expect(await questionsOf(setId)).toEqual([]);
  });
});
