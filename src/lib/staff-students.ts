import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { usernameToEmail } from "@/lib/auth/username";
import type { NewStudent, Track } from "@/lib/csv/students";

// Student accounts are created only here, by staff (public sign-up is off). The auth user is
// created with the Auth admin API (service role); app_metadata carries exactly what the
// on_auth_user_created trigger reads (role, username, full_name, batch, track). Passwords are
// passed straight to the admin API and never logged, stored or returned.

export const PFLEGE_CURRICULUM = "Pflege Ausbildung";
export const LIFE_CURRICULUM = "Life in Germany";

/** Curriculums a new student gets, in position order. */
export function curriculumsForTrack(track: Track): string[] {
  return track === "nursing" ? [PFLEGE_CURRICULUM, LIFE_CURRICULUM] : [LIFE_CURRICULUM];
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
 * Looks up the default curriculums for `track` by name. Returns ids in position order, or a
 * staff-facing message naming the missing curriculum.
 */
export async function defaultCurriculumIds(
  client: SupabaseClient,
  track: Track,
): Promise<{ ok: true; ids: string[] } | { ok: false; message: string }> {
  const names = curriculumsForTrack(track);
  const { data, error } = await client.from("curriculums").select("id, name").in("name", names);
  if (error) throw new Error(`Could not read curriculums: ${error.message}`);
  const ids: string[] = [];
  for (const name of names) {
    const row = data?.find((c) => c.name === name);
    if (!row) return { ok: false, message: `The curriculum "${name}" does not exist. Create it on the Curriculums page first.` };
    ids.push(row.id);
  }
  return { ok: true, ids };
}

/**
 * Creates the auth user (and, through the trigger, the profile) and assigns the default
 * curriculums for the track. `staff` is the staff session client (assignments are written under
 * staff RLS). If the assignments cannot be written the new user is deleted again, so there is
 * never a half-created student.
 */
export async function createStudentAccount(staff: SupabaseClient, student: NewStudent): Promise<CreateAccountResult> {
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
    },
  });
  if (error || !data.user) {
    // A concurrent create (same email, or a profile username clash raised by the trigger).
    if ((await existingUsernames(staff, [student.username])).has(student.username) || error?.code === "email_exists") {
      return { ok: false, message: takenMessage(student.username) };
    }
    console.error("createStudentAccount: createUser failed", error?.code ?? "unknown", error?.status ?? "");
    return { ok: false, message: "The student could not be created. Please try again." };
  }

  const studentId = data.user.id;
  const { error: assignError } = await staff.from("assignments").insert(
    curriculums.ids.map((curriculumId, i) => ({ student_id: studentId, curriculum_id: curriculumId, position: i + 1 })),
  );
  if (assignError) {
    console.error("createStudentAccount: assignments failed, removing the new user", assignError.code);
    await admin.auth.admin.deleteUser(studentId);
    return { ok: false, message: "The student could not be created. Please try again." };
  }
  return { ok: true, studentId };
}
