"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdmin, requireRole, type Profile } from "@/lib/auth/require-role";
import { findOpenAttemptId, isUuid } from "@/lib/attempts";
import { checkPassword, parseStudentsCsvWithRows, validateStudentFields, type StudentFields } from "@/lib/csv/students";
import { STUDENT_CSV_MAX_BYTES, utf8Bytes } from "@/lib/csv/limits";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createStudentAccount, existingUsernames, findActiveTrainer } from "@/lib/staff-students";
import { sendInvite } from "@/lib/invites";
import type { StudentDetailsInput } from "@/lib/student-details";

// Staff student management. Every action authenticates itself with requireRole('staff') (a
// student or anonymous caller is redirected and nothing changes). Writes run under the staff
// session (RLS) except auth users and passwords, which need the Auth admin API (service role).
// Passwords are never logged and never part of a returned value.

export type ActionResult = { ok: true } | { ok: false; message: string; code?: string };
/** `invite`: "skipped" without a contact email, "failed" when the mail could not be sent (staff can resend). */
export type CreateStudentResult = { ok: true; studentId: string; invite: "sent" | "failed" | "skipped" } | { ok: false; message: string };
/** `trainerId` only counts for an admin (null or absent = no trainer); a trainer is always the owner. */
export type CreateStudentInput = StudentFields & { trainerId?: string | null };
export type ImportPreviewRow = { row: number; username: string; fullName: string; batch: string; track: string; willInvite: boolean };
/** How the invites of an import went: mailed, skipped (no contact email) and failed (staff can resend). */
export type ImportInvites = { invited: number; noEmail: number; failed: number; failedUsernames: string[] };
export type ImportPreview = { ok: true; rows: ImportPreviewRow[]; errors: { row: number; message: string }[] };
export type ImportStudentsResult =
  | {
      ok: true;
      created: { row: number; username: string }[];
      failed: { row: number; username: string; message: string }[];
      invites: ImportInvites;
    }
  | { ok: false; message: string; errors: { row: number; message: string }[] };


const NOT_YOUR_STUDENT = "This student is not one of your students";

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

/** Only string values of a hand-made `details` object (anything else is ignored, never thrown on). */
function asDetails(v: unknown): StudentDetailsInput {
  const out: Record<string, string> = {};
  if (v && typeof v === "object") {
    for (const [key, value] of Object.entries(v)) if (typeof value === "string") out[key] = value;
  }
  return out;
}

/**
 * Who owns the students being created. A trainer is always the owner (any passed id is ignored).
 * An admin passes the chosen trainer's id, or null/nothing for no trainer; the id must belong to
 * an active trainer.
 */
async function resolveOwner(
  client: SupabaseClient,
  caller: Profile,
  requested: unknown,
  message: string,
): Promise<{ ok: true; trainerId: string | null } | { ok: false; message: string }> {
  if (caller.role === "trainer") return { ok: true, trainerId: caller.id };
  if (requested === null || requested === undefined || requested === "") return { ok: true, trainerId: null };
  const trainerId = await findActiveTrainer(client, requested);
  return trainerId ? { ok: true, trainerId } : { ok: false, message };
}

export async function createStudent(input: CreateStudentInput): Promise<CreateStudentResult> {
  const caller = await requireRole("staff");
  const checked = validateStudentFields({
    username: asText(input?.username),
    fullName: asText(input?.fullName),
    batch: asText(input?.batch),
    track: asText(input?.track),
    password: asText(input?.password),
    contactEmail: asText(input?.contactEmail),
    details: asDetails(input?.details),
  });
  if (!checked.ok) return checked;
  const client = await createClient();
  const owner = await resolveOwner(client, caller, input?.trainerId, "Choose an active trainer for this student");
  if (!owner.ok) return owner;
  const result = await createStudentAccount(client, checked.student, { trainerId: owner.trainerId });
  if (!result.ok) return result;
  revalidateStudents();
  const invite = await sendInvite(result.studentId);
  return { ok: true, studentId: result.studentId, invite };
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
  const rows = parsed.valid.map((s) => ({ row: s.row, username: s.username, fullName: s.fullName, batch: s.batch, track: s.track, willInvite: s.contactEmail !== "" }));
  return { ok: true, rows, errors: parsed.errors };
}

/**
 * Creates every student of the CSV. Validation is all-or-nothing: with any row error nothing is
 * created. Then each row is created in turn; a row that fails at that point (for example a
 * username taken in the meantime) is reported in `failed` and the others are still created.
 * Re-running the same file is safe: rows created before are reported as taken, never doubled.
 * Each created student with a contact email is mailed an invite; `invites` counts the outcomes.
 */
export async function importStudents(csvText: string, opts: { trainerId?: string | null } = {}): Promise<ImportStudentsResult> {
  const caller = await requireRole("staff");
  const text = asText(csvText);
  if (tooLong(text)) return { ok: false, message: "The file is too large (at most 1 MB).", errors: [] };
  const client = await createClient();
  const owner = await resolveOwner(client, caller, opts?.trainerId, "Choose an active trainer for these students");
  if (!owner.ok) return { ok: false, message: owner.message, errors: [] };
  const parsed = await checkStudentsCsv(client, text);
  if (parsed.errors.length > 0) {
    return { ok: false, message: "Nothing was created. Fix the rows below and import again.", errors: parsed.errors };
  }
  if (parsed.valid.length === 0) return { ok: false, message: "The file has no students.", errors: [] };

  const created: { row: number; username: string }[] = [];
  const failed: { row: number; username: string; message: string }[] = [];
  const invites: ImportInvites = { invited: 0, noEmail: 0, failed: 0, failedUsernames: [] };
  for (const { row, ...student } of parsed.valid) {
    const result = await createStudentAccount(client, student, { trainerId: owner.trainerId });
    if (!result.ok) {
      failed.push({ row, username: student.username, message: result.message });
      continue;
    }
    created.push({ row, username: student.username });
    // Same helper as the Add student form. A failed mail never undoes the student; staff resend.
    const invite = await sendInvite(result.studentId);
    if (invite === "sent") invites.invited += 1;
    else if (invite === "skipped") invites.noEmail += 1;
    else {
      invites.failed += 1;
      invites.failedUsernames.push(student.username);
    }
  }
  if (created.length > 0) revalidateStudents();
  return { ok: true, created, failed, invites };
}

/**
 * Emails the student a fresh set-your-password link (each call makes a new one). The student must
 * be one of the caller's own (RLS decides what a trainer can read).
 */
export async function resendInvite(studentId: string): Promise<ActionResult> {
  await requireRole("staff");
  const client = await createClient();
  const id = await findStudent(client, studentId);
  if (!id) return { ok: false, message: "Student not found" };
  const invite = await sendInvite(id);
  if (invite === "sent") return { ok: true };
  if (invite === "skipped") return { ok: false, message: "This student has no contact email, so no invite can be sent." };
  return { ok: false, message: "The invite could not be sent. Please try again." };
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
 * student has attempts in it, `confirm` must be true: then only the assignment (with its extra
 * attempts) is deleted; attempts and results stay for the record. The check and the
 * deletes run in one transaction in public.remove_curriculum (0016), which locks the assignment.
 */
export async function removeCurriculum(
  studentId: string,
  curriculumId: string,
  opts: { confirm?: boolean } = {},
): Promise<ActionResult> {
  const profile = await requireRole("staff");
  const client = await createClient();
  const id = await findStudent(client, studentId);
  if (!id) return { ok: false, message: "Student not found" };
  if (!isUuid(curriculumId)) return { ok: false, message: "This curriculum is not assigned" };

  // Lazy expiry first, so an attempt whose time is up does not block the removal.
  const { data: open, error: openError } = await client
    .from("attempts")
    .select("exam_set_id, exam_sets!inner(curriculum_id)")
    .eq("student_id", id)
    .eq("status", "in_progress")
    .eq("exam_sets.curriculum_id", curriculumId);
  if (openError) throw new Error(`Could not read attempts: ${openError.message}`);
  for (const a of open ?? []) await findOpenAttemptId(id, a.exam_set_id as string);

  const { data, error } = await createAdminClient().rpc("remove_curriculum", {
    p_staff_id: profile.id,
    p_student_id: id,
    p_curriculum_id: curriculumId,
    p_confirm: opts?.confirm === true,
  });
  if (error) {
    if (error.message === "not_assigned") return { ok: false, message: "This curriculum is not assigned" };
    if (error.message === "not_your_student") return { ok: false, message: NOT_YOUR_STUDENT };
    if (error.message === "in_progress") {
      return { ok: false, code: "in_progress", message: "This student is taking an exam in this curriculum right now. Try again after it ends." };
    }
    console.error("removeCurriculum failed", error.code ?? "unknown");
    return { ok: false, message: "The curriculum could not be removed. Please try again." };
  }
  const result = data as { ok: boolean; code?: string; attempts?: number };
  if (!result.ok) {
    const count = result.attempts ?? 0;
    return {
      ok: false,
      code: "has_attempts",
      message: `This student has ${count} attempt${count === 1 ? "" : "s"} in this curriculum. Confirm to remove the assignment; the attempts are kept.`,
    };
  }
  revalidateStudents(id);
  return { ok: true };
}

/**
 * Sets positions 1..n in the given order. The list must be exactly the student's curriculums.
 * One atomic write through public.reorder_curriculums (0016).
 */
export async function reorderCurriculums(studentId: string, curriculumIds: string[]): Promise<ActionResult> {
  const profile = await requireRole("staff");
  const client = await createClient();
  const id = await findStudent(client, studentId);
  if (!id) return { ok: false, message: "Student not found" };
  if (!Array.isArray(curriculumIds) || !curriculumIds.every(isUuid)) return { ok: false, message: "Invalid order" };

  const { error } = await createAdminClient().rpc("reorder_curriculums", {
    p_staff_id: profile.id,
    p_student_id: id,
    p_curriculum_ids: curriculumIds,
  });
  if (error) {
    if (error.message === "not_your_student") return { ok: false, message: NOT_YOUR_STUDENT };
    if (error.message === "order_mismatch") {
      return { ok: false, message: "The list does not match the student's curriculums. Reload the page and try again." };
    }
    console.error("reorderCurriculums failed", error.code ?? "unknown");
    return { ok: false, message: "The order could not be saved. Please try again." };
  }
  revalidateStudents(id);
  return { ok: true };
}

/**
 * Deletes a student and everything stored about them: the auth user (Auth admin API, service
 * role), and through the foreign-key cascades the profile, assignments, attempts,
 * answers and scoring snapshot. This is the DPDP erasure path. Staff must type the student's
 * username to confirm. Refused while the student has an attempt in progress (expired ones are
 * closed first). Staff accounts are not deleted here.
 */
export async function deleteStudent(studentId: string, opts: { confirmUsername?: string } = {}): Promise<ActionResult> {
  await requireAdmin();
  const client = await createClient();
  if (!isUuid(studentId)) return { ok: false, message: "Student not found" };
  const { data: student } = await client
    .from("profiles")
    .select("id, username")
    .eq("id", studentId)
    .eq("role", "student")
    .maybeSingle<{ id: string; username: string }>();
  if (!student) return { ok: false, message: "Student not found" };
  if (asText(opts?.confirmUsername).trim().toLowerCase() !== student.username) {
    return { ok: false, code: "confirm", message: `Type the username "${student.username}" to confirm.` };
  }

  const { data: open, error: openError } = await client
    .from("attempts")
    .select("exam_set_id")
    .eq("student_id", student.id)
    .eq("status", "in_progress");
  if (openError) throw new Error(`Could not read attempts: ${openError.message}`);
  for (const a of open ?? []) {
    if (await findOpenAttemptId(student.id, a.exam_set_id as string)) {
      return { ok: false, code: "in_progress", message: "This student is taking an exam right now. Try again after it ends." };
    }
  }

  const { error } = await createAdminClient().auth.admin.deleteUser(student.id);
  if (error) {
    console.error("deleteStudent failed", error.code ?? error.status ?? "unknown");
    return { ok: false, message: "The student could not be deleted. Please try again." };
  }
  revalidateStudents();
  revalidatePath("/staff/review");
  revalidatePath("/staff/results");
  return { ok: true };
}
