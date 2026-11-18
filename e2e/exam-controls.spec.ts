import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { EXAM_CURRICULUM_HELD, STAFF, STUDENT_EXAM, STUDENT_EXAM_OPEN } from "./fixtures";
import { expectNoHorizontalOverflow } from "./helpers";
import { adminDb, seed } from "./seed";

// Exam controls: staff set hours, minutes, count and reminders per exam set; students see them
// on the start card and get non-blocking "N minutes left" reminders during the exam.

test.beforeEach(async () => {
  await seed();
});

async function signIn(page: Page, username: string, password: string, home: RegExp) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Username or email").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(home);
}

async function savedAnswers(attemptId: string) {
  const db = adminDb();
  const { data: aqs } = await db.from("attempt_questions").select("id, position").eq("attempt_id", attemptId);
  const { data: answers } = await db
    .from("answers")
    .select("attempt_question_id, option_id")
    .in(
      "attempt_question_id",
      (aqs ?? []).map((a) => a.id),
    );
  const byPosition: Record<number, string> = {};
  for (const a of answers ?? []) byPosition[aqs!.find((q) => q.id === a.attempt_question_id)!.position] = a.option_id;
  return byPosition;
}

test("staff set hours, minutes, questions and reminders; the student start card shows them", async ({ page }) => {
  await signIn(page, STAFF.email, STAFF.password, /\/staff$/);
  const { data: c } = await adminDb().from("curriculums").select("id").eq("name", EXAM_CURRICULUM_HELD).single();
  await page.goto(`/staff/curriculums/${c!.id}`);
  const card = page.getByTestId("exam-set-card").first();
  await expect(card.getByTestId("exam-set-summary")).toContainText(
    "3 questions, 30 min, pass at 60%, 1 attempt, result held for review, reminder every 15 min",
  );

  await card.getByText("Edit settings").click();
  const form = card.getByRole("form");
  await expect(form.getByLabel("Hours", { exact: true })).toHaveValue("0");
  await expect(form.getByLabel("Minutes", { exact: true })).toHaveValue("30");
  // Minutes of 60 or more are invalid (the browser stops the submit) and the preview says so.
  await form.getByLabel("Minutes", { exact: true }).fill("75");
  await expect(form.getByTestId("exam-set-preview")).toContainText("Fill in the settings above");
  expect(await form.getByLabel("Minutes", { exact: true }).evaluate((el: HTMLInputElement) => el.checkValidity())).toBe(false);
  // No duration at all is refused with a clear message, nothing is saved.
  await form.getByLabel("Hours", { exact: true }).fill("");
  await form.getByLabel("Minutes", { exact: true }).fill("");
  await form.getByRole("button", { name: "Save settings" }).click();
  await expect(form).toContainText("Enter whole hours and 0 to 59 minutes");

  await form.getByLabel("Hours", { exact: true }).fill("2");
  await form.getByLabel("Minutes", { exact: true }).fill("30");
  await form.getByLabel("Time reminder every (minutes)").fill("20");
  await expect(form.getByTestId("exam-set-preview")).toContainText(
    "3 questions, 2 h 30 min, pass at 60%, 1 attempt, result held for review, reminder every 20 min",
  );
  await form.getByRole("button", { name: "Save settings" }).click();
  await expect(form.getByTestId("exam-set-saved")).toContainText("Settings saved.");
  await expect(card.getByTestId("exam-set-summary")).toContainText("2 h 30 min");
  await expect(card.getByTestId("exam-set-summary")).toContainText("reminder every 20 min");
  const { data: row } = await adminDb()
    .from("exam_sets")
    .select("time_limit_min, question_count, reminder_interval_min")
    .eq("curriculum_id", c!.id)
    .single();
  expect(row).toEqual({ time_limit_min: 150, question_count: 3, reminder_interval_min: 20 });

  await signIn(page, STUDENT_EXAM.username, STUDENT_EXAM.password, /\/exam\/start$/);
  await expect(page.getByTestId("question-count")).toHaveText("3");
  await expect(page.getByTestId("time-limit")).toHaveText("2 h 30 min");
});

test("time reminders: shown at the right minutes, closable, never touch answers, submit still works", async ({ page }) => {
  // Fake browser clock: the countdown and reminders use Date.now() plus the server offset, so
  // jumping the clock moves the exam forward on screen (the server deadline is real time).
  await page.clock.install();
  await signIn(page, STUDENT_EXAM_OPEN.username, STUDENT_EXAM_OPEN.password, /\/exam\/start$/);
  await page.getByRole("button", { name: "Start exam" }).click();
  await expect(page).toHaveURL(/\/exam\/[0-9a-f-]{36}$/);
  const attemptId = page.url().split("/").pop()!;
  await expect(page.getByTestId("timer")).not.toHaveText("--:--");
  await expect(page.getByTestId("time-reminder")).toHaveCount(0);

  await page.getByRole("radio", { name: "Nein", exact: true }).click();
  await expect(page.getByTestId("save-status")).toHaveText(/Saved/);

  // 30 minute exam, reminder every 15 min: at 15 minutes left.
  await page.clock.fastForward("15:05");
  const reminder = page.getByTestId("time-reminder");
  await expect(reminder).toHaveText("15 minutes left.");
  await expect(page.getByRole("status").filter({ hasText: "15 minutes left." })).toBeVisible();
  // It does not take focus.
  expect(await page.evaluate(() => document.activeElement?.closest("[data-testid=time-reminder-region]") ?? null)).toBeNull();

  // While it shows, the student keeps working: next question, choose an option.
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Question 2 of 3" })).toBeVisible();
  await page.getByRole("radio", { name: "Ja", exact: true }).click();
  await expect(page.getByTestId("save-status")).toHaveText(/Saved/);
  await expect(reminder).toBeVisible();

  // Accessible and no sideways scroll with the reminder visible.
  await expectNoHorizontalOverflow(page);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const blocking = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  // It sits in the exam bar: it does not overlap the question or the answers.
  const bar = await page.getByTestId("time-reminder-region").boundingBox();
  const stem = await page.getByTestId("question-stem").boundingBox();
  expect(bar!.y + bar!.height).toBeLessThanOrEqual(stem!.y);

  // Escape (focus inside it) closes it; the chosen answer and the saved answers stay.
  await page.getByRole("button", { name: "Close reminder" }).focus();
  await page.keyboard.press("Escape");
  await expect(reminder).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Ja", exact: true })).toBeChecked();
  await expect(page.getByRole("button", { name: "Question 1, answered" })).toBeVisible();
  expect(await savedAnswers(attemptId)).toEqual({ 1: "b", 2: "a" });

  // 5 minutes left: a final reminder; the close button hides it at once.
  await page.clock.fastForward("10:00");
  await expect(reminder).toHaveText("5 minutes left.");
  await page.getByRole("button", { name: "Close reminder" }).click();
  await expect(reminder).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Ja", exact: true })).toBeChecked();

  // Submit still works and keeps both answers.
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("radio", { name: "Nein", exact: true }).click();
  await expect(page.getByTestId("save-status")).toHaveText(/Saved/);
  await page.getByRole("button", { name: "Review and submit" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Submit exam" }).click();
  await expect(page).toHaveURL(new RegExp(`/results/${attemptId}$`));
  expect(await savedAnswers(attemptId)).toEqual({ 1: "b", 2: "a", 3: "b" });
});

test("reminders off: an exam set with interval 0 shows none", async ({ page }) => {
  const db = adminDb();
  const { data: c } = await db.from("curriculums").select("id").eq("name", "E2E Exam Curriculum Open").single();
  await db.from("exam_sets").update({ reminder_interval_min: 0 }).eq("curriculum_id", c!.id);
  await page.clock.install();
  await signIn(page, STUDENT_EXAM_OPEN.username, STUDENT_EXAM_OPEN.password, /\/exam\/start$/);
  await page.getByRole("button", { name: "Start exam" }).click();
  await expect(page.getByTestId("timer")).not.toHaveText("--:--");
  await page.clock.fastForward("15:05");
  await expect(page.getByTestId("timer")).toHaveText(/^1[45]:\d\d$/);
  await expect(page.getByTestId("time-reminder")).toHaveCount(0);
});
