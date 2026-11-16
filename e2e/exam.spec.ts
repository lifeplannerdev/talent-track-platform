import { expect, test, type Page } from "@playwright/test";
import { EXAM_CURRICULUM_HELD, EXAM_CURRICULUM_OPEN, STUDENT_EXAM, STUDENT_EXAM_OPEN } from "./fixtures";
import { adminDb, seed } from "./seed";

test.beforeEach(async () => {
  await seed();
});

async function signIn(page: Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Username or email").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/exam\/start$/);
}

async function studentId(username: string) {
  const { data } = await adminDb().from("profiles").select("id").eq("username", username).single();
  return data!.id as string;
}

async function assignmentStatus(username: string, curriculumName: string) {
  const db = adminDb();
  const { data: c } = await db.from("curriculums").select("id").eq("name", curriculumName).single();
  const { data } = await db
    .from("assignments")
    .select("status")
    .eq("student_id", await studentId(username))
    .eq("curriculum_id", c!.id)
    .single();
  return data!.status as string;
}

const stem = (page: Page) => page.getByTestId("question-stem");
async function optionTexts(page: Page) {
  await expect(page.getByRole("radio")).toHaveCount(3);
  return page.getByRole("radio").evaluateAll((els) => els.map((e) => e.closest("label")!.textContent));
}

async function choose(page: Page, option: string) {
  await page.getByRole("radio", { name: option, exact: true }).click();
  await expect(page.getByTestId("save-status")).toHaveText(/Saved/);
}

// Marks must never reach the student before release (and Task 6 owns showing them after).
async function expectNoMarks(page: Page) {
  // innerText skips routes Next keeps rendered but hidden after navigation.
  await expect(page.getByTestId("result-status")).toBeVisible();
  expect(await page.locator("body").innerText()).not.toMatch(/\d+\s*(\/|of)\s*\d+|points|%|passed|failed|bestanden/i);
}

test("held exam: start, refresh mid-way to the same paper, submit and see awaiting review without marks", async ({ page }) => {
  await signIn(page, STUDENT_EXAM.username, STUDENT_EXAM.password);
  await expect(page.getByTestId("next-exam")).toContainText(EXAM_CURRICULUM_HELD);
  await expect(page.getByTestId("question-count")).toHaveText("3");
  await page.getByRole("button", { name: "Start exam" }).click();
  await expect(page).toHaveURL(/\/exam\/[0-9a-f-]{36}$/);
  const examUrl = page.url();

  // German question text, English interface, a running countdown.
  await expect(page.getByRole("heading", { name: "Question 1 of 3" })).toBeVisible();
  await expect(page.getByTestId("timer")).toHaveText(/^(29|30):\d\d$/);
  const stem1 = await stem(page).textContent();
  expect(stem1).toMatch(/\?$/);
  const order1 = await optionTexts(page);
  await choose(page, "Nein");

  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Question 2 of 3" })).toBeVisible();
  const stem2 = await stem(page).textContent();
  const order2 = await optionTexts(page);
  await choose(page, "Ja");

  // Refresh: same paper, same option order, saved answers restored.
  await page.reload({ waitUntil: "load" });
  await expect(page).toHaveURL(examUrl);
  await expect(stem(page)).toHaveText(stem1!);
  expect(await optionTexts(page)).toEqual(order1);
  await expect(page.getByRole("radio", { name: "Nein", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Question 2, answered" }).click();
  await expect(stem(page)).toHaveText(stem2!);
  expect(await optionTexts(page)).toEqual(order2);
  await expect(page.getByRole("radio", { name: "Ja", exact: true })).toBeChecked();

  await page.getByRole("button", { name: "Question 3, not answered" }).click();
  await expect(stem(page)).not.toHaveText(stem1!);
  await expect(stem(page)).not.toHaveText(stem2!);
  await choose(page, "Nein");

  // Confirm dialog: cancel first, then submit.
  await page.getByRole("button", { name: "Review and submit" }).click();
  const dialog = page.getByRole("dialog", { name: "Submit your exam?" });
  await expect(dialog).toContainText("You answered 3 of 3 questions");
  await dialog.getByRole("button", { name: "Keep working" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Submit exam" }).click();

  await expect(page).toHaveURL(/\/results\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("result-status")).toHaveText(/Submitted, awaiting review/);
  await expectNoMarks(page);

  // The attempt is scored and held; the assignment does not change until release.
  const attemptId = page.url().split("/").pop()!;
  const { data: attempt } = await adminDb().from("attempts").select("status, points, released_at").eq("id", attemptId).single();
  expect(attempt).toEqual({ status: "submitted", points: 2, released_at: null });
  expect(await assignmentStatus(STUDENT_EXAM.username, EXAM_CURRICULUM_HELD)).toBe("open");

  // Back on the start page: awaiting review, no new attempt; the exam page now leads to the result.
  await page.goto("/exam/start");
  await expect(page.getByTestId("awaiting-review")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start exam" })).toHaveCount(0);
  await page.goto(examUrl);
  await expect(page).toHaveURL(/\/results\//);
});

test("non-held exam: released at once, the student sees Submitted without marks", async ({ page }) => {
  await signIn(page, STUDENT_EXAM_OPEN.username, STUDENT_EXAM_OPEN.password);
  await page.getByRole("button", { name: "Start exam" }).click();
  await expect(page).toHaveURL(/\/exam\/[0-9a-f-]{36}$/);

  for (let i = 1; i <= 3; i++) {
    await expect(page.getByRole("heading", { name: `Question ${i} of 3` })).toBeVisible();
    await choose(page, "Nein");
    if (i < 3) await page.getByRole("button", { name: "Next", exact: true }).click();
  }
  await page.getByRole("button", { name: "Review and submit" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Submit exam" }).click();

  await expect(page).toHaveURL(/\/results\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("result-status")).toHaveText("Your exam has been submitted.");
  await expectNoMarks(page);
  expect(await assignmentStatus(STUDENT_EXAM_OPEN.username, EXAM_CURRICULUM_OPEN)).toBe("passed");
});

test("an expired attempt is submitted when the student comes back", async ({ page }) => {
  await signIn(page, STUDENT_EXAM.username, STUDENT_EXAM.password);
  await page.getByRole("button", { name: "Start exam" }).click();
  await expect(page).toHaveURL(/\/exam\/[0-9a-f-]{36}$/);
  await choose(page, "Nein");
  const attemptId = page.url().split("/").pop()!;

  // Move the deadline into the past (database time decides).
  await adminDb()
    .from("attempts")
    .update({
      started_at: new Date(Date.now() - 40 * 60_000).toISOString(),
      deadline_at: new Date(Date.now() - 60_000).toISOString(),
    })
    .eq("id", attemptId);

  await page.reload();
  await expect(page).toHaveURL(new RegExp(`/results/${attemptId}$`));
  await expect(page.getByTestId("result-status")).toHaveText(/Submitted, awaiting review/);
  const { data } = await adminDb().from("attempts").select("status").eq("id", attemptId).single();
  expect(data!.status).toBe("submitted");
});

test("offline: a banner shows and the answer is saved once the connection is back", async ({ page, context }) => {
  await signIn(page, STUDENT_EXAM.username, STUDENT_EXAM.password);
  await page.getByRole("button", { name: "Start exam" }).click();
  await expect(page).toHaveURL(/\/exam\/[0-9a-f-]{36}$/);
  const attemptId = page.url().split("/").pop()!;
  // The countdown appears once the page is hydrated and listening for connection changes.
  await expect(page.getByTestId("timer")).not.toHaveText("--:--");

  await context.setOffline(true);
  await expect(page.getByTestId("offline-banner")).toBeVisible();
  await page.getByRole("radio", { name: "Vielleicht", exact: true }).click();
  await expect(page.getByTestId("save-status")).toHaveText("Not saved yet, will retry");

  await context.setOffline(false);
  await expect(page.getByTestId("offline-banner")).toBeHidden();
  await expect(page.getByTestId("save-status")).toHaveText(/Saved/);
  const { data: aq } = await adminDb().from("attempt_questions").select("id").eq("attempt_id", attemptId).eq("position", 1).single();
  const { data: answer } = await adminDb().from("answers").select("option_id").eq("attempt_question_id", aq!.id).single();
  expect(answer!.option_id).toBe("c");
});

test("the cron sweep route is not behind the login redirect and requires its secret", async ({ request }) => {
  const res = await request.get("/api/cron/sweep", { maxRedirects: 0 });
  expect(res.status()).toBe(401);
  const wrong = await request.get("/api/cron/sweep", { maxRedirects: 0, headers: { authorization: "Bearer nope" } });
  expect(wrong.status()).toBe(401);
});
