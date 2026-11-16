"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireRole } from "@/lib/auth/require-role";
import { fetchAll, isUuid } from "@/lib/attempts";
import { parseQuestionsCsvWithRows } from "@/lib/csv/questions";
import { withoutRow } from "@/lib/csv/rows";
import { QUESTION_CSV_MAX_BYTES, utf8Bytes } from "@/lib/csv/limits";
import { OPTION_IDS, validateQuestionFields, type QuestionFields } from "@/lib/question-fields";
import { createClient } from "@/lib/supabase/server";
import type { NewQuestion, QuestionStatus } from "@/lib/types";

// Staff question management. Each action authenticates itself with requireRole('staff'); writes
// run under the staff session (RLS). Manual entry and CSV import share validateQuestionFields.
// Editing a question never changes stored results: scoring keeps its own snapshot (0007).

export type SaveQuestionResult = { ok: true; id: string } | { ok: false; message: string };
export type StatusResult = { ok: true } | { ok: false; message: string };
export type RowError = { row: number; message: string };
export type QuestionsImportPreview =
  | { ok: true; validCount: number; errors: RowError[]; topics: Record<string, number> }
  | { ok: false; message: string };
export type ImportQuestionsResult =
  | { ok: true; inserted: number; skipped: number }
  | { ok: false; message: string; errors: RowError[] };

const STATUSES: readonly QuestionStatus[] = ["draft", "approved"];
const DUPLICATE_MESSAGE = "This German question text already exists in this exam set";

function isStatus(v: unknown): v is QuestionStatus {
  return typeof v === "string" && (STATUSES as readonly string[]).includes(v);
}

function text(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Copies only the expected string fields out of client input. */
function readFields(raw: unknown): QuestionFields {
  const f = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const opts = (typeof f.options === "object" && f.options !== null ? f.options : {}) as Record<string, unknown>;
  const options = {} as QuestionFields["options"];
  for (const id of OPTION_IDS) {
    const o = (Object.hasOwn(opts, id) && typeof opts[id] === "object" && opts[id] !== null ? opts[id] : {}) as Record<string, unknown>;
    options[id] = { de: text(o.de), en: text(o.en) };
  }
  return {
    topic: text(f.topic),
    difficulty: text(f.difficulty),
    stemDe: text(f.stemDe),
    stemEn: text(f.stemEn),
    options,
    correct: text(f.correct),
    points: typeof f.points === "number" ? String(f.points) : text(f.points),
  };
}

function toRow(q: NewQuestion) {
  return {
    topic: q.topic,
    difficulty: q.difficulty,
    stem_de: q.stemDe,
    stem_en: q.stemEn,
    options: q.options,
    correct_option_id: q.correctOptionId,
    points: q.points,
  };
}

function revalidateQuestions() {
  revalidatePath("/staff/questions");
  revalidatePath("/staff/curriculums", "layout");
}

async function examSetExists(client: SupabaseClient, id: unknown): Promise<boolean> {
  if (!isUuid(id)) return false;
  const { data } = await client.from("exam_sets").select("id").eq("id", id).maybeSingle();
  return Boolean(data);
}

async function existingStems(client: SupabaseClient, examSetId: string): Promise<Map<string, string>> {
  const rows = await fetchAll(
    (from, to) => client.from("questions").select("id, stem_de").eq("exam_set_id", examSetId).order("id").range(from, to),
    "Could not read questions",
  );
  return new Map(rows.map((r) => [r.stem_de as string, r.id as string]));
}

/** Creates a question in an exam set, or edits one (`id`; it stays in its exam set). */
export async function saveQuestion(input: {
  id?: string;
  examSetId: string;
  fields: QuestionFields;
  status: QuestionStatus;
}): Promise<SaveQuestionResult> {
  await requireRole("staff");
  if (typeof input !== "object" || input === null) return { ok: false, message: "Invalid request" };
  if (!isStatus(input.status)) return { ok: false, message: "Choose draft or approved" };
  const checked = validateQuestionFields(readFields(input.fields));
  if (!checked.ok) return checked;
  const client = await createClient();

  let examSetId: string;
  if (input.id !== undefined) {
    if (!isUuid(input.id)) return { ok: false, message: "Question not found" };
    const { data } = await client.from("questions").select("exam_set_id").eq("id", input.id).maybeSingle();
    if (!data) return { ok: false, message: "Question not found" };
    examSetId = data.exam_set_id;
  } else {
    if (!(await examSetExists(client, input.examSetId))) return { ok: false, message: "Exam set not found" };
    examSetId = input.examSetId;
  }

  const sameStem = (await existingStems(client, examSetId)).get(checked.question.stemDe);
  if (sameStem && sameStem !== input.id) return { ok: false, message: DUPLICATE_MESSAGE };

  const row = { ...toRow(checked.question), status: input.status };
  if (input.id !== undefined) {
    const { error } = await client.from("questions").update(row).eq("id", input.id);
    if (error) {
      console.error("saveQuestion failed", error.code);
      return { ok: false, message: "The question could not be saved. Please try again." };
    }
    revalidateQuestions();
    return { ok: true, id: input.id };
  }
  const { data, error } = await client
    .from("questions")
    .insert({ ...row, exam_set_id: examSetId })
    .select("id")
    .single();
  if (error) {
    console.error("saveQuestion failed", error.code);
    return { ok: false, message: "The question could not be saved. Please try again." };
  }
  revalidateQuestions();
  return { ok: true, id: data.id };
}

/** Approve (eligible for new papers) or set back to draft (no longer drawn). */
export async function setQuestionStatus(questionId: string, status: QuestionStatus): Promise<StatusResult> {
  await requireRole("staff");
  if (!isStatus(status)) return { ok: false, message: "Choose draft or approved" };
  if (!isUuid(questionId)) return { ok: false, message: "Question not found" };
  const client = await createClient();
  const { data, error } = await client.from("questions").update({ status }).eq("id", questionId).select("id");
  if (error) {
    console.error("setQuestionStatus failed", error.code);
    return { ok: false, message: "The status could not be changed. Please try again." };
  }
  if (!data?.length) return { ok: false, message: "Question not found" };
  revalidateQuestions();
  return { ok: true };
}

/** Parses the CSV for an exam set; rows whose German text already exists in the set are errors. */
async function checkQuestionsCsv(client: SupabaseClient, examSetId: string, csvText: string) {
  const parsed = parseQuestionsCsvWithRows(csvText);
  if (parsed.valid.length === 0) return parsed;
  const stems = await existingStems(client, examSetId);
  const valid = parsed.valid.filter((q) => !stems.has(q.stemDe));
  const errors = [
    ...parsed.errors,
    ...parsed.valid.filter((q) => stems.has(q.stemDe)).map((q) => ({ row: q.row, message: DUPLICATE_MESSAGE })),
  ].sort((a, b) => a.row - b.row);
  return { valid, errors };
}

export async function previewQuestionsImport(examSetId: string, csvText: string): Promise<QuestionsImportPreview> {
  await requireRole("staff");
  const csv = text(csvText);
  if (utf8Bytes(csv) > QUESTION_CSV_MAX_BYTES) return { ok: false, message: "The file is too large (at most 2 MB)." };
  const client = await createClient();
  if (!(await examSetExists(client, examSetId))) return { ok: false, message: "Exam set not found" };
  const { valid, errors } = await checkQuestionsCsv(client, examSetId, csv);
  const topics: Record<string, number> = {};
  for (const q of valid) topics[q.topic] = (Object.hasOwn(topics, q.topic) ? topics[q.topic] : 0) + 1;
  return { ok: true, validCount: valid.length, errors, topics };
}

/**
 * Inserts the CSV's questions into the exam set in one statement (all rows or none). With any row
 * error nothing is inserted unless `onlyValid` is true; then the valid rows are inserted and the
 * others counted as skipped. New questions are drafts unless `status` is 'approved'.
 */
export async function importQuestions(input: {
  examSetId: string;
  csvText: string;
  status: QuestionStatus;
  onlyValid: boolean;
}): Promise<ImportQuestionsResult> {
  await requireRole("staff");
  if (typeof input !== "object" || input === null) return { ok: false, message: "Invalid request", errors: [] };
  if (!isStatus(input.status)) return { ok: false, message: "Choose draft or approved", errors: [] };
  const csv = text(input.csvText);
  if (utf8Bytes(csv) > QUESTION_CSV_MAX_BYTES) return { ok: false, message: "The file is too large (at most 2 MB).", errors: [] };
  const client = await createClient();
  if (!(await examSetExists(client, input.examSetId))) return { ok: false, message: "Exam set not found", errors: [] };

  const { valid, errors } = await checkQuestionsCsv(client, input.examSetId, csv);
  const fileError = errors.find((e) => e.row === 0);
  if (fileError) return { ok: false, message: fileError.message, errors };
  if (errors.length > 0 && input.onlyValid !== true) {
    const n = errors.length;
    return {
      ok: false,
      message: `Nothing was imported: ${n} row${n === 1 ? " has" : "s have"} errors. Fix them, or choose to import only the valid rows.`,
      errors,
    };
  }
  if (valid.length === 0) return { ok: false, message: "There are no valid rows to import.", errors };

  const { error } = await client
    .from("questions")
    .insert(valid.map((q) => ({ ...toRow(withoutRow(q)), exam_set_id: input.examSetId, status: input.status })));
  if (error) {
    console.error("importQuestions failed", error.code);
    return { ok: false, message: "Nothing was imported because the database refused the rows. Please try again.", errors: [] };
  }
  revalidateQuestions();
  return { ok: true, inserted: valid.length, skipped: errors.length };
}
