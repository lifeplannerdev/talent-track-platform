import { expect, test, type Page } from "@playwright/test";
import { usernameToEmail } from "../src/lib/auth/username";
import { STAFF, STAFF_CURRICULUM, STAFF_EXAM_SET, STUDENT_BLOCK, STUDENT_CREATED } from "./fixtures";
import { adminDb, seed } from "./seed";

// Staff management end to end: create a nursing student, create a curriculum and exam set,
// import 20 bilingual questions, assign and grant, then the new student signs in and starts.

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

async function signIn(page: Page, username: string, password: string, home: RegExp) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Username or email").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(home);
}

test("staff create a nursing student, an exam set and 20 questions, grant an attempt, and the student starts the exam", async ({ page }) => {
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
  const setForm = page.getByRole("form", { name: "New exam set" });
  await setForm.getByLabel("Exam set name").fill(STAFF_EXAM_SET);
  await setForm.getByLabel("Questions per paper").fill("5");
  await setForm.getByLabel("Time limit (minutes)").fill("30");
  await setForm.getByLabel("Pass mark (%)").fill("60");
  await setForm.getByLabel("Maximum attempts").fill("2");
  await setForm.getByLabel("Hold results for review").uncheck();
  // A mix that does not add up is refused.
  await setForm.getByLabel("Topic mix (optional)").fill("Pflege: 3\nRecht: 1");
  await setForm.getByRole("button", { name: "Create exam set" }).click();
  await expect(setForm).toContainText("Topic counts add up to 4, but the exam has 5 questions");
  await setForm.getByLabel("Topic mix (optional)").fill("Pflege: 3\nRecht: 2");
  await setForm.getByRole("button", { name: "Create exam set" }).click();
  await expect(setForm.getByTestId("exam-set-saved")).toContainText("Exam set created.");
  await expect(setForm.getByTestId("exam-set-warnings")).toContainText('Topic "Pflege" has no approved questions');
  await expect(page.getByTestId("exam-set-card").filter({ hasText: STAFF_EXAM_SET })).toBeVisible();

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
  // 20 approved >= 3 x 5: no pool warning.
  await expect(page.getByTestId("pool-row").filter({ hasText: STAFF_EXAM_SET })).toContainText("Enough");

  // 4. Assign the curriculum to the student first, then give an attempt.
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

  await page.getByTestId("assignment-row").nth(0).getByRole("button", { name: "Give attempt" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Grant attempt" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByTestId("grant-success")).toContainText(`Attempt granted to ${STUDENT_CREATED.fullName} for ${STAFF_EXAM_SET}`);

  // 5. The new student signs in with the credentials staff chose and starts the exam.
  await signIn(page, STUDENT_CREATED.username, STUDENT_CREATED.password, /\/consent$/);
  await page.getByRole("button", { name: "I agree and continue" }).click();
  await expect(page).toHaveURL(/\/exam\/start$/);
  await expect(page.getByTestId("next-exam")).toContainText(STAFF_CURRICULUM);
  await page.getByRole("button", { name: "Start exam" }).click();
  await expect(page).toHaveURL(/\/exam\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Question 1 of 5" })).toBeVisible();

  // Students never reach staff pages.
  await page.goto("/staff/students");
  await expect(page).not.toHaveURL(/\/staff/);
});

test("the Reassign curriculums link on the Blocked page opens the student's page", async ({ page }) => {
  const db = adminDb();
  const { data: student } = await db.from("profiles").select("id").eq("username", STUDENT_BLOCK.username).single();
  await db.from("assignments").update({ status: "blocked" }).eq("student_id", student!.id);

  await signIn(page, STAFF.email, STAFF.password, /\/staff$/);
  await page.goto("/staff/blocked");
  await page.getByRole("row").filter({ hasText: STUDENT_BLOCK.fullName }).getByRole("link", { name: "Reassign curriculums" }).click();
  await expect(page).toHaveURL(new RegExp(`/staff/students/${student!.id}$`));
  await expect(page.getByTestId("student-name")).toHaveText(STUDENT_BLOCK.fullName);
  const row = page.getByTestId("assignment-row");
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId("assignment-status")).toHaveText("blocked");
  await expect(row.getByRole("button", { name: "Give attempt" })).toBeVisible();
  await expect(row.getByRole("button", { name: /^Remove/ })).toBeVisible();
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
