"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { fetchAll, isUuid } from "@/lib/attempts";
import { examSetWarnings, validateExamSetFields, type ExamSetField, type ExamSetFields } from "@/lib/exam-set-fields";
import { createClient } from "@/lib/supabase/server";

// Staff curriculum and exam set management. Each action authenticates itself with
// requireRole('staff'); writes run under the staff session (RLS).

export type SaveCurriculumResult = { ok: true; id: string } | { ok: false; message: string };
export type SaveExamSetResult =
  | { ok: true; id: string; warnings: string[] }
  | { ok: false; message?: string; errors?: Partial<Record<ExamSetField, string>> };

export async function saveCurriculum(input: { id?: string; name: string }): Promise<SaveCurriculumResult> {
  await requireRole("staff");
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  if (!name) return { ok: false, message: "Enter a name" };
  if (name.length > 120) return { ok: false, message: "Use at most 120 characters" };
  const client = await createClient();

  if (input.id !== undefined) {
    if (!isUuid(input.id)) return { ok: false, message: "Curriculum not found" };
    const { data, error } = await client.from("curriculums").update({ name }).eq("id", input.id).select("id");
    if (error) {
      if (error.code === "23505") return { ok: false, message: "A curriculum with this name already exists" };
      console.error("saveCurriculum failed", error.code);
      return { ok: false, message: "The curriculum could not be saved. Please try again." };
    }
    if (!data?.length) return { ok: false, message: "Curriculum not found" };
    revalidateCurriculums(input.id);
    return { ok: true, id: input.id };
  }

  const { data, error } = await client.from("curriculums").insert({ name }).select("id").single();
  if (error) {
    if (error.code === "23505") return { ok: false, message: "A curriculum with this name already exists" };
    console.error("saveCurriculum failed", error.code);
    return { ok: false, message: "The curriculum could not be saved. Please try again." };
  }
  revalidateCurriculums(data.id);
  return { ok: true, id: data.id };
}

function revalidateCurriculums(curriculumId?: string) {
  revalidatePath("/staff/curriculums");
  if (curriculumId) revalidatePath(`/staff/curriculums/${curriculumId}`);
  revalidatePath("/staff/questions");
  revalidatePath("/staff/students");
}

/**
 * Creates an exam set in a curriculum, or updates the settings of an existing one (`id`; its
 * curriculum does not change). Returns field errors, or the id and warnings about the question
 * pool (topics of the mix without enough approved questions, pool below 3 x question count).
 */
export async function saveExamSet(input: ExamSetFields & { id?: string; curriculumId: string }): Promise<SaveExamSetResult> {
  await requireRole("staff");
  if (typeof input !== "object" || input === null) return { ok: false, message: "Invalid request" };
  const checked = validateExamSetFields(input);
  if (!checked.ok) return { ok: false, errors: checked.errors };
  const v = checked.value;
  const client = await createClient();
  const row = {
    name: v.name,
    question_count: v.questionCount,
    time_limit_min: v.timeLimitMin,
    pass_mark_percent: v.passMarkPercent,
    max_attempts: v.maxAttempts,
    hold_result: v.holdResult,
    topic_mix: v.topicMix,
    reminder_interval_min: v.reminderIntervalMin,
  };

  let id: string;
  let curriculumId: string;
  if (input.id !== undefined) {
    if (!isUuid(input.id)) return { ok: false, message: "Exam set not found" };
    const { data, error } = await client.from("exam_sets").update(row).eq("id", input.id).select("id, curriculum_id");
    if (error) {
      console.error("saveExamSet failed", error.code);
      return { ok: false, message: "The exam set could not be saved. Please try again." };
    }
    if (!data?.length) return { ok: false, message: "Exam set not found" };
    id = data[0].id;
    curriculumId = data[0].curriculum_id;
  } else {
    if (!isUuid(input.curriculumId)) return { ok: false, message: "Curriculum not found" };
    const { data: curriculum } = await client.from("curriculums").select("id").eq("id", input.curriculumId).maybeSingle();
    if (!curriculum) return { ok: false, message: "Curriculum not found" };
    const { data, error } = await client
      .from("exam_sets")
      .insert({ ...row, curriculum_id: input.curriculumId })
      .select("id")
      .single();
    if (error) {
      console.error("saveExamSet failed", error.code);
      return { ok: false, message: "The exam set could not be saved. Please try again." };
    }
    id = data.id;
    curriculumId = input.curriculumId;
  }

  const approved = await fetchAll(
    (from, to) => client.from("questions").select("topic").eq("exam_set_id", id).eq("status", "approved").order("id").range(from, to),
    "Could not read questions",
  );
  revalidateCurriculums(curriculumId);
  return { ok: true, id, warnings: examSetWarnings({ questionCount: v.questionCount, topicMix: v.topicMix }, approved) };
}
