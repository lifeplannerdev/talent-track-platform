import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  EXAM_CURRICULUM,
  EXAM_CURRICULUM_OPEN,
  EXAM_CURRICULUM_TWO,
  STAFF,
  STUDENT_BLOCK,
  STUDENT_CONSENTED,
  STUDENT_EXAM,
  STUDENT_EXAM_OPEN,
  STUDENT_NEW,
} from "./fixtures";
import { curriculumCard, expectNoHorizontalOverflow, signIn, startExam } from "./helpers";
import { adminDb, curriculumIdByName, removeBookFiles, seed, seedBook } from "./seed";

// Learning home (phase 2A). STUDENT_EXAM_OPEN has one curriculum with a 10-page book in two chapters
// (pages 1-5, 6-10). STUDENT_EXAM has two curriculums: one book with three chapters, the other still
// without a book. STUDENT_BLOCK has no book at all. STUDENT_CONSENTED is assigned nothing.

const SHOT_DIR = process.env.SHOT_DIR ?? path.join("docs", "design-review");
const HOME = /\/exam\/start$/;
const LEARN = /\/learn$/;

let openId: string;
let examId: string;
let twoId: string;
let openChapters: string[];

test.beforeAll(async () => {
  await seed();
  openId = await curriculumIdByName(EXAM_CURRICULUM_OPEN);
  examId = await curriculumIdByName(EXAM_CURRICULUM);
  twoId = await curriculumIdByName(EXAM_CURRICULUM_TWO);
  for (const id of [openId, examId, twoId]) await removeBookFiles(id);
  const open = await seedBook(openId, 10, {
    chapters: [
      { title: "Greetings", start: 1 },
      { title: "At the clinic", start: 6 },
    ],
  });
  openChapters = open.chapterIds;
  await seedBook(examId, 9, {
    chapters: [
      { title: "Numbers", start: 1 },
      { title: "Days and months", start: 4 },
      { title: "Family", start: 8 },
    ],
  });
});

test.afterAll(async () => {
  for (const id of [openId, examId, twoId]) await removeBookFiles(id);
});

const nodes = (page: Page) => page.getByTestId("chapter-node").filter({ visible: true });
const studentNav = (page: Page) => page.getByRole("navigation", { name: "Student" }).filter({ visible: true });

async function axeClean(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

test.describe("student without a book", () => {
  test("login lands on /exam/start through /learn, with no Learn link", async ({ page }) => {
    await signIn(page, STUDENT_BLOCK.username, STUDENT_BLOCK.password, HOME);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Learn", exact: true })).toHaveCount(0);
    await page.goto("/learn");
    await expect(page).toHaveURL(HOME);
  });

  test("an unassigned student sees no path and cannot read another curriculum's book", async ({ page }) => {
    await signIn(page, STUDENT_CONSENTED.username, STUDENT_CONSENTED.password, HOME);
    await page.goto("/learn");
    await expect(page).toHaveURL(HOME);
    await page.goto(`/learn/${openId}`);
    await expect(page).toHaveURL(HOME);
    await expect(page.locator("body")).not.toContainText("Greetings");
    await page.goto(`/learn/${openId}/read/${openChapters[0]}`);
    await expect(page.getByTestId("book-reader")).toHaveCount(0);
  });
});

test.describe("access", () => {
  test("a visitor goes to the sign-in page", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/learn");
    await expect(page).toHaveURL(/\/login$/);
    await page.goto(`/learn/${openId}`);
    await expect(page).toHaveURL(/\/login$/);
  });

  test("staff never reach the learning pages", async ({ page }) => {
    await signIn(page, STAFF.email, STAFF.password, /\/staff$/);
    await page.goto("/learn");
    await expect(page).toHaveURL(/\/staff$/);
    await page.goto(`/learn/${openId}`);
    await expect(page).toHaveURL(/\/staff$/);
  });

  test("a student who has not given consent goes to /consent", async ({ page }) => {
    await signIn(page, STUDENT_NEW.username, STUDENT_NEW.password, /\/consent$/);
    await page.goto("/learn");
    await expect(page).toHaveURL(/\/consent$/);
  });
});

test.describe("student with a book", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, STUDENT_EXAM_OPEN.username, STUDENT_EXAM_OPEN.password, LEARN);
  });

  // A running exam sends /learn to the start page, so no test may leave one behind for the next login.
  test.afterEach(async () => {
    const db = adminDb();
    const { data } = await db.from("profiles").select("id").eq("username", STUDENT_EXAM_OPEN.username).single();
    if (data) await db.from("attempts").delete().eq("student_id", data.id).eq("status", "in_progress");
  });

  test("login lands on the pathway: chapters in order, then the Main exam", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const section = page.getByRole("region", { name: EXAM_CURRICULUM_OPEN });
    await expect(section).toBeVisible();
    await expect(section).toContainText("2 chapters");
    await expect(section).toContainText("10 pages");
    const list = section.getByRole("list", { name: "Chapters" });
    await expect(list.getByTestId("chapter-node")).toHaveCount(2);
    await expect(nodes(page).nth(0)).toContainText("Greetings");
    await expect(nodes(page).nth(0)).toContainText("5 pages");
    await expect(nodes(page).nth(1)).toContainText("At the clinic");
    await expect(page.getByTestId("main-exam-node")).toContainText("Main exam");
    await expect(page.getByTestId("main-exam-node")).toContainText("Coming later");
    // Nothing to act on yet: no progress, no locks, no exam button.
    await expect(page.getByTestId("main-exam-node").getByRole("link")).toHaveCount(0);
    await expect(page.getByTestId("main-exam-node").getByRole("button")).toHaveCount(0);
    await expect(page.getByRole("progressbar")).toHaveCount(0);
  });

  test("the header shows Learn (current) and Exams; Exams opens the start page and an exam starts", async ({ page }) => {
    const nav = studentNav(page);
    await expect(nav.getByRole("link", { name: "Learn" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Exams" })).not.toHaveAttribute("aria-current", "page");
    await nav.getByRole("link", { name: "Exams" }).click();
    await expect(page).toHaveURL(HOME);
    await expect(studentNav(page).getByRole("link", { name: "Exams" })).toHaveAttribute("aria-current", "page");
    await expect(studentNav(page).getByRole("link", { name: "Learn" })).not.toHaveAttribute("aria-current", "page");
    await startExam(page, EXAM_CURRICULUM_OPEN);
    // The exam page keeps its own calm surface: no student navigation there.
    await expect(page.getByRole("navigation", { name: "Student" })).toHaveCount(0);
  });

  test("a student with an exam in progress is sent from /learn to the start page, where Resume is", async ({ page }) => {
    await studentNav(page).getByRole("link", { name: "Exams" }).click();
    await expect(page).toHaveURL(HOME);
    await startExam(page, EXAM_CURRICULUM_OPEN);
    await page.goto("/learn");
    await expect(page).toHaveURL(HOME);
    await expect(curriculumCard(page, EXAM_CURRICULUM_OPEN).getByTestId("resume-exam")).toBeVisible();
    // The chapter list itself stays reachable and readable (only the plain /learn page redirects).
    await page.goto(`/learn/${openId}`);
    await expect(page).toHaveURL(new RegExp(`/learn/${openId}$`));
  });

  test("a chapter's Read link opens the reader at that chapter, and Close comes back", async ({ page }) => {
    await page.getByRole("link", { name: /^Read chapter 2: At the clinic/ }).click();
    await expect(page).toHaveURL(new RegExp(`/learn/${openId}/read/${openChapters[1]}$`));
    await expect(page.getByRole("dialog", { name: /At the clinic/ })).toBeVisible();
    await expect(page.getByTestId("reader-counter")).toHaveText(/\/ 5$/);
    await page.getByRole("button", { name: "Close reader" }).click();
    await expect(page).toHaveURL(new RegExp(`/learn/${openId}$`));
    await expect(page.getByRole("region", { name: EXAM_CURRICULUM_OPEN })).toBeVisible();
    await expect(nodes(page)).toHaveCount(2);
  });

  test("the first chapter's link opens its first page", async ({ page }) => {
    await page.getByRole("link", { name: /^Read chapter 1: Greetings/ }).click();
    await expect(page).toHaveURL(new RegExp(`/learn/${openId}/read/${openChapters[0]}$`));
    await expect(page.getByRole("dialog", { name: /Greetings/ })).toBeVisible();
  });

  test("passes axe and never scrolls sideways", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await expect(nodes(page)).toHaveCount(2);
    await expectNoHorizontalOverflow(page);
    await axeClean(page);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(SHOT_DIR, `24-learn-pathway-${test.info().project.name}.png`), fullPage: true });
  });

  test("reduced motion shows everything at once", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    const opacities = await page.getByTestId("chapter-node").evaluateAll((els) => els.map((e) => getComputedStyle(e.closest(".reveal") ?? e).opacity));
    expect(opacities.length).toBeGreaterThan(0);
    for (const o of opacities) expect(o).toBe("1");
  });

  test("the pathway is in the server-rendered markup, so it does not depend on scripts", async ({ page, browser, baseURL }) => {
    // Without JS the streamed segment stays inside React's hidden holder (a platform trait shared by
    // every student page), so this checks the markup; the reveal CSS only hides under scripting: enabled.
    const context = await browser.newContext({
      javaScriptEnabled: false,
      baseURL,
      storageState: await page.context().storageState(),
    });
    const bare = await context.newPage();
    await bare.goto("/learn");
    await expect(bare.getByTestId("chapter-node")).toHaveCount(2);
    await expect(bare.locator("a[href*='/read/']")).toHaveCount(2);
    await context.close();
  });
});

test.describe("student with two curriculums", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, STUDENT_EXAM.username, STUDENT_EXAM.password, LEARN);
  });

  test("only a curriculum with a published book and chapters has a pathway", async ({ page }) => {
    await expect(page.getByRole("region", { name: EXAM_CURRICULUM, exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: EXAM_CURRICULUM_TWO })).toHaveCount(0);
    await expect(nodes(page)).toHaveCount(3);
    await expect(page.getByTestId("main-exam-node")).toHaveCount(1);
  });

  test("a curriculum link shows that pathway alone; one that has no path goes back to /learn", async ({ page }) => {
    await page.goto(`/learn/${examId}`);
    await expect(page).toHaveURL(new RegExp(`/learn/${examId}$`));
    await expect(page.getByRole("region", { name: EXAM_CURRICULUM, exact: true })).toBeVisible();
    await page.goto(`/learn/${twoId}`);
    await expect(page).toHaveURL(LEARN);
    await page.goto("/learn/not-a-curriculum");
    await expect(page).toHaveURL(LEARN);
  });

  test("axe, no sideways scroll, screenshot", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await expect(nodes(page)).toHaveCount(3);
    await expectNoHorizontalOverflow(page);
    await axeClean(page);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(SHOT_DIR, `24-learn-three-chapters-${test.info().project.name}.png`), fullPage: true });
  });
});
