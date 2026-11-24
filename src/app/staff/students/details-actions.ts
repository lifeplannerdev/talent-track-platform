"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireRole } from "@/lib/auth/require-role";
import { isUuid } from "@/lib/attempts";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { findActiveTrainer } from "@/lib/staff-students";
import { detailsToRow, validateStudentDetails, type StudentDetailsInput } from "@/lib/student-details";

// Student details (personal data) and trainer assignment. Never log the details.

export type DetailsResult = { ok: true } | { ok: false; message: string };
export type AssignTrainerResult = { ok: true; message: string } | { ok: false; message: string };

const NOT_FOUND = "Student not found";

function revalidate(studentId: string) {
  revalidatePath("/staff/students");
  revalidatePath(`/staff/students/${studentId}`);
  revalidatePath("/staff");
}

/** Only string values of a hand-made object (anything else is ignored, never thrown on). */
function asDetails(v: unknown): StudentDetailsInput {
  const out: Record<string, string> = {};
  if (v && typeof v === "object") {
    for (const [key, value] of Object.entries(v)) if (typeof value === "string") out[key] = value;
  }
  return out;
}

/**
 * Saves a student's details (first save creates the row, later ones update it). Runs under the
 * staff session, so RLS decides whose students can be written: a trainer's student that belongs
 * to someone else is invisible here and answers "Student not found".
 */
export async function saveStudentDetails(input: { studentId: string; details: StudentDetailsInput }): Promise<DetailsResult> {
  await requireRole("staff");
  const studentId = input?.studentId;
  if (!isUuid(studentId)) return { ok: false, message: NOT_FOUND };
  const client = await createClient();
  const { data: student } = await client.from("profiles").select("id").eq("id", studentId).eq("role", "student").maybeSingle();
  if (!student) return { ok: false, message: NOT_FOUND };

  // An expiry already stored may be resubmitted even if it has passed since; only new or changed
  // values are checked against today.
  const { data: stored } = await client.from("student_details").select("passport_expiry").eq("student_id", studentId).maybeSingle();
  const checked = validateStudentDetails(asDetails(input.details), new Date(), { keepExpiry: (stored?.passport_expiry as string | null | undefined) ?? null });
  if (!checked.ok) return checked;

  // student_id and the timestamps are not updatable by a session (0027), so no upsert: update the
  // row, and insert it when this is the first save.
  const row = detailsToRow(checked.details);
  const updated = await client.from("student_details").update(row).eq("student_id", studentId).select("student_id");
  let failure: { code?: string } | null = updated.error;
  if (!failure && (updated.data?.length ?? 0) === 0) {
    const inserted = await client.from("student_details").insert({ student_id: studentId, ...row }).select("student_id");
    failure = inserted.error ?? ((inserted.data?.length ?? 0) === 0 ? { code: "no row" } : null);
  }
  if (failure) {
    console.error("saveStudentDetails failed", failure.code ?? "unknown");
    return { ok: false, message: "The details could not be saved. Please try again." };
  }
  revalidate(studentId);
  return { ok: true };
}

/**
 * Admin only: sets the student's trainer (empty = no trainer). The trainer must be an active
 * trainer. profiles.trainer_id is only writable with the service role (0025/0026).
 */
export async function assignTrainer(input: { studentId: string; trainerId: string | null }): Promise<AssignTrainerResult> {
  await requireAdmin();
  const studentId = input?.studentId;
  const client = await createClient();
  if (!isUuid(studentId)) return { ok: false, message: NOT_FOUND };
  const { data: student } = await client.from("profiles").select("id").eq("id", studentId).eq("role", "student").maybeSingle();
  if (!student) return { ok: false, message: NOT_FOUND };

  const requested = input.trainerId;
  const none = requested === null || requested === undefined || requested === "";
  const trainerId = none ? null : await findActiveTrainer(client, requested);
  if (!none && !trainerId) return { ok: false, message: "Choose an active trainer for this student" };

  const { error } = await createAdminClient().from("profiles").update({ trainer_id: trainerId }).eq("id", studentId).eq("role", "student");
  if (error) {
    console.error("assignTrainer failed", error.code ?? "unknown");
    return { ok: false, message: "The trainer could not be changed. Please try again." };
  }
  revalidate(studentId);
  return { ok: true, message: trainerId ? "Trainer changed." : "Trainer removed." };
}
