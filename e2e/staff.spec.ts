import { expect, test } from "@playwright/test";
import { usernameToEmail } from "../src/lib/auth/username";
import {
  BLOCK_CURRICULUM,
  BLOCK_OTHER_CURRICULUM,
  STAFF,
  STAFF_CURRICULUM,
  STAFF_EXAM_SET,
  STUDENT_BLOCK,
  STUDENT_BY_TRAINER,
  STUDENT_CREATED,
  STUDENT_OF_ONE,
  STUDENT_OF_TWO,
  TRAINER_ADDED,
  TRAINER_ONE,
  TRAINER_TWO,
} from "./fixtures";
import { curriculumCard, expectNoHorizontalOverflow, signIn } from "./helpers";
import { adminDb, seed } from "./seed";

// Staff management end to end: create a nursing student, create a curriculum and exam set,
// set its attempts per student, import 20 bilingual questions, assign it and give an extra attempt
// at any time; the new student signs in and starts (no approval needed).

const CSV_HEADER =
  "topic,difficulty,stem_de,stem_en,option_a_de,option_a_en,option_b_de,option_b_en,option_c_de,option_c_en,option_d_de,option_d_en,correct,points";

function questionsCsv(count: number): string {
  const rows = Array.from({ length: count }, (_, i) => {
    const topic = i < 12 ? "Pflege" : "Recht";
    return `${topic},easy,"Frage ${i + 1}: Größe, Übung und Wärme?","Question ${i + 1}: size, practice and warmth?",Ja,Yes,Nein,No,Vielleicht,Maybe,Später,Later,b,1`;
  });
  return [CSV_HEADER, ...rows].join("\n");
}

async function cleanUp() {
  const db = adminDb();
  const { data: list, error } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  for (const u of list.users.filter((u) => u.email === usernameToEmail(STUDENT_CREATED.username))) {
    await db.auth.admin.deleteUser(u.id);
  }
  await db.from("curriculums").delete().eq("name", STAFF_CURRICULUM);
}

test.beforeEach(async () => {
  await seed();
  await cleanUp();
});

test.afterAll(async () => {
  await cleanUp();
});

test("staff create a nursing student, a curriculum with its attempts per student, an exam set and 20 questions; the student starts without approval", async ({ page }) => {
  await signIn(page, STAFF.email, STAFF.password, /\/staff$/);

  // 1. Create the student (track nursing).
  await page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Students" }).click();
  await expect(page).toHaveURL(/\/staff\/students$/);
  const add = page.getByRole("form", { name: "Add student" });
  await add.getByLabel("Username").fill(STUDENT_CREATED.username);
  await add.getByLabel("Full name").fill(STUDENT_CREATED.fullName);
  await add.getByLabel("Batch").fill("E2E-B1");
  await add.getByLabel("Track").selectOption("nursing");
  await add.getByLabel("First password").fill(STUDENT_CREATED.password);
  await add.getByLabel("Contact email").fill("t8nurse@example.test");
  await add.getByRole("button", { name: "Create student" }).click();
  await expect(page.getByTestId("add-student-success")).toContainText(`Student ${STUDENT_CREATED.username} created.`);
  // The password is never shown or put into the URL.
  await expect(page.locator("body")).not.toContainText(STUDENT_CREATED.password);
  expect(page.url()).not.toContain(STUDENT_CREATED.password);
  await expect(add.getByLabel("First password")).toHaveValue("");

  // The list finds the student by search.
  await page.getByRole("searchbox", { name: "Search" }).fill("t8nurse");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page).toHaveURL(/q=t8nurse/);
  const row = page.getByRole("row").filter({ hasText: STUDENT_CREATED.fullName });
  await expect(row).toContainText("Pflege Ausbildung");
  await expect(row).toContainText("Life in Germany");

  // 2. Create a curriculum and an exam set with a topic mix.
  await page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Curriculums" }).click();
  await page.getByRole("textbox", { name: "New curriculum" }).fill(STAFF_CURRICULUM);
  await page.getByRole("button", { name: "Create curriculum" }).click();
  await expect(page).toHaveURL(/\/staff\/curriculums\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("curriculum-name")).toHaveText(STAFF_CURRICULUM);
  // Attempts per student: 2 by default, staff set 3.
  const settings = page.getByRole("form", { name: "Curriculum settings" });
  await expect(settings.getByLabel("Attempts per student")).toHaveValue("2");
  await settings.getByLabel("Attempts per student").fill("3");
  await settings.getByRole("button", { name: "Save curriculum" }).click();
  await expect(settings.getByTestId("curriculum-saved")).toContainText("Curriculum saved.");
  const { data: savedCurriculum } = await adminDb().from("curriculums").select("max_attempts").eq("name", STAFF_CURRICULUM).single();
  expect(savedCurriculum!.max_attempts).toBe(3);
  const setForm = page.getByRole("form", { name: "New exam set" });
  await setForm.getByLabel("Exam set name").fill(STAFF_EXAM_SET);
  await setForm.getByLabel("Questions per paper").fill("5");
  await setForm.getByLabel("Hours", { exact: true }).fill("2");
  await setForm.getByLabel("Minutes", { exact: true }).fill("30");
  // A new exam set proposes the 90% standard; staff can still choose another pass mark.
  await expect(setForm.getByLabel("Pass mark (%)")).toHaveValue("90");
  await setForm.getByLabel("Pass mark (%)").fill("60");
  // Attempts and holding results are not exam set settings any more.
  await expect(setForm.getByLabel("Maximum attempts")).toHaveCount(0);
  await expect(setForm.getByLabel("Hold results for review")).toHaveCount(0);
  // A mix that does not add up is refused.
  await setForm.getByLabel("Topic mix (optional)").fill("Pflege: 3\nRecht: 1");
  await setForm.getByRole("button", { name: "Create exam set" }).click();
  await expect(setForm).toContainText("Topic counts add up to 4, but the exam has 5 questions");
  await setForm.getByLabel("Topic mix (optional)").fill("Pflege: 3\nRecht: 2");
  await setForm.getByRole("button", { name: "Create exam set" }).click();
  await expect(setForm.getByTestId("exam-set-preview")).toContainText(
    "5 questions, 2 h 30 min, pass at 60%, result shown at once, reminder every 15 min",
  );
  await expect(setForm.getByTestId("exam-set-saved")).toContainText("Exam set created.");
  await expect(setForm.getByTestId("exam-set-warnings")).toContainText('Topic "Pflege" has no approved questions');
  await expect(page.getByTestId("exam-set-card").filter({ hasText: STAFF_EXAM_SET })).toBeVisible();
  // One usable exam set (once questions exist) for 3 attempts: the curriculum warns.
  await expect(page.getByTestId("curriculum-warning")).toContainText("but students get 3 attempts");

  // 3. Import 20 questions: a file with an error is previewed and nothing is saved; then the fixed file.
  await page.getByTestId("exam-set-card").filter({ hasText: STAFF_EXAM_SET }).getByRole("link", { name: "Questions" }).click();
  await expect(page).toHaveURL(/\/staff\/questions\?examSet=/);
  await expect(page.getByRole("combobox", { name: "Exam set", exact: true }).last()).not.toHaveValue("");
  const broken = questionsCsv(20).replace("Question 3: size, practice and warmth?", "");
  await page.getByRole("textbox", { name: "Or paste the CSV" }).fill(broken);
  await page.getByRole("button", { name: "Check file" }).click();
  await expect(page.getByTestId("question-import-errors")).toContainText("Row 3: Missing English question text (stem_en)");
  await expect(page.getByRole("button", { name: /^Import 19 questions/ })).toBeDisabled();
  await expect(page.getByTestId("questions-empty")).toBeVisible();

  await page.getByRole("textbox", { name: "Or paste the CSV" }).fill(questionsCsv(20));
  await page.getByRole("combobox", { name: "Import as" }).selectOption("approved");
  await page.getByRole("button", { name: "Check file" }).click();
  await expect(page.getByTestId("question-import-summary")).toContainText("20 valid questions (Pflege: 12, Recht: 8)");
  await page.getByRole("button", { name: "Import 20 questions as approved" }).click();
  await expect(page.getByTestId("question-import-result")).toContainText("Imported 20 questions.");
  await expect(page.getByTestId("question-card")).toHaveCount(20);
  await expect(page.getByTestId("question-card").first()).toContainText("Größe, Übung und Wärme");
  await expect(page.getByTestId("question-card").first()).toContainText("size, practice and warmth");
  // 20 approved >= 5 per paper: no pool warning.
  await expect(page.getByTestId("pool-row").filter({ hasText: STAFF_EXAM_SET })).toContainText("Enough");

  // 4. Assign the curriculum to the student and move it first.
  await page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Students" }).click();
  await page.getByRole("row").filter({ hasText: STUDENT_CREATED.fullName }).getByRole("link", { name: /Open/ }).click();
  await expect(page.getByTestId("student-name")).toHaveText(STUDENT_CREATED.fullName);
  await expect(page.getByTestId("assignment-row")).toHaveCount(2);
  await expect(page.getByTestId("assignment-row").nth(0)).toContainText("Pflege Ausbildung");
  await expect(page.getByTestId("assignment-row").nth(1)).toContainText("Life in Germany");
  await page.getByRole("combobox", { name: "Add curriculum" }).selectOption({ label: STAFF_CURRICULUM });
  await page.getByRole("form", { name: "Add curriculum" }).getByRole("button", { name: "Add" }).click();
  await expect(page.getByTestId("assignment-row")).toHaveCount(3);
  await page.getByRole("button", { name: `Move ${STAFF_CURRICULUM} up` }).click();
  await expect(page.getByTestId("assignment-row").nth(1)).toContainText(STAFF_CURRICULUM);
  await page.getByRole("button", { name: `Move ${STAFF_CURRICULUM} up` }).click();
  await expect(page.getByTestId("assignment-row").nth(0)).toContainText(STAFF_CURRICULUM);

  await expect(page.getByTestId("assignment-row").nth(0).getByTestId("assignment-attempts")).toContainText("0 of 3 used");

  // Extra attempts can be given at any time, not only after a block.
  await page.getByTestId("assignment-row").nth(0).getByRole("button", { name: /Give extra attempts/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).not.toContainText("lifts the block");
  await dialog.getByRole("spinbutton", { name: "Number of extra attempts" }).fill("2");
  await dialog.getByRole("button", { name: "Give extra attempts" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("grant-success")).toHaveText(`Gave ${STUDENT_CREATED.fullName} 2 extra attempts for ${STAFF_CURRICULUM}.`);
  await expect(page.getByTestId("assignment-row").nth(0).getByTestId("assignment-attempts")).toContainText("0 of 5 used");
  await expect(page.getByTestId("assignment-row").nth(0).getByTestId("assignment-attempts")).toContainText("3 + 2 extra");

  // 5. The new student signs in with the credentials staff chose and starts the exam.
  await signIn(page, STUDENT_CREATED.username, STUDENT_CREATED.password, /\/consent$/);
  await page.getByRole("button", { name: "I agree and continue" }).click();
  await expect(page).toHaveURL(/\/exam\/start$/);
  // One card per curriculum; the new curriculum is ready with its 3 + 2 attempts.
  await expect(page.getByTestId("curriculum-card").filter({ visible: true })).toHaveCount(3);
  await expect(curriculumCard(page, STAFF_CURRICULUM).getByTestId("attempts-left")).toHaveText("5 attempts left");
  await curriculumCard(page, STAFF_CURRICULUM).getByRole("button", { name: "Start exam" }).click();
  await expect(page).toHaveURL(/\/exam\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Question 1 of 5" })).toBeVisible();

  // Students never reach staff pages.
  await page.goto("/staff/students");
  await expect(page).not.toHaveURL(/\/staff/);
});

test("the Student page link on the Blocked page opens the student's page with the blocked curriculum", async ({ page }) => {
  const db = adminDb();
  const { data: student } = await db.from("profiles").select("id").eq("username", STUDENT_BLOCK.username).single();
  const { data: blockedCurriculum } = await db.from("curriculums").select("id").eq("name", BLOCK_CURRICULUM).single();
  await db.from("assignments").update({ status: "blocked" }).eq("student_id", student!.id).eq("curriculum_id", blockedCurriculum!.id);

  await signIn(page, STAFF.email, STAFF.password, /\/staff$/);
  await page.goto("/staff/blocked");
  await page.getByRole("row").filter({ hasText: STUDENT_BLOCK.fullName }).getByRole("link", { name: /Student page/ }).click();
  await expect(page).toHaveURL(new RegExp(`/staff/students/${student!.id}$`));
  await expect(page.getByTestId("student-name")).toHaveText(STUDENT_BLOCK.fullName);
  await expect(page.getByTestId("assignment-row")).toHaveCount(2);
  const row = page.getByTestId("assignment-row").filter({ hasText: BLOCK_CURRICULUM }).first();
  await expect(row.getByTestId("assignment-status")).toHaveText("blocked");
  await expect(row.getByRole("button", { name: /Give extra attempts/ })).toBeVisible();
  await expect(row.getByRole("button", { name: /^Remove/ })).toBeVisible();
  const other = page.getByTestId("assignment-row").filter({ hasText: BLOCK_OTHER_CURRICULUM });
  await expect(other.getByTestId("assignment-status")).toHaveText("open");
});

test("staff delete a student after typing the username, and the account and data are gone", async ({ page }) => {
  const db = adminDb();
  const username = "e2e.delete";
  // TEST password, generated per run.
  const password = `e2e-delete-${Date.now()}`;
  const { data: existing } = await db.from("profiles").select("id").eq("username", username).maybeSingle();
  if (existing) await db.auth.admin.deleteUser(existing.id);
  const { data: created, error } = await db.auth.admin.createUser({
    email: usernameToEmail(username),
    password,
    email_confirm: true,
    app_metadata: { role: "student", username, full_name: "E2E Delete Student", track: "other" },
  });
  if (error) throw error;

  await signIn(page, STAFF.email, STAFF.password, /\/staff$/);
  await page.goto(`/staff/students/${created.user.id}`);
  await expect(page.getByTestId("student-name")).toHaveText("E2E Delete Student");
  await page.getByRole("button", { name: "Delete student" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete E2E Delete Student?" });
  const confirm = dialog.getByRole("button", { name: "Delete permanently" });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole("textbox").fill("e2e.wrong");
  await expect(confirm).toBeDisabled();
  await dialog.getByRole("textbox").fill(username);
  await confirm.click();
  await expect(page).toHaveURL(/\/staff\/students$/);
  const { data: gone } = await db.from("profiles").select("id").eq("id", created.user.id).maybeSingle();
  expect(gone).toBeNull();
  const { data: authUser } = await db.auth.admin.getUserById(created.user.id);
  expect(authUser.user).toBeNull();
});

test("the staff nav keeps the current section in view after the screen rotates", async ({ page }) => {
  await page.setViewportSize({ width: 812, height: 375 });
  await signIn(page, STAFF.email, STAFF.password, /\/staff$/);
  // A section in the middle of the row (the last one is always reachable because scrolling clamps).
  await page.goto("/staff/curriculums");
  const current = page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Curriculums", exact: true });
  await expect(current).toHaveAttribute("aria-current", "page");
  // Portrait: the nav row now scrolls sideways; the current section must still be fully visible.
  await page.setViewportSize({ width: 375, height: 812 });
  await expect
    .poll(async () => {
      const box = await current.boundingBox();
      return box !== null && box.x >= 0 && box.x + box.width <= 375;
    })
    .toBe(true);
});

// v2 phase 1: trainers see and manage only their own students; admins see everyone and assign trainers.

async function expectNoLoading(page: import("@playwright/test").Page) {
  await expect(page.locator('[role="status"][aria-label^="Loading"]')).toHaveCount(0);
}

test("a trainer adds a student with a contact email, sees only their own students and cannot open another trainer's student", async ({ page }) => {
  await signIn(page, TRAINER_ONE.email, TRAINER_ONE.password, /\/staff$/);

  // No admin-only navigation, and no admin-only link on the Extra attempts page.
  const nav = page.getByRole("navigation", { name: "Staff" });
  await expect(nav.getByRole("link", { name: "Students", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Curriculums", exact: true })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Questions", exact: true })).toHaveCount(0);
  await page.goto("/staff/grants");
  await expectNoLoading(page);
  await expect(page.locator('a[href^="/staff/curriculums"], a[href^="/staff/questions"]')).toHaveCount(0);

  await page.goto("/staff/students");
  await expect(page.getByTestId("students-table")).toBeVisible();
  // Own student only, no Trainer column or picker.
  await expect(page.getByRole("row").filter({ hasText: STUDENT_OF_ONE.fullName })).toHaveCount(1);
  await expect(page.getByText(STUDENT_OF_TWO.fullName)).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Trainer" })).toHaveCount(0);

  const add = page.getByRole("form", { name: "Add student" });
  await expect(add.getByTestId("trainer-select")).toHaveCount(0);
  await expect(add.getByRole("group", { name: "Passport and travel" })).toBeVisible();
  await add.getByLabel("Username").fill(STUDENT_BY_TRAINER.username);
  await add.getByLabel("Full name").fill(STUDENT_BY_TRAINER.fullName);
  await add.getByLabel("First password").fill(STUDENT_BY_TRAINER.password);
  // Contact email is required: the form does not submit without it.
  await add.getByRole("button", { name: "Create student" }).click();
  await expect(add.getByTestId("add-student-success")).toHaveCount(0);
  await add.getByLabel("Contact email").fill(STUDENT_BY_TRAINER.contactEmail);
  await add.getByLabel("Phone", { exact: true }).fill("+91 98765 43210");
  await add.getByLabel("Passport number").fill("P7654321");
  await expect(add.getByLabel("Passport number")).toHaveAttribute("autocomplete", "off");
  await add.getByLabel("German level").selectOption("A2");
  await add.getByRole("button", { name: "Create student" }).click();
  await expect(add.getByTestId("add-student-success")).toContainText(`Student ${STUDENT_BY_TRAINER.username} created.`);
  await expect(page.locator("body")).not.toContainText(STUDENT_BY_TRAINER.password);

  // The new student is the trainer's own: the list shows it, the page shows the saved details.
  const { data: created } = await adminDb().from("profiles").select("id, trainer_id").eq("username", STUDENT_BY_TRAINER.username).single();
  const { data: trainerProfile } = await adminDb().from("profiles").select("id").eq("username", TRAINER_ONE.username).single();
  expect(created!.trainer_id).toBe(trainerProfile!.id);
  await page.goto("/staff/students");
  await expect(page.getByRole("row").filter({ hasText: STUDENT_BY_TRAINER.fullName })).toHaveCount(1);
  await page.goto(`/staff/students/${created!.id}`);
  await expect(page.getByTestId("student-name")).toHaveText(STUDENT_BY_TRAINER.fullName);
  await expect(page.getByTestId("invite-status")).toContainText(STUDENT_BY_TRAINER.contactEmail);
  const details = page.getByRole("form", { name: "Student details" });
  await expect(details.getByLabel("Contact email")).toHaveValue(STUDENT_BY_TRAINER.contactEmail);
  await expect(details.getByLabel("Passport number")).toHaveValue("P7654321");
  // Edit and save the details.
  await details.getByLabel("Qualification").fill("GNM");
  await details.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByTestId("details-message")).toHaveText("Details saved.");
  await page.reload();
  await expect(page.getByRole("form", { name: "Student details" }).getByLabel("Qualification")).toHaveValue("GNM");
  // A refused value is explained next to the form.
  await page.getByRole("form", { name: "Student details" }).getByLabel("Contact email").fill("not-an-email");
  await page.getByRole("form", { name: "Student details" }).getByLabel("Contact email").evaluate((el: HTMLInputElement) => el.form!.noValidate = true);
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByTestId("details-message")).toContainText("not a valid email");
  // No admin-only controls for a trainer.
  await expect(page.getByTestId("trainer-select")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete student" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  // Another trainer's student: not found, and none of its data reaches the page.
  const other = await adminDb().from("profiles").select("id").eq("username", STUDENT_OF_TWO.username).single();
  await page.goto(`/staff/students/${other.data!.id}`);
  await expectNoLoading(page);
  await expect(page.locator("body")).not.toContainText(STUDENT_OF_TWO.fullName);
  await expect(page.locator("body")).not.toContainText(STUDENT_OF_TWO.contactEmail);
  await expect(page.getByTestId("student-name")).toHaveCount(0);
  await expect(page.getByRole("form", { name: "Student details" })).toHaveCount(0);

  // The admin-only pages bounce a trainer back to the staff dashboard.
  await page.goto("/staff/curriculums");
  await expect(page).toHaveURL(/\/staff$/);
});

test("an admin sees every student, picks a trainer for a new one and can assign a trainer on the student page", async ({ page }) => {
  await signIn(page, STAFF.email, STAFF.password, /\/staff$/);
  await page.goto("/staff/students");
  await expect(page.getByRole("row").filter({ hasText: STUDENT_OF_ONE.fullName })).toContainText(TRAINER_ONE.fullName);
  await expect(page.getByRole("row").filter({ hasText: STUDENT_OF_TWO.fullName })).toContainText(TRAINER_TWO.fullName);

  // Add student with a trainer.
  const add = page.getByRole("form", { name: "Add student" });
  await add.getByLabel("Username").fill(STUDENT_BY_TRAINER.username);
  await add.getByLabel("Full name").fill(STUDENT_BY_TRAINER.fullName);
  await add.getByLabel("First password").fill(STUDENT_BY_TRAINER.password);
  await add.getByLabel("Contact email").fill(STUDENT_BY_TRAINER.contactEmail);
  await add.getByTestId("trainer-select").selectOption({ label: TRAINER_TWO.fullName });
  await add.getByRole("button", { name: "Create student" }).click();
  await expect(add.getByTestId("add-student-success")).toContainText(`Student ${STUDENT_BY_TRAINER.username} created.`);
  await expect(page.getByRole("row").filter({ hasText: STUDENT_BY_TRAINER.fullName })).toContainText(TRAINER_TWO.fullName);

  // Move STUDENT_OF_ONE to trainer two on the student page.
  const { data: s } = await adminDb().from("profiles").select("id").eq("username", STUDENT_OF_ONE.username).single();
  await page.goto(`/staff/students/${s!.id}`);
  await expect(page.getByTestId("trainer-select")).toHaveValue(/[0-9a-f-]{36}/);
  await page.getByTestId("trainer-select").selectOption({ label: TRAINER_TWO.fullName });
  await page.getByRole("button", { name: "Save trainer" }).click();
  await expect(page.getByTestId("trainer-message")).toHaveText("Trainer changed.");
  await expect(page.getByRole("button", { name: "Delete student" })).toBeVisible();
  await page.goto("/staff/students");
  await expect(page.getByRole("row").filter({ hasText: STUDENT_OF_ONE.fullName })).toContainText(TRAINER_TWO.fullName);

  // Trainer one no longer sees the student; trainer two does.
  await signIn(page, TRAINER_ONE.email, TRAINER_ONE.password, /\/staff$/);
  await page.goto("/staff/students");
  await expect(page.getByTestId("students-empty")).toBeVisible();
  await signIn(page, TRAINER_TWO.email, TRAINER_TWO.password, /\/staff$/);
  await page.goto("/staff/students");
  await expect(page.getByRole("row").filter({ hasText: STUDENT_OF_ONE.fullName })).toHaveCount(1);
});

test("the CSV import shows which rows get an invite, reports the invite counts, and warns a trainer about the username check", async ({ page }) => {
  await signIn(page, TRAINER_ONE.email, TRAINER_ONE.password, /\/staff$/);
  await page.goto("/staff/students");
  const csv = [
    "username,full_name,batch,track,password,contact_email",
    `${STUDENT_BY_TRAINER.username},${STUDENT_BY_TRAINER.fullName},B1,other,${STUDENT_BY_TRAINER.password},${STUDENT_BY_TRAINER.contactEmail}`,
    `e2e.bytrainer2,E2E Ohne Mail,B1,other,${STUDENT_BY_TRAINER.password}x,`,
  ].join("\n");
  await page.getByRole("textbox", { name: "Or paste the CSV" }).fill(csv);
  await page.getByRole("button", { name: "Check file" }).click();
  await expect(page.getByTestId("students-import-ready")).toContainText("2 students ready to create; 1 will get an invite.");
  await expect(page.getByRole("row").filter({ hasText: STUDENT_BY_TRAINER.fullName })).toContainText("Invite by email");
  await expect(page.getByRole("row").filter({ hasText: "e2e.bytrainer2" })).toContainText("no invite (no email)");
  await expect(page.getByTestId("students-import-trainer-note")).toContainText("only covers your own students");
  await page.getByRole("button", { name: "Create 2 students" }).click();
  await expect(page.getByTestId("students-import-result")).toContainText("Created 2 students");
  await expect(page.getByTestId("students-import-invites")).toContainText("1 sent, 1 without email (no invite)");
  const { data: second } = await adminDb().from("profiles").select("id").eq("username", "e2e.bytrainer2").single();
  await adminDb().auth.admin.deleteUser(second!.id);
});

async function removeAddedTrainer() {
  const db = adminDb();
  const { data } = await db.from("profiles").select("id").eq("username", TRAINER_ADDED.username).maybeSingle();
  if (data) {
    await db.from("profiles").update({ trainer_id: null }).eq("trainer_id", data.id);
    await db.auth.admin.deleteUser(data.id);
  }
}

test("a trainer cannot open the Team page and has no Team link", async ({ page }) => {
  await signIn(page, TRAINER_ONE.email, TRAINER_ONE.password, /\/staff$/);
  await expect(page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Team", exact: true })).toHaveCount(0);
  await page.goto("/staff/team");
  await expect(page).toHaveURL(/\/staff$/);
  await expect(page.getByTestId("team-table")).toHaveCount(0);
});

function trainerRow(page: import("@playwright/test").Page, username: string) {
  // By the username cell, not by name: other rows list this name in their reassign dropdown.
  return page.getByTestId("trainer-row").filter({ has: page.getByText(username, { exact: true }) });
}

test("an admin adds a trainer, moves a trainer's students away and deactivates the trainer", async ({ page }) => {
  await removeAddedTrainer();
  await signIn(page, STAFF.email, STAFF.password, /\/staff$/);
  await page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Team", exact: true }).click();
  await expect(page).toHaveURL(/\/staff\/team$/);
  await expect(page.getByTestId("team-table")).toBeVisible();
  await expect(trainerRow(page, TRAINER_ONE.username)).toContainText("1");

  // Add a trainer: no password field, the row appears.
  const form = page.getByRole("form", { name: "Add trainer" });
  await expect(form.getByLabel("Password")).toHaveCount(0);
  await form.getByLabel("Full name").fill(TRAINER_ADDED.fullName);
  await form.getByLabel("Email").fill(TRAINER_ADDED.email);
  await form.getByLabel("Username").fill(TRAINER_ADDED.username);
  await form.getByRole("button", { name: "Add trainer" }).click();
  await expect(page.getByTestId("trainer-success")).toContainText(TRAINER_ADDED.fullName);
  const added = trainerRow(page, TRAINER_ADDED.username);
  await expect(added).toContainText(TRAINER_ADDED.email);
  await expect(added).toContainText("Not signed in yet");
  await expectNoHorizontalOverflow(page);

  // A trainer with students cannot be deactivated; reassign first (to the new trainer), then deactivate.
  const one = trainerRow(page, TRAINER_ONE.username);
  await expect(one.getByRole("button", { name: /Deactivate/ })).toBeDisabled();
  await one.getByTestId("reassign-select").selectOption({ label: TRAINER_ADDED.fullName });
  await one.getByRole("button", { name: "Reassign students" }).click();
  await expect(one.getByTestId("trainer-action-message")).toHaveText("1 student moved.");
  await expect(added.getByTestId("trainer-students")).toHaveText("1");
  await expect(one.getByTestId("trainer-students")).toHaveText("0");
  await one.getByRole("button", { name: /Deactivate/ }).click();
  await expect(one.getByTestId("trainer-action-message")).toContainText("deactivated");
  await expect(one).toContainText("Inactive");

  // The deactivated trainer can no longer sign in (same message as a wrong password).
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel(/username|email/i).fill(TRAINER_ONE.email);
  await page.getByLabel("Password").fill(TRAINER_ONE.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByText("Incorrect username or password")).toBeVisible();

  await removeAddedTrainer();
});
