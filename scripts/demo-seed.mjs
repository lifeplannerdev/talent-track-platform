// Demo data for clicking through the app on the LOCAL Supabase stack (never a hosted project).
//
//   node scripts/demo-seed.mjs        (after `npm run db:reset`; reads .env.local)
//
// Creates (again, if they exist):
// - admin   demo-staff@example.test / demo-staff-pass-1 (signs in with the email)
// - trainer demo-trainer@example.test / demo-trainer-pass-1 (signs in with the email)
// - student demo.student / demo-student-pass-1 (nursing track, consent given, belongs to the demo
//   trainer, with contact email demo.student@example.test) with the two default
//   curriculums (Pflege Ausbildung, Life in Germany; migration 0010), each with two exam sets of
//   3 questions drawn from 6 German/English questions (correct option b = "Nein"), pass mark 90 %.
// TEST credentials only; passwords and keys are never printed.
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { assertLocalUrl } from "./local-url.mjs";

export { assertLocalUrl };

export const DEMO_STAFF = { email: "demo-staff@example.test", password: "demo-staff-pass-1", username: "demo.staff", fullName: "Demo Staff" };
export const DEMO_TRAINER = { email: "demo-trainer@example.test", password: "demo-trainer-pass-1", username: "demo.trainer", fullName: "Demo Trainer" };
export const DEMO_STUDENT = { username: "demo.student", password: "demo-student-pass-1", fullName: "Demo Student" };

// Fixed ids from migration 0010.
const CURRICULUMS = [
  { id: "00000000-0000-4000-8000-00000000c001", prefix: "Pflege" },
  { id: "00000000-0000-4000-8000-00000000c002", prefix: "Alltag" },
];

const OPTIONS = [
  { id: "a", de: "Ja", en: "Yes" },
  { id: "b", de: "Nein", en: "No" },
  { id: "c", de: "Vielleicht", en: "Maybe" },
];
const STEMS = [
  ["Ist Berlin die Hauptstadt von Frankreich?", "Is Berlin the capital of France?"],
  ["Hat eine Woche acht Tage?", "Does a week have eight days?"],
  ["Ist Wasser bei Raumtemperatur fest?", "Is water solid at room temperature?"],
  ["Ist der Mond aus Käse?", "Is the moon made of cheese?"],
  ["Hat ein Jahr dreizehn Monate?", "Does a year have thirteen months?"],
  ["Ist Schnee schwarz?", "Is snow black?"],
];

const must = async (promise, what) => {
  const { data, error } = await promise;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
};

async function main() {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // The variables may come from the shell instead.
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  assertLocalUrl(url);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing (copy it from `npx supabase status` into .env.local)");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const studentEmail = `${DEMO_STUDENT.username}@students.talenttrack.internal`;
  const { users } = await must(db.auth.admin.listUsers({ perPage: 1000 }), "list users");
  for (const u of users.filter((u) => u.email === studentEmail)) {
    await must(db.auth.admin.deleteUser(u.id), "delete old demo user");
  }
  // The student goes first: profiles.trainer_id keeps a trainer who still has students.
  for (const u of users.filter((u) => u.email === DEMO_STAFF.email || u.email === DEMO_TRAINER.email)) {
    await must(db.auth.admin.deleteUser(u.id), "delete old demo user");
  }

  await must(
    db.auth.admin.createUser({
      email: DEMO_STAFF.email,
      password: DEMO_STAFF.password,
      email_confirm: true,
      app_metadata: { role: "admin", username: DEMO_STAFF.username, full_name: DEMO_STAFF.fullName },
    }),
    "create demo admin",
  );
  const { user: trainer } = await must(
    db.auth.admin.createUser({
      email: DEMO_TRAINER.email,
      password: DEMO_TRAINER.password,
      email_confirm: true,
      app_metadata: { role: "trainer", username: DEMO_TRAINER.username, full_name: DEMO_TRAINER.fullName },
    }),
    "create demo trainer",
  );
  const { user: student } = await must(
    db.auth.admin.createUser({
      email: studentEmail,
      password: DEMO_STUDENT.password,
      email_confirm: true,
      app_metadata: { role: "student", username: DEMO_STUDENT.username, full_name: DEMO_STUDENT.fullName, track: "nursing", trainer_id: trainer.id },
    }),
    "create demo student",
  );
  await must(
    db.from("student_details").insert({ student_id: student.id, contact_email: `${DEMO_STUDENT.username}@example.test` }),
    "create demo student details",
  );
  await must(db.from("profiles").update({ consent_at: new Date().toISOString() }).eq("id", student.id), "record consent");

  for (const [i, c] of CURRICULUMS.entries()) {
    // Replace earlier demo exam sets (their questions cascade); other exam sets are left alone.
    await must(db.from("exam_sets").delete().eq("curriculum_id", c.id).like("name", "Demo %"), "remove old demo exam sets");
    for (const n of [1, 2]) {
      const set = await must(
        db
          .from("exam_sets")
          .insert({ curriculum_id: c.id, name: `Demo ${c.prefix} ${n}`, question_count: 3, time_limit_min: 30, pass_mark_percent: 90 })
          .select("id")
          .single(),
        "create exam set",
      );
      const stems = STEMS.slice((n - 1) * 3, n * 3);
      await must(
        db.from("questions").insert(
          stems.map(([de, en]) => ({
            exam_set_id: set.id,
            topic: "allgemein",
            difficulty: "easy",
            stem_de: de,
            stem_en: en,
            options: OPTIONS,
            correct_option_id: "b",
            points: 1,
            status: "approved",
          })),
        ),
        "create questions",
      );
    }
    await must(
      db.from("assignments").insert({ student_id: student.id, curriculum_id: c.id, position: i + 1, status: "open" }),
      "assign curriculum",
    );
  }

  console.log("Demo data ready: admin demo-staff@example.test, trainer demo-trainer@example.test and student demo.student (passwords in scripts/demo-seed.mjs).");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : "demo-seed failed");
    process.exit(1);
  });
}
