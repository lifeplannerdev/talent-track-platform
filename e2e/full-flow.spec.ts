import { expect, test, type Page } from "@playwright/test";
import { usernameToEmail } from "../src/lib/auth/username";
import { BLOCK_CURRICULUM, BLOCK_OTHER_CURRICULUM, FLOW_CURRICULUM, FLOW_EXAM_SET, STAFF, STUDENT_BLOCK, STUDENT_FLOW } from "./fixtures";
import { curriculumCard, expectNoHorizontalOverflow, signIn, staffNav, startExam } from "./helpers";
import { adminDb, seed } from "./seed";

// Phase 1 end to end against the LOCAL stack, at 375 px and desktop (Playwright projects):
// 1. Staff create a nursing student, a curriculum (2 attempts per student) with an exam set and 15
//    bilingual questions (CSV with umlauts) and assign it first. The student signs in with the
//    credentials staff chose, consents, takes the exam without any approval and sees the bilingual
//    report with the percentage at once; staff see the attempt read-only with the evaluation.
// 2. A second student fails twice on two exam sets, is blocked at the second result while the other
//    curriculum stays open, and staff give an extra attempt.
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

/** Answers every question with `option` and submits; the result is shown at once. Returns the attempt id. */
async function takeExam(page: Page, curriculum: string, count: number, option: string, checkStem?: (stem: string) => void): Promise<string> {
  const attemptId = await startExam(page, curriculum);
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
  await expect(page).toHaveURL(new RegExp(`/results/${attemptId}$`));
  await expect(page.getByTestId("result-score")).toBeVisible();
  return attemptId;
}

test("full flow: staff set up a nursing student and a bilingual exam, the student takes it without approval and sees the bilingual score at once, staff see the evaluation", async ({
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
  await add.getByLabel("Contact email").fill("flow@example.test");
  await add.getByRole("button", { name: "Create student" }).click();
  await expect(add.getByTestId("add-student-success")).toContainText(`Student ${STUDENT_FLOW.username} created`);
  await expect(page.locator("body")).not.toContainText(STUDENT_FLOW.password);

  // Curriculum (2 attempts per student by default) and an exam set: 5 per paper, pass mark 60 %.
  await staffNav(page, "Curriculums");
  await page.getByRole("textbox", { name: "New curriculum" }).fill(FLOW_CURRICULUM);
  await page.getByRole("button", { name: "Create curriculum" }).click();
  await expect(page.getByTestId("curriculum-name")).toHaveText(FLOW_CURRICULUM);
  await expect(page.getByRole("form", { name: "Curriculum settings" }).getByLabel("Attempts per student")).toHaveValue("2");
  const setForm = page.getByRole("form", { name: "New exam set" });
  await setForm.getByLabel("Exam set name").fill(FLOW_EXAM_SET);
  await setForm.getByLabel("Questions per paper").fill("5");
  await setForm.getByLabel("Hours", { exact: true }).fill("0");
  await setForm.getByLabel("Minutes", { exact: true }).fill("20");
  await setForm.getByLabel("Pass mark (%)").fill("60");
  await setForm.getByRole("button", { name: "Create exam set" }).click();
  await expect(setForm.getByTestId("exam-set-saved")).toBeVisible();
  await expectNoHorizontalOverflow(page);

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

  // Assign the curriculum and move it first. No attempt needs to be given.
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
  await expect(page.getByTestId("assignment-row").nth(0).getByTestId("assignment-attempts")).toContainText("0 of 2 used");
  await expectNoHorizontalOverflow(page);

  // The student signs in with the staff-chosen credentials, consents and takes the exam (key: Nein).
  await signIn(page, STUDENT_FLOW.username, STUDENT_FLOW.password, /\/consent$/);
  await page.getByRole("button", { name: "I agree and continue" }).click();
  await expect(page).toHaveURL(/\/exam\/start$/);
  await expect(page.getByTestId("curriculum-card").filter({ visible: true }).first().getByRole("heading")).toHaveText(FLOW_CURRICULUM);
  await expect(curriculumCard(page, FLOW_CURRICULUM).getByTestId("attempts-left")).toHaveText("2 attempts left");
  await expectNoHorizontalOverflow(page);
  const attemptId = await takeExam(page, FLOW_CURRICULUM, 5, "Nein", (stem) => expect(stem).toMatch(/Übung für Größe und Wärme/));

  // The bilingual report with the score, at once.
  await expect(page.getByRole("heading", { name: "Ergebnis / Result" })).toBeVisible();
  await expect(page.getByTestId("result-score")).toHaveText("100%");
  await expect(page.getByTestId("result-points")).toContainText("5 of 5 points");
  await expect(page.getByTestId("result-outcome")).toHaveText("Bestanden / Passed");
  await expect(page.getByText("Prüfung / Exam")).toBeVisible();
  await expect(page.getByTestId("result-report")).toContainText(FLOW_EXAM_SET);
  const topics = page.getByTestId("topic-table");
  await expect(topics).toContainText("Thema / Topic");
  await expect(topics).toContainText("Punkte / Points");
  await expectNoHorizontalOverflow(page);
  await page.getByRole("link", { name: "Back to exams" }).click();
  await expect(curriculumCard(page, FLOW_CURRICULUM)).toHaveAttribute("data-kind", "passed");

  // Staff: the attempt is on the dashboard and in the read-only Attempts list with the bilingual evaluation.
  await signIn(page, STAFF.email, STAFF.password, /\/staff$/);
  await expect(page.getByTestId("recent-attempt-row").filter({ hasText: STUDENT_FLOW.fullName })).toContainText("100%");
  await staffNav(page, "Attempts");
  await expect(page).toHaveURL(/\/staff\/review$/);
  await expectNoHorizontalOverflow(page);
  await page.getByRole("row").filter({ hasText: STUDENT_FLOW.fullName }).getByRole("link", { name: new RegExp(STUDENT_FLOW.fullName) }).click();
  await expect(page).toHaveURL(new RegExp(`/staff/review/${attemptId}$`));
  await expect(page.getByRole("heading", { name: STUDENT_FLOW.fullName })).toBeVisible();
  await expect(page.getByTestId("review-status")).toHaveText("Passed");
  await expect(page.getByTestId("review-question")).toHaveCount(5);
  await expect(page.getByText("Correct answer")).toHaveCount(5);
  await expect(page.getByTestId("review-question").first()).toContainText("is the exercise for size and warmth nice?");
  await expect(page.getByRole("button", { name: /release/i })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("full flow: a second student fails twice on two exam sets, is blocked at the second result while the other curriculum stays open, and staff give an extra attempt", async ({
  page,
}) => {
  const failOnce = async () => {
    await signIn(page, STUDENT_BLOCK.username, STUDENT_BLOCK.password, /\/exam\/start$/);
    await takeExam(page, BLOCK_CURRICULUM, 2, "Ja"); // the key is "Nein" and the pass mark 100 %
    await expect(page.getByTestId("result-outcome")).toHaveText("Nicht bestanden / Not passed");
  };

  await failOnce();
  await failOnce();
  await page.goto("/exam/start");
  await expect(curriculumCard(page, BLOCK_CURRICULUM)).toHaveAttribute("data-kind", "blocked");
  await expect(curriculumCard(page, BLOCK_CURRICULUM).getByTestId("contact-trainer")).toBeVisible();
  await expect(curriculumCard(page, BLOCK_OTHER_CURRICULUM)).toHaveAttribute("data-kind", "ready");
  await expectNoHorizontalOverflow(page);

  await signIn(page, STAFF.email, STAFF.password, /\/staff$/);
  await staffNav(page, "Blocked");
  await expect(page).toHaveURL(/\/staff\/blocked$/);
  await expectNoHorizontalOverflow(page);
  const row = page.getByRole("row").filter({ hasText: STUDENT_BLOCK.fullName });
  await expect(row).toContainText(BLOCK_CURRICULUM);
  await expect(row).toContainText("2 of 2");

  await staffNav(page, "Extra attempts");
  await expect(page).toHaveURL(/\/staff\/grants$/);
  await expectNoHorizontalOverflow(page);
  await page.getByTestId("grants-table").getByRole("row").filter({ hasText: STUDENT_BLOCK.fullName }).getByRole("button", { name: /Give extra attempts/ }).click();
  await expect(page.getByRole("dialog")).toContainText("lifts the block");
  await expectNoHorizontalOverflow(page);
  await page.getByRole("dialog").getByRole("button", { name: "Give extra attempts" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByTestId("grant-success")).toContainText(`Gave ${STUDENT_BLOCK.fullName} 1 extra attempt for ${BLOCK_CURRICULUM}. The block is lifted.`);
  await expect(page.getByTestId("grants-table").getByRole("row").filter({ hasText: STUDENT_BLOCK.fullName })).toHaveCount(0);

  await signIn(page, STUDENT_BLOCK.username, STUDENT_BLOCK.password, /\/exam\/start$/);
  await expect(curriculumCard(page, BLOCK_CURRICULUM).getByTestId("attempts-left")).toHaveText("1 attempt left");
  await startExam(page, BLOCK_CURRICULUM);
  await expect(page.getByRole("heading", { name: "Question 1 of 2" })).toBeVisible();
});
