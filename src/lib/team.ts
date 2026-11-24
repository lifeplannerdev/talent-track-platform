import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type TrainerRow = {
  id: string;
  name: string;
  username: string;
  email: string;
  active: boolean;
  students: number;
  /** False until the trainer has signed in once, i.e. has not chosen a password through the invite yet. */
  signedIn: boolean;
};

/** Every trainer (active or not) with their student count. Admin session (RLS) plus the Auth admin API for emails. */
export async function listTrainers(): Promise<TrainerRow[]> {
  const db = await createClient();
  const [{ data: trainers, error }, { data: students, error: studentsError }] = await Promise.all([
    db.from("profiles").select("id, username, full_name, active").eq("role", "trainer").order("username"),
    db.from("profiles").select("trainer_id").eq("role", "student").not("trainer_id", "is", null),
  ]);
  if (error) throw new Error(`Could not read trainers: ${error.message}`);
  if (studentsError) throw new Error(`Could not read students: ${studentsError.message}`);
  const counts = new Map<string, number>();
  for (const s of students ?? []) counts.set(s.trainer_id as string, (counts.get(s.trainer_id as string) ?? 0) + 1);

  const admin = createAdminClient();
  return Promise.all(
    (trainers ?? []).map(async (t) => {
      const { data } = await admin.auth.admin.getUserById(t.id as string);
      return {
        id: t.id as string,
        name: (t.full_name as string | null) ?? (t.username as string),
        username: t.username as string,
        email: data?.user?.email ?? "",
        active: t.active as boolean,
        students: counts.get(t.id as string) ?? 0,
        signedIn: Boolean(data?.user?.last_sign_in_at),
      };
    }),
  );
}
