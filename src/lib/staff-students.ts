import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid } from "@/lib/attempts";
import { createAdminClient } from "@/lib/supabase/admin";
import { usernameToEmail } from "@/lib/auth/username";
import type { NewStudent, Track } from "@/lib/csv/students";
import { detailsToRow } from "@/lib/student-details";

// Student accounts are created only here, by staff (public sign-up is off). The auth user is
// created with the Auth admin API (service role); app_metadata carries exactly what the
// on_auth_user_created trigger reads (role, username, full_name, batch, track). Passwords are
// passed straight to the admin API and never logged, stored or returned.

// Fixed ids from migration 0010. Looked up by id, so staff can rename the curriculums freely.
export const PFLEGE_CURRICULUM_ID = "00000000-0000-4000-8000-00000000c001";
export const LIFE_CURRICULUM_ID = "00000000-0000-4000-8000-00000000c002";
const DEFAULT_NAMES: Record<string, string> = {
  [PFLEGE_CURRICULUM_ID]: "Pflege Ausbildung",
  [LIFE_CURRICULUM_ID]: "Life in Germany",
};

/** Curriculum ids a new student gets, in position order. */
export function curriculumsForTrack(track: Track): string[] {
  return track === "nursing" ? [PFLEGE_CURRICULUM_ID, LIFE_CURRICULUM_ID] : [LIFE_CURRICULUM_ID];
}

/** The id when `id` is an active trainer (as seen by `client`), else null. Used for every owner choice. */
export async function findActiveTrainer(client: SupabaseClient, id: unknown): Promise<string | null> {
  if (!isUuid(id)) return null;
  const { data } = await client.from("profiles").select("id").eq("id", id).eq("role", "trainer").eq("active", true).maybeSingle();
  return data?.id ?? null;
}

export type CreateAccountResult = { ok: true; studentId: string } | { ok: false; message: string };

export function takenMessage(username: string) {
  return `Username "${username}" is already taken`;
}

/** Usernames of every profile (students and staff), lower-case. */
export async function existingUsernames(client: SupabaseClient, usernames: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  // Query in chunks to keep the URL short.
  for (let i = 0; i < usernames.length; i += 100) {
    const chunk = usernames.slice(i, i + 100);
    if (chunk.length === 0) continue;
    const { data, error } = await client.from("profiles").select("username").in("username", chunk);
    if (error) throw new Error(`Could not check usernames: ${error.message}`);
    for (const r of data ?? []) out.add(r.username);
  }
  return out;
}

/**
 * Checks that the default curriculums for `track` exist (by their fixed ids). Returns the ids in
 * position order, or a staff-facing message naming the missing curriculum.
 */
export async function defaultCurriculumIds(
  client: SupabaseClient,
  track: Track,
): Promise<{ ok: true; ids: string[] } | { ok: false; message: string }> {
  const ids = curriculumsForTrack(track);
  const { data, error } = await client.from("curriculums").select("id").in("id", ids);
  if (error) throw new Error(`Could not read curriculums: ${error.message}`);
  for (const id of ids) {
    if (!data?.some((c) => c.id === id)) {
      return {
        ok: false,
        message: `The default curriculum "${DEFAULT_NAMES[id]}" is missing. Re-apply the database migrations (0010) before adding students.`,
      };
    }
  }
  return { ok: true, ids };
}

const GENERIC_CREATE_FAILURE = "The student could not be created. Please try again.";

/**
 * Creates the auth user (and, through the trigger, the profile) with its owner, saves the
 * details row when there is one, and assigns the default curriculums for the track. `staff` is
 * the staff session client: details and assignments are written under staff RLS, which needs the
 * owner to be in place already, so the owner (`trainerId`, or null for an unowned student) goes
 * into the createUser app_metadata that the on_auth_user_created trigger reads. Callers decide
 * and validate the owner (see resolveOwner in the student actions). If the details or the
 * assignments cannot be written the new user is deleted again (the cascades remove profile and
 * details), so there is never a half-created student.
 */
export async function createStudentAccount(
  staff: SupabaseClient,
  student: NewStudent,
  owner: { trainerId: string | null },
): Promise<CreateAccountResult> {
  const curriculums = await defaultCurriculumIds(staff, student.track);
  if (!curriculums.ok) return curriculums;

  if ((await existingUsernames(staff, [student.username])).has(student.username)) {
    return { ok: false, message: takenMessage(student.username) };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: usernameToEmail(student.username),
    password: student.password,
    email_confirm: true,
    app_metadata: {
      role: "student",
      username: student.username,
      full_name: student.fullName,
      ...(student.batch ? { batch: student.batch } : {}),
      track: student.track,
      ...(owner.trainerId ? { trainer_id: owner.trainerId } : {}),
    },
  });
  if (error || !data.user) {
    // A concurrent create (same email, or a profile username clash raised by the trigger).
    if ((await existingUsernames(staff, [student.username])).has(student.username) || error?.code === "email_exists") {
      return { ok: false, message: takenMessage(student.username) };
    }
    console.error("createStudentAccount: createUser failed", error?.code ?? "unknown", error?.status ?? "");
    return { ok: false, message: GENERIC_CREATE_FAILURE };
  }

  const studentId = data.user.id;
  const rollback = async (step: string, code: string | undefined): Promise<CreateAccountResult> => {
    console.error(`createStudentAccount: ${step} failed, removing the new user`, code ?? "unknown");
    const { error: deleteError } = await admin.auth.admin.deleteUser(studentId);
    if (deleteError) {
      console.error("createStudentAccount: cleanup failed", deleteError.code ?? deleteError.status ?? "unknown");
      return {
        ok: false,
        message: `The student could not be created, and the cleanup failed, contact admin: an incomplete account "${student.username}" may exist.`,
      };
    }
    return { ok: false, message: GENERIC_CREATE_FAILURE };
  };

  // A thrown error (not just a returned one) must also remove the new user.
  try {
    if (student.details) {
      const { error: detailsError } = await staff
        .from("student_details")
        .insert({ student_id: studentId, ...detailsToRow(student.details) });
      if (detailsError) return await rollback("details", detailsError.code);
    }

    const { error: assignError } = await staff.from("assignments").insert(
      curriculums.ids.map((curriculumId, i) => ({ student_id: studentId, curriculum_id: curriculumId, position: i + 1 })),
    );
    if (assignError) return await rollback("assignments", assignError.code);
  } catch {
    return rollback("unexpected error", undefined);
  }
  return { ok: true, studentId };
}
