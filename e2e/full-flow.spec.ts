import { expect, test, type Page } from "@playwright/test";
import { usernameToEmail } from "../src/lib/auth/username";
import { BLOCK_CURRICULUM, FLOW_CURRICULUM, FLOW_EXAM_SET, STAFF, STUDENT_BLOCK, STUDENT_FLOW } from "./fixtures";
import { expectNoHorizontalOverflow } from "./helpers";
import { adminDb, seed } from "./seed";

// Phase 1 end to end against the LOCAL stack, at 375 px and desktop (Playwright projects):
// 1. Staff create a nursing student, a curriculum with a held exam set and 15 bilingual questions
//    (CSV with umlauts), assign it first and give an attempt. The student signs in with the
//    credentials staff chose, consents, takes the exam, sees no marks; staff release; the student
//    sees the bilingual report with the score.
// 2. A second student fails twice, is blocked at the second release, and staff give another attempt.
// TEST values only (e2e/fixtures.ts); credentials are never printed.

const CSV_HEADER =
  "topic,difficulty,stem_de,stem_en,option_a_de,option_a_en,option_b_de,option_b_en,option_c_de,option_c_en,option_d_de,option_d_en,correct,points";

function flowCsv(): string {
  const rows = Array.from({ length: 15 }, (_, i) => {
    const topic = i < 9 ? "Pflege" : "Recht";
    return `${topic},easy,"Frage ${i + 1}: Ist die Übung für Größe und Wärme schön?","Question ${i + 1}: is the exercise for size and warmth nice?",Ja,Yes,Nein,No,Vielleicht,Maybe,Später,Later,b,1`;
  });
  return [CSV_HEADER, ...rows].join("\n");
}

async function cleanUp() {
  const db = adminDb();
  const { data: list, error } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  for (const u of list.users.filter((u) => u.email === usernameToEmail(STUDENT_FLOW.username))) {
    await db.auth.admin.deleteUser(u.id);
  }
  await db.from("curriculums").delete().eq("name", FLOW_CURRICULUM);
}

test.setTimeout(300_000);

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

async function staffNav(page: Page, name: string) {
  await page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name, exact: true }).click();
}

/** Answers every question with `option` and submits; returns the attempt id. */
async function takeExam(page: Page, count: number, option: string, checkStem?: (stem: string) => void): Promise<string> {
  await page.getByRole("button", { name: "Start exam" }).click();
  await expect(page).toHaveURL(/\/exam\/[0-9a-f-]{36}$/);
  await expectNoHorizontalOverflow(page);
  for (let i = 0; i < count; i++) {
    await expect(page.getByRole("heading", { name: `Question ${i + 1} of ${count}` })).toBeVisible();
    checkStem?.((await page.getByTestId("question-stem").textContent()) ?? "");
    await page.getByRole("radio", { name: option, exact: true }).click();
    await expect(page.getByTestId("save-status")).toHaveText(/Saved/);
    if (i < count - 1) await page.getByRole("button", { name: "Next", exact: true }).click();
  }
  await page.getByRole("button", { name: "Review and submit" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Submit exam" }).click();
  await expect(page).toHaveURL(/\/results\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("result-status")).toHaveText(/Submitted, awaiting review/);
  return page.url().split("/").pop()!;
}

async function releaseFromReviewList(page: Page, studentName: string) {
  await staffNav(page, "Review");
  await expect(page).toHaveURL(/\/staff\/review$/);
  await expectNoHorizontalOverflow(page);
  await page.getByRole("row").filter({ hasText: studentName }).getByRole("link", { name: studentName }).click();
  await expect(page.getByRole("heading", { name: studentName })).toBeVisible();
  await page.getByRole("button", { name: "Release result" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Release", exact: true }).click();
  await expect(page.getByRole("button", { name: "Released" })).toBeDisabled();
}

async function giveAttemptOnGrantsPage(page: Page, studentName: string) {
  await staffNav(page, "Give attempts");
  await expect(page).toHaveURL(/\/staff\/grants$/);
  await expectNoHorizontalOverflow(page);
  await page.getByRole("row").filter({ hasText: studentName }).getByRole("button", { name: "Give attempt" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Grant attempt" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByTestId("grant-success")).toContainText(`Attempt granted to ${studentName}`);
}

test("full flow: staff set up a nursing student and a bilingual exam, the student takes it, staff release, the student sees the bilingual score", async ({
  page,
}) => {
  await signIn(page, STAFF.email, STAFF.password, /\/staff$/);
  await expectNoHorizontalOverflow(page);

  // Student (track nursing) with a first password chosen by staff.
  await staffNav(page, "Students");
  const add = page.getByRole("form", { name: "Add student" });
  await add.getByLabel("Username").fill(STUDENT_FLOW.username);
  await add.getByLabel("Full name").fill(STUDENT_FLOW.fullName);
  await add.getByLabel("Batch").fill("E2E-FLOW");
  await add.getByLabel("Track").selectOption("nursing");
  await add.getByLabel("First password").fill(STUDENT_FLOW.password);
  await add.getByRole("button", { name: "Create student" }).click();
  await expect(add.getByTestId("add-student-success")).toContainText(`Student ${STUDENT_FLOW.username} created`);
  await expect(page.locator("body")).not.toContainText(STUDENT_FLOW.password);

  // Curriculum and a held exam set: 5 per paper, 2 attempts, pass mark 60 %.
  await staffNav(page, "Curriculums");
  await page.getByRole("textbox", { name: "New curriculum" }).fill(FLOW_CURRICULUM);
  await page.getByRole("button", { name: "Create curriculum" }).click();
  await expect(page.getByTestId("curriculum-name")).toHaveText(FLOW_CURRICULUM);
  const setForm = page.getByRole("form", { name: "New exam set" });
  await setForm.getByLabel("Exam set name").fill(FLOW_EXAM_SET);
  await setForm.getByLabel("Questions per paper").fill("5");
  await setForm.getByLabel("Time limit (minutes)").fill("20");
  await setForm.getByLabel("Pass mark (%)").fill("60");
  await setForm.getByLabel("Maximum attempts").fill("2");
  await expect(setForm.getByLabel("Hold results for review")).toBeChecked();
  await setForm.getByRole("button", { name: "Create exam set" }).click();
  await expect(setForm.getByTestId("exam-set-saved")).toBeVisible();

  // 15 bilingual questions with umlauts, imported as approved.
  await page.getByTestId("exam-set-card").filter({ hasText: FLOW_EXAM_SET }).getByRole("link", { name: "Questions" }).click();
  await expect(page).toHaveURL(/\/staff\/questions\?examSet=/);
  await page.getByRole("textbox", { name: "Or paste the CSV" }).fill(flowCsv());
  await page.getByRole("combobox", { name: "Import as" }).selectOption("approved");
  await page.getByRole("button", { name: "Check file" }).click();
  await expect(page.getByTestId("question-import-summary")).toContainText("15 valid questions (Pflege: 9, Recht: 6)");
  await page.getByRole("button", { name: "Import 15 questions as approved" }).click();
  await expect(page.getByTestId("question-import-result")).toContainText("Imported 15 questions.");
  await expect(page.getByTestId("question-card")).toHaveCount(15);
  await expect(page.getByTestId("question-card").first()).toContainText("Übung für Größe und Wärme schön");
  await expect(page.getByTestId("pool-row").filter({ hasText: FLOW_EXAM_SET })).toContainText("Enough");
  await expectNoHorizontalOverflow(page);

  // Assign the curriculum, move it first, give an attempt.
  await staffNav(page, "Students");
  await page.getByRole("searchbox", { name: "Search" }).fill("flownurse");
  await page.getByRole("button", { name: "Filter" }).click();
  await page.getByRole("row").filter({ hasText: STUDENT_FLOW.fullName }).getByRole("link", { name: /Open/ }).click();
  await expect(page.getByTestId("student-name")).toHaveText(STUDENT_FLOW.fullName);
  await expect(page.getByTestId("student-track")).toHaveText("Nursing");
  await page.getByRole("combobox", { name: "Add curriculum" }).selectOption({ label: FLOW_CURRICULUM });
  await page.getByRole("form", { name: "Add curriculum" }).getByRole("button", { name: "Add" }).click();
  await expect(page.getByTestId("assignment-row")).toHaveCount(3);
  await page.getByRole("button", { name: `Move ${FLOW_CURRICULUM} up` }).click();
  await expect(page.getByTestId("assignment-row").nth(1)).toContainText(FLOW_CURRICULUM);
  await page.getByRole("button", { name: `Move ${FLOW_CURRICULUM} up` }).click();
  await expect(page.getByTestId("assignment-row").nth(0)).toContainText(FLOW_CURRICULUM);
  await page.getByTestId("assignment-row").nth(0).getByRole("button", { name: "Give attempt" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Grant attempt" }).click();
  await expect(page.getByTestId("grant-success")).toContainText(`Attempt granted to ${STUDENT_FLOW.fullName} for ${FLOW_EXAM_SET}`);
  await expectNoHorizontalOverflow(page);

  // The student signs in with the staff-chosen credentials, consents and takes the exam (key: Nein).
  await signIn(page, STUDENT_FLOW.username, STUDENT_FLOW.password, /\/consent$/);
  await page.getByRole("button", { name: "I agree and continue" }).click();
  await expect(page).toHaveURL(/\/exam\/start$/);
  await expect(page.getByTestId("next-exam")).toContainText(FLOW_CURRICULUM);
  await expect(page.getByTestId("question-count")).toHaveText("5");
  await expectNoHorizontalOverflow(page);
  const attemptId = await takeExam(page, 5, "Nein", (stem) => expect(stem).toMatch(/Übung für Größe und Wärme/));
  // Held: no marks before release.
  expect(await page.locator("body").innerText()).not.toMatch(/\d+\s*(\/|of)\s*\d+|points|%|passed|bestanden/i);
  await expectNoHorizontalOverflow(page);

  // Staff check the bilingual evaluation and release.
  await signIn(page, STAFF.email, STAFF.password, /\/staff$/);
  await expect(page.getByTestId("awaiting-review")).not.toHaveText("0");
  await releaseFromReviewList(page, STUDENT_FLOW.fullName);
  await expect(page.getByTestId("review-question")).toHaveCount(5);
  await expect(page.getByText("Correct answer")).toHaveCount(5);
  await expect(page.getByTestId("review-question").first()).toContainText("is the exercise for size and warmth nice?");

  // The student sees the released bilingual report with the score.
  await signIn(page, STUDENT_FLOW.username, STUDENT_FLOW.password, /\/exam\/start$/);
  await page.goto(`/results/${attemptId}`);
  await expect(page.getByRole("heading", { name: "Ergebnis / Result" })).toBeVisible();
  await expect(page.getByTestId("result-score")).toHaveText(/^5 of 5\s*\(100%\)$/);
  await expect(page.getByTestId("result-outcome")).toHaveText("Bestanden / Passed");
  await expect(page.getByText("Prüfung / Exam")).toBeVisible();
  await expect(page.getByText(FLOW_EXAM_SET)).toBeVisible();
  const topics = page.getByTestId("topic-table");
  await expect(topics).toContainText("Thema / Topic");
  await expect(topics).toContainText("Punkte / Points");
  await expectNoHorizontalOverflow(page);
});

test("full flow: a second student fails twice, is blocked at the second release, and staff give another attempt", async ({
  page,
}) => {
  const failOnce = async () => {
    await signIn(page, STUDENT_BLOCK.username, STUDENT_BLOCK.password, /\/exam\/start$/);
    await takeExam(page, 2, "Ja"); // the key is "Nein" and the pass mark 100 %
  };

  await signIn(page, STAFF.email, STAFF.password, /\/staff$/);
  await giveAttemptOnGrantsPage(page, STUDENT_BLOCK.fullName);
  await failOnce();
  await signIn(page, STAFF.email, STAFF.password, /\/staff$/);
  await releaseFromReviewList(page, STUDENT_BLOCK.fullName);

  await giveAttemptOnGrantsPage(page, STUDENT_BLOCK.fullName);
  await failOnce();
  await signIn(page, STAFF.email, STAFF.password, /\/staff$/);
  await staffNav(page, "Blocked");
  await expect(page.getByRole("row").filter({ hasText: STUDENT_BLOCK.fullName })).toHaveCount(0); // held: not yet
  await releaseFromReviewList(page, STUDENT_BLOCK.fullName);

  await staffNav(page, "Blocked");
  await expect(page).toHaveURL(/\/staff\/blocked$/);
  await expectNoHorizontalOverflow(page);
  const row = page.getByRole("row").filter({ hasText: STUDENT_BLOCK.fullName });
  await expect(row).toContainText(BLOCK_CURRICULUM);
  await expect(row).toContainText("2 of 2");

  await signIn(page, STUDENT_BLOCK.username, STUDENT_BLOCK.password, /\/exam\/start$/);
  await expect(page.getByTestId("blocked-contact-trainer")).toBeVisible();

  await signIn(page, STAFF.email, STAFF.password, /\/staff$/);
  await staffNav(page, "Blocked");
  await page.getByRole("row").filter({ hasText: STUDENT_BLOCK.fullName }).getByRole("button", { name: "Grant another attempt" }).click();
  await expect(page.getByRole("dialog")).toContainText("lifts the block");
  await page.getByRole("dialog").getByRole("button", { name: "Grant attempt" }).click();
  await expect(page.getByTestId("grant-success")).toContainText(`Attempt granted to ${STUDENT_BLOCK.fullName}`);
  await expect(page.getByRole("row").filter({ hasText: STUDENT_BLOCK.fullName })).toHaveCount(0);

  await signIn(page, STUDENT_BLOCK.username, STUDENT_BLOCK.password, /\/exam\/start$/);
  await expect(page.getByTestId("next-exam")).toContainText(BLOCK_CURRICULUM);
  await page.getByRole("button", { name: "Start exam" }).click();
  await expect(page.getByRole("heading", { name: "Question 1 of 2" })).toBeVisible();
});
