"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireRole } from "@/lib/auth/require-role";
import { findOpenAttemptId, isUuid } from "@/lib/attempts";
import { checkPassword, parseStudentsCsvWithRows, validateStudentFields, type StudentFields } from "@/lib/csv/students";
import { STUDENT_CSV_MAX_BYTES, utf8Bytes } from "@/lib/csv/limits";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createStudentAccount, existingUsernames } from "@/lib/staff-students";

// Staff student management. Every action authenticates itself with requireRole('staff') (a
// student or anonymous caller is redirected and nothing changes). Writes run under the staff
// session (RLS) except auth users and passwords, which need the Auth admin API (service role).
// Passwords are never logged and never part of a returned value.

export type ActionResult = { ok: true } | { ok: false; message: string; code?: string };
export type CreateStudentResult = { ok: true; studentId: string } | { ok: false; message: string };
export type ImportPreviewRow = { row: number; username: string; fullName: string; batch: string; track: string };
export type ImportPreview = { ok: true; rows: ImportPreviewRow[]; errors: { row: number; message: string }[] };
export type ImportStudentsResult =
  | { ok: true; created: { row: number; username: string }[]; failed: { row: number; username: string; message: string }[] }
  | { ok: false; message: string; errors: { row: number; message: string }[] };


function asText(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function revalidateStudents(studentId?: string) {
  revalidatePath("/staff/students");
  if (studentId) revalidatePath(`/staff/students/${studentId}`);
  revalidatePath("/staff");
  revalidatePath("/staff/grants");
  revalidatePath("/staff/blocked");
}

/** The student's profile id if `id` is a student, else null (staff accounts are not managed here). */
async function findStudent(client: SupabaseClient, id: unknown): Promise<string | null> {
  if (!isUuid(id)) return null;
  const { data } = await client.from("profiles").select("id").eq("id", id).eq("role", "student").maybeSingle();
  return data?.id ?? null;
}

export async function createStudent(input: StudentFields): Promise<CreateStudentResult> {
  await requireRole("staff");
  const checked = validateStudentFields({
    username: asText(input?.username),
    fullName: asText(input?.fullName),
    batch: asText(input?.batch),
    track: asText(input?.track),
    password: asText(input?.password),
  });
  if (!checked.ok) return checked;
  const result = await createStudentAccount(await createClient(), checked.student);
  if (result.ok) revalidateStudents();
  return result;
}

/** Parses the CSV and checks usernames against existing accounts. Returns no passwords. */
async function checkStudentsCsv(client: SupabaseClient, csvText: string) {
  const first = parseStudentsCsvWithRows(csvText);
  const taken = await existingUsernames(client, first.valid.map((s) => s.username));
  if (taken.size === 0) return first;
  return parseStudentsCsvWithRows(csvText, { existingUsernames: taken });
}

function tooLong(csvText: string) {
  return utf8Bytes(csvText) > STUDENT_CSV_MAX_BYTES;
}

export async function previewStudentsImport(csvText: string): Promise<ImportPreview | { ok: false; message: string }> {
  await requireRole("staff");
  const text = asText(csvText);
  if (tooLong(text)) return { ok: false, message: "The file is too large (at most 1 MB)." };
  const parsed = await checkStudentsCsv(await createClient(), text);
  // Everything except the password.
  const rows = parsed.valid.map((s) => ({ row: s.row, username: s.username, fullName: s.fullName, batch: s.batch, track: s.track }));
  return { ok: true, rows, errors: parsed.errors };
}

/**
 * Creates every student of the CSV. Validation is all-or-nothing: with any row error nothing is
 * created. Then each row is created in turn; a row that fails at that point (for example a
 * username taken in the meantime) is reported in `failed` and the others are still created.
 * Re-running the same file is safe: rows created before are reported as taken, never doubled.
 */
export async function importStudents(csvText: string): Promise<ImportStudentsResult> {
  await requireRole("staff");
  const text = asText(csvText);
  if (tooLong(text)) return { ok: false, message: "The file is too large (at most 1 MB).", errors: [] };
  const client = await createClient();
  const parsed = await checkStudentsCsv(client, text);
  if (parsed.errors.length > 0) {
    return { ok: false, message: "Nothing was created. Fix the rows below and import again.", errors: parsed.errors };
  }
  if (parsed.valid.length === 0) return { ok: false, message: "The file has no students.", errors: [] };

  const created: { row: number; username: string }[] = [];
  const failed: { row: number; username: string; message: string }[] = [];
  for (const { row, ...student } of parsed.valid) {
    const result = await createStudentAccount(client, student);
    if (result.ok) created.push({ row, username: student.username });
    else failed.push({ row, username: student.username, message: result.message });
  }
  if (created.length > 0) revalidateStudents();
  return { ok: true, created, failed };
}

export async function resetPassword(studentId: string, newPassword: string): Promise<ActionResult> {
  await requireRole("staff");
  const client = await createClient();
  const id = await findStudent(client, studentId);
  if (!id) return { ok: false, message: "Student not found" };
  const password = asText(newPassword);
  const problem = checkPassword(password);
  if (problem) return { ok: false, message: problem };
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(id, { password });
  if (error) {
    console.error("resetPassword failed", error.code ?? "unknown");
    return { ok: false, message: "The password could not be changed. Please try again." };
  }
  // End every existing session, so a leaked password or a signed-in device stops working at once.
  const { error: revokeError } = await admin.rpc("revoke_user_sessions", { p_user_id: id });
  if (revokeError) {
    console.error("resetPassword: revoke_user_sessions failed", revokeError.code ?? "unknown");
    return {
      ok: false,
      message: "The password was changed, but the student's existing sessions could not be ended. Please try again or contact the administrator.",
    };
  }
  return { ok: true };
}

export async function assignCurriculum(studentId: string, curriculumId: string): Promise<ActionResult> {
  await requireRole("staff");
  const client = await createClient();
  const id = await findStudent(client, studentId);
  if (!id) return { ok: false, message: "Student not found" };
  if (!isUuid(curriculumId)) return { ok: false, message: "Curriculum not found" };
  const { data: curriculum } = await client.from("curriculums").select("id").eq("id", curriculumId).maybeSingle();
  if (!curriculum) return { ok: false, message: "Curriculum not found" };

  const { data: last } = await client
    .from("assignments")
    .select("position")
    .eq("student_id", id)
    .order("position", { ascending: false })
    .limit(1);
  const position = (last?.[0]?.position ?? 0) + 1;
  const { error } = await client.from("assignments").insert({ student_id: id, curriculum_id: curriculumId, position });
  if (error) {
    if (error.code === "23505") return { ok: false, message: "This curriculum is already assigned" };
    console.error("assignCurriculum failed", error.code);
    return { ok: false, message: "The curriculum could not be assigned. Please try again." };
  }
  revalidateStudents(id);
  return { ok: true };
}

/**
 * Removes a curriculum from a student. Refused while an attempt in it is in progress. When the
 * student has attempts in it, `confirm` must be true: then only the assignment (and unused grants
 * for its exam sets) are deleted; attempts and results stay for the record.
 */
export async function removeCurriculum(
  studentId: string,
  curriculumId: string,
  opts: { confirm?: boolean } = {},
): Promise<ActionResult> {
  await requireRole("staff");
  const client = await createClient();
  const id = await findStudent(client, studentId);
  if (!id) return { ok: false, message: "Student not found" };
  if (!isUuid(curriculumId)) return { ok: false, message: "This curriculum is not assigned" };
  const { data: assignment } = await client
    .from("assignments")
    .select("id")
    .eq("student_id", id)
    .eq("curriculum_id", curriculumId)
    .maybeSingle();
  if (!assignment) return { ok: false, message: "This curriculum is not assigned" };

  const { data: sets, error: setsError } = await client.from("exam_sets").select("id").eq("curriculum_id", curriculumId);
  if (setsError) throw new Error(`Could not read exam sets: ${setsError.message}`);
  const setIds = (sets ?? []).map((s) => s.id as string);

  if (setIds.length > 0) {
    const { data: attempts, error } = await client
      .from("attempts")
      .select("id, exam_set_id, status")
      .eq("student_id", id)
      .in("exam_set_id", setIds);
    if (error) throw new Error(`Could not read attempts: ${error.message}`);
    // Lazy expiry first, so an attempt whose time is up does not block the removal.
    for (const setId of new Set((attempts ?? []).filter((a) => a.status === "in_progress").map((a) => a.exam_set_id as string))) {
      if (await findOpenAttemptId(id, setId)) {
        return { ok: false, code: "in_progress", message: "This student is taking an exam in this curriculum right now. Try again after it ends." };
      }
    }
    const count = attempts?.length ?? 0;
    if (count > 0 && opts?.confirm !== true) {
      return {
        ok: false,
        code: "has_attempts",
        message: `This student has ${count} attempt${count === 1 ? "" : "s"} in this curriculum. Confirm to remove the assignment; the attempts are kept.`,
      };
    }
    const { error: grantsError } = await client
      .from("attempt_grants")
      .delete()
      .eq("student_id", id)
      .in("exam_set_id", setIds)
      .is("used_attempt_id", null);
    if (grantsError) throw new Error(`Could not remove unused grants: ${grantsError.message}`);
  }

  const { error } = await client.from("assignments").delete().eq("id", assignment.id);
  if (error) {
    console.error("removeCurriculum failed", error.code);
    return { ok: false, message: "The curriculum could not be removed. Please try again." };
  }
  revalidateStudents(id);
  return { ok: true };
}

/** Sets positions 1..n in the given order. The list must be exactly the student's curriculums. */
export async function reorderCurriculums(studentId: string, curriculumIds: string[]): Promise<ActionResult> {
  await requireRole("staff");
  const client = await createClient();
  const id = await findStudent(client, studentId);
  if (!id) return { ok: false, message: "Student not found" };
  if (!Array.isArray(curriculumIds) || !curriculumIds.every(isUuid)) return { ok: false, message: "Invalid order" };

  const { data: rows, error } = await client.from("assignments").select("id, curriculum_id").eq("student_id", id);
  if (error) throw new Error(`Could not read assignments: ${error.message}`);
  const byCurriculum = new Map((rows ?? []).map((r) => [r.curriculum_id as string, r.id as string]));
  if (new Set(curriculumIds).size !== curriculumIds.length || curriculumIds.length !== byCurriculum.size || !curriculumIds.every((c) => byCurriculum.has(c))) {
    return { ok: false, message: "The list does not match the student's curriculums. Reload the page and try again." };
  }
  for (let i = 0; i < curriculumIds.length; i++) {
    const { error: updateError } = await client
      .from("assignments")
      .update({ position: i + 1 })
      .eq("id", byCurriculum.get(curriculumIds[i])!);
    if (updateError) {
      console.error("reorderCurriculums failed", updateError.code);
      return { ok: false, message: "The order could not be saved. Please try again." };
    }
  }
  revalidateStudents(id);
  return { ok: true };
}
