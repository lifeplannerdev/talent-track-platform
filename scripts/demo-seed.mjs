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
// - a published demo book for Pflege Ausbildung (4 generated pages, 2 chapters), replaced on every run.
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


const BOOK_BUCKET = "book-pages";
const DEMO_BOOK_PAGES = 4;
const DEMO_BOOK_CHAPTERS = [
  { title: "Willkommen in der Pflege", start: 1 },
  { title: "Im Gespräch mit Patienten", start: 3 },
];

async function demoPageImage(sharp, page, scale) {
  const w = Math.round(600 * scale);
  const h = Math.round(800 * scale);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 600 800">
    <rect width="100%" height="100%" fill="#ffffff"/>
    <rect x="12" y="12" width="576" height="776" fill="none" stroke="#2346a0" stroke-width="6"/>
    <rect x="48" y="64" width="270" height="22" fill="#c7d2ee"/>
    ${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="48" y="${130 + i * 36}" width="${i % 2 ? 360 : 468}" height="12" fill="#e6eaf4"/>`).join("")}
    <text x="300" y="744" font-family="sans-serif" font-size="56" text-anchor="middle" fill="#14213d">${page}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).webp({ quality: 70 }).toBuffer();
}

// Replaces the demo book of the Pflege curriculum (files, pages and chapters) with a fresh published one.
async function seedDemoBook(db, curriculumId) {
  const { default: sharp } = await import("sharp");
  const bucket = db.storage.from(BOOK_BUCKET);
  const folders = await must(bucket.list(curriculumId, { limit: 1000 }), "list old book folders");
  for (const folder of folders) {
    const files = await must(bucket.list(`${curriculumId}/${folder.name}`, { limit: 1000 }), "list old book files");
    const paths = files.map((f) => `${curriculumId}/${folder.name}/${f.name}`);
    if (paths.length > 0) await must(bucket.remove(paths), "remove old book files");
  }
  await must(db.from("chapters").delete().eq("curriculum_id", curriculumId), "remove old chapters");
  await must(db.from("books").delete().eq("curriculum_id", curriculumId), "remove old book");
  const uploadId = crypto.randomUUID();
  await must(
    db.from("books").insert({ curriculum_id: curriculumId, status: "published", page_count: DEMO_BOOK_PAGES, upload_id: uploadId }),
    "create demo book",
  );
  const rows = [];
  for (let n = 1; n <= DEMO_BOOK_PAGES; n++) {
    const path = `${curriculumId}/${uploadId}/${n}.webp`;
    const thumbPath = `${curriculumId}/${uploadId}/${n}.thumb.webp`;
    for (const [p, scale] of [[path, 1], [thumbPath, 0.25]]) {
      await must(bucket.upload(p, await demoPageImage(sharp, n, scale), { contentType: "image/webp", upsert: true }), "upload demo page");
    }
    rows.push({ curriculum_id: curriculumId, page_number: n, path, thumb_path: thumbPath, width: 600, height: 800 });
  }
  await must(db.from("book_pages").insert(rows), "create demo pages");
  await must(
    db.from("chapters").insert(DEMO_BOOK_CHAPTERS.map((c) => ({ curriculum_id: curriculumId, title: c.title, start_page: c.start }))),
    "create demo chapters",
  );
}

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

  await seedDemoBook(db, CURRICULUMS[0].id);

  console.log("Demo data ready: admin demo-staff@example.test, trainer demo-trainer@example.test and student demo.student (passwords in scripts/demo-seed.mjs).");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : "demo-seed failed");
    process.exit(1);
  });
}
