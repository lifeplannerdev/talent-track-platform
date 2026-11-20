import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import {
  BLOCK_CURRICULUM,
  EXAM_CURRICULUM,
  EXAM_CURRICULUM_OPEN,
  STAFF,
  STUDENT_BLOCK,
  STUDENT_CONSENTED,
  STUDENT_EXAM,
  STUDENT_EXAM_OPEN,
  STUDENT_NEW,
} from "./fixtures";
import {
  answerAll,
  curriculumCard,
  curriculumId,
  expectNoHorizontalOverflow,
  profileId,
  signIn,
  startExam,
  takeExam,
} from "./helpers";
import { adminDb, seed } from "./seed";

// Design review: every main screen at 375 px and desktop gets (1) a check that the page itself
// never scrolls sideways (wide tables scroll inside their own wrapper), (2) an axe scan for
// WCAG 2.2 A/AA where serious or critical violations fail the test, and (3) a full-page
// screenshot under docs/design-review/ for a human look. SHOT_DIR overrides the folder and
// A11Y_REPORT_ONLY=1 records violations without failing (used for the before/after comparison).

const SHOT_DIR = process.env.SHOT_DIR ?? path.join("docs", "design-review");
const REPORT_ONLY = process.env.A11Y_REPORT_ONLY === "1";

type Finding = { page: string; id: string; impact: string; nodes: number; help: string };

test.setTimeout(240_000);
// Scan settled screens: with reduced motion the dialog fade-in cannot catch axe mid-animation.
test.use({ reducedMotion: "reduce" });

test.beforeEach(async () => {
  await seed();
});

/** Before a score exists nothing shows a percentage, points or an outcome (innerText skips hidden routes). */
async function expectNoMarks(page: Page) {
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/\d\s*%/);
  expect(text).not.toMatch(/points|passed|bestanden/i);
}

async function review(page: Page, info: TestInfo, name: string, findings: Finding[]) {
  // Wait for streamed content: no loading placeholders left.
  await expect(page.locator('[role="status"][aria-label^="Loading"]')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await expectNoHorizontalOverflow(page);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  for (const v of results.violations) {
    findings.push({ page: name, id: v.id, impact: v.impact ?? "unknown", nodes: v.nodes.length, help: v.help });
  }
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}-${info.project.name}.png`), fullPage: true });
}

function finish(info: TestInfo, findings: Finding[]) {
  mkdirSync("test-results", { recursive: true });
  const area = info.title.split(":")[0].replace(/\W+/g, "-");
  writeFileSync(path.join("test-results", `a11y-${area}-${info.project.name}.json`), JSON.stringify(findings, null, 2));
  const blocking = findings.filter((f) => f.impact === "serious" || f.impact === "critical");
  if (!REPORT_ONLY) expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

test("landing page: public home at 375 px and desktop", async ({ page }, info) => {
  const findings: Finding[] = [];
  await page.context().clearCookies();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await review(page, info, "00-landing", findings);
  finish(info, findings);
});

test("student screens: login, consent, empty start, curriculum cards, exam, submit dialog, result at once and print, results list, blocked and calculating cards", async ({
  page,
}, info) => {
  const findings: Finding[] = [];
  const db = adminDb();
  // Fake clock (time still flows) so the exam can jump to its 15-minute reminder.
  await page.clock.install();

  await page.goto("/login");
  await review(page, info, "01-login", findings);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("#login-error")).toBeVisible();
  await review(page, info, "01-login-error", findings);

  await signIn(page, STUDENT_NEW.username, STUDENT_NEW.password, /\/consent$/);
  await review(page, info, "02-consent", findings);

  await signIn(page, STUDENT_CONSENTED.username, STUDENT_CONSENTED.password, /\/exam\/start$/);
  await review(page, info, "03-start-empty", findings);

  // Two independent curriculums, both ready.
  await signIn(page, STUDENT_EXAM.username, STUDENT_EXAM.password, /\/exam\/start$/);
  await expect(page.getByTestId("curriculum-card").filter({ visible: true })).toHaveCount(2);
  await review(page, info, "04-start-cards", findings);
  await startExam(page, EXAM_CURRICULUM);
  await expect(page.getByTestId("timer")).toHaveText(/^\d\d:\d\d$/);
  await review(page, info, "05-exam-question", findings);
  await page.clock.fastForward("15:05");
  await expect(page.getByTestId("time-reminder")).toHaveText("15 minutes left.");
  await review(page, info, "05-exam-reminder", findings);
  await page.getByRole("button", { name: "Close reminder" }).click();
  await answerAll(page, ["Nein", "Ja", "Nein"]);
  await review(page, info, "05-exam-last-question", findings);
  await page.getByRole("button", { name: "Review and submit" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await review(page, info, "06-exam-submit-dialog", findings);
  await page.getByRole("dialog").getByRole("button", { name: "Submit exam" }).click();
  await expect(page).toHaveURL(/\/results\/[0-9a-f-]{36}$/);
  // The result at once, percentage first.
  await expect(page.getByTestId("result-score")).toHaveText("66.7%");
  await review(page, info, "07-result-report", findings);
  await page.emulateMedia({ media: "print" });
  await page.screenshot({ path: path.join(SHOT_DIR, `07-result-print-${info.project.name}.png`), fullPage: true });
  await page.emulateMedia({ media: "screen" });
  // Back on the start page: one passed card, one ready card and the results per curriculum.
  await page.goto("/exam/start");
  await expect(curriculumCard(page, EXAM_CURRICULUM)).toHaveAttribute("data-kind", "passed");
  await expect(page.getByTestId("results-list").filter({ visible: true })).toBeVisible();
  await review(page, info, "08-start-results", findings);

  // A blocked curriculum next to an open one.
  const blockedId = await profileId(STUDENT_BLOCK.username);
  await db
    .from("assignments")
    .update({ status: "blocked" })
    .eq("student_id", blockedId)
    .eq("curriculum_id", await curriculumId(BLOCK_CURRICULUM));
  await signIn(page, STUDENT_BLOCK.username, STUDENT_BLOCK.password, /\/exam\/start$/);
  await expect(curriculumCard(page, BLOCK_CURRICULUM)).toHaveAttribute("data-kind", "blocked");
  await review(page, info, "09-start-blocked", findings);

  // A submitted attempt whose score is not recorded yet (no paper: it stays "being calculated").
  const { data: set } = await db
    .from("exam_sets")
    .select("id")
    .eq("curriculum_id", await curriculumId(EXAM_CURRICULUM_OPEN))
    .single();
  const now = Date.now();
  const { data: pending, error: pendingError } = await db
    .from("attempts")
    .insert({
      student_id: await profileId(STUDENT_EXAM_OPEN.username),
      exam_set_id: set!.id,
      status: "submitted",
      started_at: new Date(now - 20 * 60_000).toISOString(),
      deadline_at: new Date(now + 10 * 60_000).toISOString(),
      submitted_at: new Date(now - 60_000).toISOString(),
    })
    .select("id")
    .single();
  if (pendingError) throw pendingError;
  await signIn(page, STUDENT_EXAM_OPEN.username, STUDENT_EXAM_OPEN.password, /\/exam\/start$/);
  await expect(curriculumCard(page, EXAM_CURRICULUM_OPEN).getByTestId("calculating")).toBeVisible();
  await expectNoMarks(page);
  await review(page, info, "10-start-calculating", findings);
  await page.goto(`/results/${pending!.id}`);
  await expect(page.getByTestId("result-status")).toBeVisible();
  await expectNoMarks(page);
  await review(page, info, "10-result-calculating", findings);

  finish(info, findings);
});

test("staff screens: dashboard, attempts, evaluation, blocked, extra attempts, students, student detail, curriculums, curriculum, questions", async ({
  page,
}, info) => {
  const findings: Finding[] = [];
  const db = adminDb();

  // A passed attempt to look at: STUDENT_EXAM takes the exam (2 of 3, pass mark 60 %).
  await signIn(page, STUDENT_EXAM.username, STUDENT_EXAM.password, /\/exam\/start$/);
  const attemptId = await takeExam(page, EXAM_CURRICULUM, ["Nein", "Ja", "Nein"]);
  // A failed attempt that uses the only exam set: STUDENT_EXAM_OPEN has no exam set left (short list).
  await signIn(page, STUDENT_EXAM_OPEN.username, STUDENT_EXAM_OPEN.password, /\/exam\/start$/);
  await takeExam(page, EXAM_CURRICULUM_OPEN, ["Ja", "Ja", "Nein"]);

  // A blocked student for the Blocked and Extra attempts pages.
  const blockedId = await profileId(STUDENT_BLOCK.username);
  await db
    .from("assignments")
    .update({ status: "blocked" })
    .eq("student_id", blockedId)
    .eq("curriculum_id", await curriculumId(BLOCK_CURRICULUM));

  await signIn(page, STAFF.email, STAFF.password, /\/staff$/);
  await expect(page.getByTestId("recent-attempt-row").first()).toBeVisible();
  await review(page, info, "11-staff-dashboard", findings);
  await page.goto("/staff/review");
  await expect(page.getByTestId("results-table")).toBeVisible();
  await review(page, info, "12-staff-attempts", findings);
  await page.goto(`/staff/review/${attemptId}`);
  await expect(page.getByTestId("review-status")).toHaveText("Passed");
  await review(page, info, "13-staff-evaluation", findings);
  await page.goto("/staff/blocked");
  await review(page, info, "14-staff-blocked", findings);
  await page.goto("/staff/grants");
  await expect(page.getByTestId("grants-table")).toBeVisible();
  await expect(page.getByTestId("short-table")).toBeVisible();
  await review(page, info, "15-staff-extra-attempts", findings);
  await page
    .getByTestId("grants-table")
    .getByRole("row")
    .filter({ hasText: STUDENT_BLOCK.fullName })
    .getByRole("button", { name: /Give extra attempts/ })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await review(page, info, "15-staff-extra-attempts-dialog", findings);
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await page.goto("/staff/students");
  await review(page, info, "16-staff-students", findings);
  await page.goto(`/staff/students/${blockedId}`);
  await review(page, info, "17-staff-student-detail", findings);
  await page.getByRole("button", { name: "Delete student" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await review(page, info, "17-staff-delete-dialog", findings);
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await page.goto("/staff/curriculums");
  await review(page, info, "18-staff-curriculums", findings);
  // One exam set for 2 attempts per student: the curriculum page shows its warning.
  const cId = await curriculumId(EXAM_CURRICULUM_OPEN);
  await page.goto(`/staff/curriculums/${cId}`);
  await expect(page.getByRole("form", { name: "Curriculum settings" }).getByLabel("Attempts per student")).toHaveValue("2");
  await expect(page.getByTestId("curriculum-warning")).toBeVisible();
  await review(page, info, "19-staff-curriculum", findings);
  await page.getByTestId("exam-set-card").first().getByText("Edit settings").click();
  await expect(page.getByTestId("exam-set-card").first().getByTestId("exam-set-preview")).toBeVisible();
  await review(page, info, "19-staff-exam-set-settings", findings);
  const { data: set } = await db.from("exam_sets").select("id").eq("curriculum_id", cId).single();
  await page.goto(`/staff/questions?examSet=${set!.id}`);
  await review(page, info, "20-staff-questions", findings);

  finish(info, findings);
});
