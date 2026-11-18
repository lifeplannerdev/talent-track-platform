import { expect, test, type Page } from "@playwright/test";
import { BLOCK_CURRICULUM, STAFF, STUDENT_BLOCK } from "./fixtures";
import { adminDb, seed } from "./seed";

// STUDENT_BLOCK: held exam set, 2 questions per paper from 6, max 2 attempts, pass mark 100 %
// (the student always answers "Ja", the key is "Nein", so every attempt fails). No grant at first.

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

async function failExam(page: Page): Promise<string> {
  await signIn(page, STUDENT_BLOCK.username, STUDENT_BLOCK.password, /\/exam\/start$/);
  await page.getByRole("button", { name: "Start exam" }).click();
  await expect(page).toHaveURL(/\/exam\/[0-9a-f-]{36}$/);
  for (let i = 0; i < 2; i++) {
    await expect(page.getByRole("heading", { name: `Question ${i + 1} of 2` })).toBeVisible();
    await page.getByRole("radio", { name: "Ja", exact: true }).click();
    await expect(page.getByTestId("save-status")).toHaveText(/Saved/);
    if (i === 0) await page.getByRole("button", { name: "Next", exact: true }).click();
  }
  await page.getByRole("button", { name: "Review and submit" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Submit exam" }).click();
  await expect(page).toHaveURL(/\/results\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop()!;
}

async function release(page: Page, attemptId: string) {
  await page.goto(`/staff/review/${attemptId}`);
  await page.getByRole("button", { name: "Release result" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Release", exact: true }).click();
  await expect(page.getByTestId("review-status")).toHaveText("Released");
}

async function giveAttemptFromGrantsPage(page: Page) {
  await page.goto("/staff/grants");
  const row = page.getByRole("row").filter({ hasText: STUDENT_BLOCK.fullName });
  await expect(row).toContainText(BLOCK_CURRICULUM);
  await row.getByRole("button", { name: "Give attempt" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Grant attempt" }).click();
  // The modal hides the page from the accessibility tree; wait for it to close first.
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("row").filter({ hasText: STUDENT_BLOCK.fullName })).toHaveCount(0);
  // The confirmation stays visible although the row is gone.
  await expect(page.getByTestId("grant-success")).toContainText(`Attempt granted to ${STUDENT_BLOCK.fullName}`);
}

async function assignmentStatus() {
  const db = adminDb();
  const { data: p } = await db.from("profiles").select("id").eq("username", STUDENT_BLOCK.username).single();
  const { data: c } = await db.from("curriculums").select("id").eq("name", BLOCK_CURRICULUM).single();
  const { data } = await db.from("assignments").select("status").eq("student_id", p!.id).eq("curriculum_id", c!.id).single();
  return data!.status as string;
}

test("a student who fails the last allowed attempt is blocked, appears on the Blocked page and dashboard, and staff can grant another attempt", async ({
  page,
}) => {
  // Two full exams, two releases, the Blocked page and a grant: this flow runs close to the 30 s
  // default on a busy machine (27.6 s measured), so it gets its own budget like full-flow.
  test.setTimeout(90_000);
  // No attempt until staff give one.
  await signIn(page, STUDENT_BLOCK.username, STUDENT_BLOCK.password, /\/exam\/start$/);
  await expect(page.getByRole("button", { name: "Start exam" })).toHaveCount(0);

  await signIn(page, STAFF.email, STAFF.password, /\/staff$/);
  await page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Give attempts" }).click();
  await expect(page).toHaveURL(/\/staff\/grants$/);
  await giveAttemptFromGrantsPage(page);

  // Attempt 1 fails, staff release: one attempt left, so the student stays open and is grantable again.
  const first = await failExam(page);
  await signIn(page, STAFF.email, STAFF.password, /\/staff$/);
  await release(page, first);
  expect(await assignmentStatus()).toBe("open");
  await giveAttemptFromGrantsPage(page);

  // Attempt 2 fails: held, so no block is written (or shown) until release.
  const second = await failExam(page);
  await expect(page.getByTestId("result-status")).toHaveText(/Submitted, awaiting review/);
  expect(await assignmentStatus()).toBe("open");
  await signIn(page, STAFF.email, STAFF.password, /\/staff$/);
  await page.goto("/staff/blocked");
  await expect(page.getByRole("row").filter({ hasText: STUDENT_BLOCK.fullName })).toHaveCount(0);
  await release(page, second);
  expect(await assignmentStatus()).toBe("blocked");

  // Dashboard card.
  await page.goto("/staff");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  const card = page.getByTestId("blocked-card");
  await expect(card.getByTestId("blocked-total")).not.toHaveText("0");
  const preview = card.getByTestId("blocked-preview-row").filter({ hasText: STUDENT_BLOCK.fullName });
  await expect(preview).toContainText(BLOCK_CURRICULUM);
  await expect(preview).toContainText("Last score 0% (0 / 2)");
  await expect(page.getByTestId("count-blocked")).not.toHaveText("0");

  // Blocked page.
  await card.getByRole("link", { name: "View blocked students" }).click();
  await expect(page).toHaveURL(/\/staff\/blocked$/);
  const row = page.getByRole("row").filter({ hasText: STUDENT_BLOCK.fullName });
  await expect(row).toContainText(BLOCK_CURRICULUM);
  await expect(row).toContainText("2 of 2");
  await expect(row).toContainText("0%");
  await expect(row).toContainText("0 / 2");
  await expect(row.getByRole("link", { name: "Reassign curriculums" })).toHaveAttribute("href", /\/staff\/students\/[0-9a-f-]{36}$/);

  // The blocked student cannot start anything.
  await signIn(page, STUDENT_BLOCK.username, STUDENT_BLOCK.password, /\/exam\/start$/);
  await expect(page.getByTestId("blocked-contact-trainer")).toBeVisible();

  // Staff grant another attempt from the Blocked page (2 unseen questions left, 2 needed).
  await signIn(page, STAFF.email, STAFF.password, /\/staff$/);
  await page.goto("/staff/blocked");
  const blockedRow = page.getByRole("row").filter({ hasText: STUDENT_BLOCK.fullName });
  await blockedRow.getByRole("button", { name: "Grant another attempt" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("lifts the block");
  await dialog.getByRole("button", { name: "Grant attempt" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("row").filter({ hasText: STUDENT_BLOCK.fullName })).toHaveCount(0);
  await expect(page.getByTestId("grant-success")).toContainText(`Attempt granted to ${STUDENT_BLOCK.fullName}`);
  expect(await assignmentStatus()).toBe("open");

  // The student can start again.
  await signIn(page, STUDENT_BLOCK.username, STUDENT_BLOCK.password, /\/exam\/start$/);
  await expect(page.getByTestId("next-exam")).toContainText(BLOCK_CURRICULUM);
  await page.getByRole("button", { name: "Start exam" }).click();
  await expect(page).toHaveURL(/\/exam\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Question 1 of 2" })).toBeVisible();
});

test("when too few unseen questions are left, staff see the shortfall and nothing is granted", async ({ page }) => {
  // Make the student blocked with only 1 unseen question left: retire 2 of the 6 questions.
  const db = adminDb();
  const { data: c } = await db.from("curriculums").select("id").eq("name", BLOCK_CURRICULUM).single();
  const { data: set } = await db.from("exam_sets").select("id").eq("curriculum_id", c!.id).single();
  const { data: student } = await db.from("profiles").select("id").eq("username", STUDENT_BLOCK.username).single();
  const { data: qs } = await db.from("questions").select("id").eq("exam_set_id", set!.id).order("stem_de");
  const ids = qs!.map((q) => q.id);
  // Two attempts on questions 1-4, failed and released; question 5 drafted; question 6 is the only unseen one.
  for (const pair of [ids.slice(0, 2), ids.slice(2, 4)]) {
    await db.from("attempt_grants").insert({ student_id: student!.id, exam_set_id: set!.id });
    const { data: attemptId, error } = await db.rpc("start_attempt", {
      p_student_id: student!.id,
      p_exam_set_id: set!.id,
      p_draw: pair.map((id) => ({ question_id: id, option_order: ["a", "b", "c"] })),
    });
    if (error) throw error;
    await db.rpc("close_attempt", { p_attempt_id: attemptId, p_only_if_expired: false });
    const { data: aq } = await db.from("attempt_questions").select("id").eq("attempt_id", attemptId);
    const { error: scoreError } = await db.rpc("record_score", {
      p_attempt_id: attemptId,
      p_points: 0,
      p_max_points: 2,
      p_passed: false,
      p_questions: aq!.map((q) => ({ attempt_question_id: q.id, correct_option_id: "b", max_points: 1, awarded_points: 0, topic: "allgemein" })),
    });
    if (scoreError) throw scoreError;
    const { error: releaseError } = await db.rpc("release_attempt", { p_attempt_id: attemptId, p_released_by: null });
    if (releaseError) throw releaseError;
  }
  await db.from("questions").update({ status: "draft" }).eq("id", ids[4]);
  expect(await assignmentStatus()).toBe("blocked");

  await signIn(page, STAFF.email, STAFF.password, /\/staff$/);
  await page.goto("/staff/blocked");
  const row = page.getByRole("row").filter({ hasText: STUDENT_BLOCK.fullName });
  await row.getByRole("button", { name: "Grant another attempt" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Grant attempt" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(row.getByTestId("grant-error")).toHaveText("Only 1 unseen question left, 2 needed");
  expect(await assignmentStatus()).toBe("blocked");
  const { data: grants } = await db.from("attempt_grants").select("id").eq("student_id", student!.id).is("used_attempt_id", null);
  expect(grants).toEqual([]);
});
