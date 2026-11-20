import { expect, test, type Page } from "@playwright/test";
import { BLOCK_CURRICULUM, BLOCK_OTHER_CURRICULUM, STAFF, STUDENT_BLOCK } from "./fixtures";
import { assignment, attemptRow, curriculumCard, curriculumId, profileId, signIn, staffNav, takeExam } from "./helpers";
import { adminDb, seed } from "./seed";

// STUDENT_BLOCK: BLOCK_CURRICULUM has 2 attempts per student and two exam sets of 2 questions
// with a 100 % pass mark (the student answers "Ja", the key is "Nein": every attempt fails).
// BLOCK_OTHER_CURRICULUM is a separate exam that must stay untouched.

test.beforeEach(async () => {
  await seed();
});

const signInStudent = (page: Page) => signIn(page, STUDENT_BLOCK.username, STUDENT_BLOCK.password, /\/exam\/start$/);
const signInStaff = (page: Page) => signIn(page, STAFF.email, STAFF.password, /\/staff$/);

/** Fails one attempt of BLOCK_CURRICULUM from the start page; the result shows at once. */
async function failOnce(page: Page): Promise<string> {
  const attemptId = await takeExam(page, BLOCK_CURRICULUM, ["Ja", "Ja"]);
  await expect(page.getByTestId("result-score")).toHaveText("0%");
  await expect(page.getByTestId("result-outcome")).toHaveText("Nicht bestanden / Not passed");
  await page.goto("/exam/start");
  return attemptId;
}

test("two failed attempts on two different exam sets block the curriculum at once; the other stays open; extra attempts with repeats unblock; a pass then counts", async ({
  page,
}) => {
  // Four exams, the Blocked page and the dialog: this flow gets its own budget like full-flow.
  test.setTimeout(120_000);
  await signInStudent(page);
  await expect(curriculumCard(page, BLOCK_CURRICULUM).getByTestId("attempts-left")).toHaveText("2 attempts left");

  // Attempt 1 fails: one left, still open.
  const first = await failOnce(page);
  expect((await assignment(STUDENT_BLOCK.username, BLOCK_CURRICULUM)).status).toBe("open");
  await expect(curriculumCard(page, BLOCK_CURRICULUM).getByTestId("attempts-left")).toHaveText("1 attempt left");

  // Attempt 2 fails on the other exam set: blocked in the same step the result is shown.
  const second = await failOnce(page);
  const [a1, a2] = [await attemptRow(first), await attemptRow(second)];
  expect(a1.exam_set_id).not.toBe(a2.exam_set_id);
  expect(a2).toMatchObject({ status: "released", points: 0, passed: false });
  expect((await assignment(STUDENT_BLOCK.username, BLOCK_CURRICULUM)).status).toBe("blocked");

  const blockedCard = curriculumCard(page, BLOCK_CURRICULUM);
  await expect(blockedCard).toHaveAttribute("data-kind", "blocked");
  await expect(blockedCard.getByTestId("contact-trainer")).toHaveText(/contact your trainer/);
  await expect(blockedCard.getByRole("button", { name: "Start exam" })).toHaveCount(0);
  await expect(blockedCard.getByTestId("attempts-left")).toHaveCount(0);
  // The other curriculum is independent: still ready with both attempts.
  await expect(curriculumCard(page, BLOCK_OTHER_CURRICULUM)).toHaveAttribute("data-kind", "ready");
  await expect(curriculumCard(page, BLOCK_OTHER_CURRICULUM).getByTestId("attempts-left")).toHaveText("2 attempts left");
  expect((await assignment(STUDENT_BLOCK.username, BLOCK_OTHER_CURRICULUM)).status).toBe("open");
  // A third start is refused by the database as well.
  const { error: refused } = await adminDb().rpc("start_attempt", {
    p_student_id: await profileId(STUDENT_BLOCK.username),
    p_exam_set_id: a1.exam_set_id,
    p_draw: [],
  });
  expect(refused?.message).toBe("blocked");

  // Dashboard card.
  await signInStaff(page);
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
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(BLOCK_CURRICULUM);
  await expect(row).toContainText(a2.exam_sets.name);
  await expect(row).toContainText("2 of 2");
  await expect(row).toContainText("0%");
  await expect(row).toContainText("0 / 2");
  await expect(row.getByRole("link", { name: /Student page/ })).toHaveAttribute("href", /\/staff\/students\/[0-9a-f-]{36}$/);

  // Give one extra attempt from the Blocked page. No exam set is left, so repeats start switched on.
  await row.getByRole("button", { name: /Give extra attempts/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("2 of 2 attempts used");
  await expect(dialog).toContainText("lifts the block");
  await expect(dialog.getByRole("spinbutton", { name: "Number of extra attempts" })).toHaveValue("1");
  await expect(dialog.getByRole("switch", { name: "Allow repeating exam sets" })).toBeChecked();
  await dialog.getByRole("button", { name: "Give extra attempts" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("grant-success")).toHaveText(
    `Gave ${STUDENT_BLOCK.fullName} 1 extra attempt for ${BLOCK_CURRICULUM}. The block is lifted. Exam sets they already had may be given again.`,
  );
  await expect(page.getByRole("row").filter({ hasText: STUDENT_BLOCK.fullName })).toHaveCount(0);
  expect(await assignment(STUDENT_BLOCK.username, BLOCK_CURRICULUM)).toEqual({ status: "open", extra_attempts: 1, allow_repeats: true });

  // The student can start again (a repeated exam set) and this time passes: the card is passed.
  await signInStudent(page);
  await expect(curriculumCard(page, BLOCK_CURRICULUM).getByTestId("attempts-left")).toHaveText("1 attempt left");
  const third = await takeExam(page, BLOCK_CURRICULUM, ["Nein", "Nein"]);
  await expect(page.getByTestId("result-score")).toHaveText("100%");
  await expect(page.getByTestId("result-outcome")).toHaveText("Bestanden / Passed");
  expect([a1.exam_set_id, a2.exam_set_id]).toContain((await attemptRow(third)).exam_set_id);
  expect((await assignment(STUDENT_BLOCK.username, BLOCK_CURRICULUM)).status).toBe("passed");
  await page.goto("/exam/start");
  await expect(curriculumCard(page, BLOCK_CURRICULUM)).toHaveAttribute("data-kind", "passed");
  await expect(curriculumCard(page, BLOCK_CURRICULUM)).toContainText("100%");
  await expect(curriculumCard(page, BLOCK_OTHER_CURRICULUM)).toHaveAttribute("data-kind", "ready");
});

test("fewer exam sets than attempts: staff see a warning, the student is told to contact the trainer, and allowing repeats on the Extra attempts page lets them continue", async ({
  page,
}) => {
  test.setTimeout(90_000);
  // Leave BLOCK_CURRICULUM with one exam set for its 2 attempts.
  const db = adminDb();
  const cId = await curriculumId(BLOCK_CURRICULUM);
  const { error } = await db.from("exam_sets").delete().eq("curriculum_id", cId).eq("name", "Block 2");
  if (error) throw error;

  await signInStaff(page);
  await page.goto(`/staff/curriculums/${cId}`);
  await expect(page.getByTestId("curriculum-warning")).toContainText("Only 1 exam set can be given, but students get 2 attempts");

  // The first attempt uses the only exam set; then there is none left for this student.
  await signInStudent(page);
  await failOnce(page);
  const card = curriculumCard(page, BLOCK_CURRICULUM);
  await expect(card).toHaveAttribute("data-kind", "unavailable");
  await expect(card.getByTestId("contact-trainer")).toHaveText("No exam is available right now, please contact your trainer.");
  await expect(card.getByRole("button", { name: "Start exam" })).toHaveCount(0);
  expect((await assignment(STUDENT_BLOCK.username, BLOCK_CURRICULUM)).status).toBe("open");

  // Staff: listed under "No exam set left" (not blocked); allow repeats with one extra attempt.
  await signInStaff(page);
  await staffNav(page, "Extra attempts");
  await expect(page).toHaveURL(/\/staff\/grants$/);
  await expect(page.getByTestId("grants-table").getByRole("row").filter({ hasText: STUDENT_BLOCK.fullName })).toHaveCount(0);
  const row = page.getByTestId("short-table").getByRole("row").filter({ hasText: STUDENT_BLOCK.fullName });
  await expect(row).toContainText(BLOCK_CURRICULUM);
  await expect(row).toContainText("1 of 2");
  await row.getByRole("button", { name: /Give extra attempts/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).not.toContainText("lifts the block");
  await expect(dialog).toContainText("Repeats are saved together with at least one extra attempt.");
  await expect(dialog.getByRole("switch", { name: "Allow repeating exam sets" })).toBeChecked();
  await dialog.getByRole("button", { name: "Give extra attempts" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("grant-success")).toHaveText(
    `Gave ${STUDENT_BLOCK.fullName} 1 extra attempt for ${BLOCK_CURRICULUM}. Exam sets they already had may be given again.`,
  );
  await expect(page.getByRole("row").filter({ hasText: STUDENT_BLOCK.fullName })).toHaveCount(0);
  expect(await assignment(STUDENT_BLOCK.username, BLOCK_CURRICULUM)).toEqual({ status: "open", extra_attempts: 1, allow_repeats: true });

  await signInStudent(page);
  await expect(curriculumCard(page, BLOCK_CURRICULUM)).toHaveAttribute("data-kind", "ready");
  await expect(curriculumCard(page, BLOCK_CURRICULUM).getByTestId("attempts-left")).toHaveText("2 attempts left");
});
