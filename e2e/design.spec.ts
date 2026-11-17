import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { STAFF, STUDENT_BLOCK, STUDENT_CONSENTED, STUDENT_EXAM, STUDENT_EXAM_OPEN, STUDENT_NEW } from "./fixtures";
import { expectNoHorizontalOverflow } from "./helpers";
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

async function signIn(page: Page, username: string, password: string, home: RegExp) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Username or email").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(home);
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

async function answerAll(page: Page, picks: string[]) {
  for (let i = 0; i < picks.length; i++) {
    await expect(page.getByRole("heading", { name: `Question ${i + 1} of ${picks.length}` })).toBeVisible();
    await page.getByRole("radio", { name: picks[i], exact: true }).click();
    await expect(page.getByTestId("save-status")).toHaveText(/Saved/);
    if (i < picks.length - 1) await page.getByRole("button", { name: "Next", exact: true }).click();
  }
}

test("student screens: login, consent, empty start, exam start, exam, submit dialog, awaiting review, released report and print", async ({
  page,
}, info) => {
  const findings: Finding[] = [];

  await page.goto("/login");
  await review(page, info, "01-login", findings);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("#login-error")).toBeVisible();
  await review(page, info, "01-login-error", findings);

  await signIn(page, STUDENT_NEW.username, STUDENT_NEW.password, /\/consent$/);
  await review(page, info, "02-consent", findings);

  await signIn(page, STUDENT_CONSENTED.username, STUDENT_CONSENTED.password, /\/exam\/start$/);
  await review(page, info, "03-start-empty", findings);

  await signIn(page, STUDENT_EXAM.username, STUDENT_EXAM.password, /\/exam\/start$/);
  await review(page, info, "04-start-ready", findings);
  await page.getByRole("button", { name: "Start exam" }).click();
  await expect(page).toHaveURL(/\/exam\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("timer")).toHaveText(/^\d\d:\d\d$/);
  await review(page, info, "05-exam-question", findings);
  await answerAll(page, ["Nein", "Ja", "Nein"]);
  await review(page, info, "05-exam-last-question", findings);
  await page.getByRole("button", { name: "Review and submit" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await review(page, info, "06-exam-submit-dialog", findings);
  await page.getByRole("dialog").getByRole("button", { name: "Submit exam" }).click();
  await expect(page).toHaveURL(/\/results\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("result-status")).toBeVisible();
  await review(page, info, "07-result-awaiting", findings);

  await signIn(page, STUDENT_EXAM_OPEN.username, STUDENT_EXAM_OPEN.password, /\/exam\/start$/);
  await page.getByRole("button", { name: "Start exam" }).click();
  await answerAll(page, ["Nein", "Nein", "Ja"]);
  await page.getByRole("button", { name: "Review and submit" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Submit exam" }).click();
  await expect(page.getByTestId("result-report")).toBeVisible();
  await review(page, info, "08-result-report", findings);
  await page.emulateMedia({ media: "print" });
  await page.screenshot({ path: path.join(SHOT_DIR, `08-result-print-${info.project.name}.png`), fullPage: true });
  await page.emulateMedia({ media: "screen" });
  // Back on the exam page: the result stays reachable from "Your results".
  await page.goto("/exam/start");
  await expect(page.getByTestId("results-list")).toBeVisible();
  await review(page, info, "09-exam-start-results", findings);

  finish(info, findings);
});

test("staff screens: dashboard, review, evaluation, blocked, grants, students, student detail, curriculums, curriculum, questions", async ({
  page,
}, info) => {
  const findings: Finding[] = [];
  const db = adminDb();

  // A held submitted attempt to review: STUDENT_EXAM takes the exam.
  await signIn(page, STUDENT_EXAM.username, STUDENT_EXAM.password, /\/exam\/start$/);
  await page.getByRole("button", { name: "Start exam" }).click();
  await answerAll(page, ["Nein", "Ja", "Nein"]);
  await page.getByRole("button", { name: "Review and submit" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Submit exam" }).click();
  await expect(page).toHaveURL(/\/results\/[0-9a-f-]{36}$/);
  const attemptId = page.url().split("/").pop()!;

  // A blocked student for the Blocked page.
  const { data: blocked } = await db.from("profiles").select("id").eq("username", STUDENT_BLOCK.username).single();
  await db.from("assignments").update({ status: "blocked" }).eq("student_id", blocked!.id);

  await signIn(page, STAFF.email, STAFF.password, /\/staff$/);
  await review(page, info, "10-staff-dashboard", findings);
  await page.goto("/staff/review");
  await review(page, info, "11-staff-review", findings);
  await page.goto("/staff/results");
  await expect(page.getByTestId("results-table")).toBeVisible();
  await review(page, info, "11-staff-results", findings);
  await page.goto(`/staff/review/${attemptId}`);
  await review(page, info, "12-staff-evaluation", findings);
  await page.getByRole("button", { name: "Release result" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await review(page, info, "12-staff-release-dialog", findings);
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await page.goto("/staff/blocked");
  await review(page, info, "13-staff-blocked", findings);
  await page.goto("/staff/grants");
  await review(page, info, "14-staff-grants", findings);
  await page.goto("/staff/students");
  await review(page, info, "15-staff-students", findings);
  await page.goto(`/staff/students/${blocked!.id}`);
  await review(page, info, "16-staff-student-detail", findings);
  await page.getByRole("button", { name: "Delete student" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await review(page, info, "16-staff-delete-dialog", findings);
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await page.goto("/staff/curriculums");
  await review(page, info, "17-staff-curriculums", findings);
  const { data: c } = await db.from("curriculums").select("id").eq("name", "E2E Exam Curriculum Held").single();
  await page.goto(`/staff/curriculums/${c!.id}`);
  await review(page, info, "18-staff-curriculum", findings);
  const { data: set } = await db.from("exam_sets").select("id").eq("curriculum_id", c!.id).single();
  await page.goto(`/staff/questions?examSet=${set!.id}`);
  await review(page, info, "19-staff-questions", findings);

  finish(info, findings);
});
