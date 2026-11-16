import { createClient } from "@supabase/supabase-js";
import { usernameToEmail } from "../src/lib/auth/username";
import { NEXT_CURRICULUM, STAFF, STUDENT_CONSENTED, STUDENT_NEW } from "./fixtures";

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Recreates the e2e users and assignments from scratch (idempotent). Uses the local service role. */
export async function seed() {
  const db = admin();

  const { data: list, error: listError } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw listError;
  const emails = [STAFF.email, usernameToEmail(STUDENT_NEW.username), usernameToEmail(STUDENT_CONSENTED.username)];
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
}
