import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  EXAM_CURRICULUM,
  EXAM_CURRICULUM_OPEN,
  STAFF,
  STUDENT_CONSENTED,
  STUDENT_EXAM,
  STUDENT_EXAM_OPEN,
} from "./fixtures";
import { expectNoHorizontalOverflow, signIn } from "./helpers";
import { curriculumIdByName, removeBookFiles, seed, seedBook } from "./seed";

// Full-screen book reader (phase 2A). A 10-page book in two chapters (pages 1-5, 6-10) for
// STUDENT_EXAM_OPEN, a mixed portrait/landscape book for STUDENT_EXAM, and STUDENT_CONSENTED is not
// assigned to either. The learning home (Task 8) does not exist yet, so closing is checked by URL only.

const SHOT_DIR = process.env.SHOT_DIR ?? path.join("docs", "design-review");
const STUDENT_HOME = /\/exam\/start$/;

let openId: string;
let mixedId: string;
let chapterTwo: string;
let mixedChapter: string;

test.beforeAll(async () => {
  await seed();
  openId = await curriculumIdByName(EXAM_CURRICULUM_OPEN);
  mixedId = await curriculumIdByName(EXAM_CURRICULUM);
  await removeBookFiles(openId);
  await removeBookFiles(mixedId);
  const two = await seedBook(openId, 10, {
    chapters: [
      { title: "Greetings", start: 1 },
      { title: "At the clinic", start: 6 },
    ],
  });
  chapterTwo = two.chapterIds[1];
  const mixed = await seedBook(mixedId, 4, {
    chapters: [{ title: "Mixed pages", start: 1 }],
    size: (n) => (n % 2 ? { width: 600, height: 800 } : { width: 800, height: 600 }),
  });
  mixedChapter = mixed.chapterIds[0];
});

test.afterAll(async () => {
  await removeBookFiles(openId);
  await removeBookFiles(mixedId);
});

const readerUrl = (curriculum: string, chapter: string) => `/learn/${curriculum}/read/${chapter}`;

async function openReader(page: Page, url = readerUrl(openId, chapterTwo)) {
  await page.goto(url);
  await expect(page.getByTestId("book-reader")).toBeVisible();
  // The first page image has loaded (the skeleton is gone).
  await expect(page.getByTestId("reader-skeleton")).toHaveCount(0);
}

const counter = (page: Page) => page.getByTestId("reader-counter");
const isNarrow = (page: Page) => (page.viewportSize()?.width ?? 1280) < 900;

test.describe("student reader", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, STUDENT_EXAM_OPEN.username, STUDENT_EXAM_OPEN.password, STUDENT_HOME);
  });

  test("shows only the chapter's pages, counted inside the chapter", async ({ page }) => {
    await openReader(page);
    await expect(page.getByRole("dialog", { name: /At the clinic/ })).toBeVisible();
    await expect(counter(page)).toHaveText(isNarrow(page) ? "1 / 5" : "1\u20132 / 5");
    await expect(page.locator("img[data-page]")).toHaveCount(5);
    await expect(page.getByTestId("reader-page-1")).toBeAttached();
    await expect(page.getByTestId("reader-page-6")).toHaveCount(0);
  });

  test("arrow keys, Home and End move through the chapter", async ({ page }) => {
    await openReader(page);
    const narrow = isNarrow(page);
    await page.keyboard.press("ArrowRight");
    await expect(counter(page)).toHaveText(narrow ? "2 / 5" : "3\u20134 / 5");
    await page.keyboard.press("ArrowLeft");
    await expect(counter(page)).toHaveText(narrow ? "1 / 5" : "1\u20132 / 5");
    await page.keyboard.press("End");
    await expect(counter(page)).toHaveText("5 / 5");
    await page.keyboard.press("Home");
    await expect(counter(page)).toHaveText(narrow ? "1 / 5" : "1\u20132 / 5");
  });

  test("the buttons turn pages and disable at the ends", async ({ page }) => {
    await openReader(page);
    await expect(page.getByRole("button", { name: "Previous page" })).toBeDisabled();
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(counter(page)).toHaveText(isNarrow(page) ? "2 / 5" : "3\u20134 / 5");
    await page.keyboard.press("End");
    await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  test("a thumbnail jumps to its page", async ({ page }) => {
    await openReader(page);
    await page.getByRole("button", { name: "Show page strip" }).click();
    await page.getByRole("button", { name: "Go to page 5" }).click();
    await expect(counter(page)).toHaveText("5 / 5");
    // The strip closes after a jump; reopened, it marks the page.
    await expect(page.getByTestId("reader-thumbs")).toHaveCount(0);
    await page.getByRole("button", { name: "Show page strip" }).click();
    await expect(page.getByRole("button", { name: "Go to page 5" })).toHaveAttribute("aria-current", "page");
  });

  test("Escape and Close go back to the learning path", async ({ page }) => {
    await openReader(page);
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(new RegExp(`/learn/${openId}$`));
    await page.goto(readerUrl(openId, chapterTwo));
    await page.getByRole("button", { name: "Close reader" }).click();
    await expect(page).toHaveURL(new RegExp(`/learn/${openId}$`));
  });

  test("single page on a phone, spread on a wide screen, nothing scrolls sideways", async ({ page }) => {
    await openReader(page);
    await expect(page.getByTestId("book-reader")).toHaveAttribute("data-mode", isNarrow(page) ? "single" : "spread");
    await expectNoHorizontalOverflow(page);
  });

  test("the current page survives a change between spread and single", async ({ page }) => {
    test.skip(isNarrow(page), "needs the wide project to start as a spread");
    await openReader(page);
    await page.keyboard.press("ArrowRight"); // spread 3-4
    await expect(counter(page)).toHaveText("3\u20134 / 5");
    await page.setViewportSize({ width: 600, height: 900 });
    await expect(page.getByTestId("book-reader")).toHaveAttribute("data-mode", "single");
    await expect(counter(page)).toHaveText("3 / 5");
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByTestId("book-reader")).toHaveAttribute("data-mode", "spread");
    await expect(counter(page)).toHaveText("3\u20134 / 5");
  });

  test("mixed portrait and landscape pages show whole inside the page", async ({ page }) => {
    await signIn(page, STUDENT_EXAM.username, STUDENT_EXAM.password, STUDENT_HOME);
    await openReader(page, readerUrl(mixedId, mixedChapter));
    const checks = await page.getByTestId("book-reader").evaluate(async (root) => {
      const imgs = [...root.querySelectorAll<HTMLImageElement>("img[data-page]")];
      await Promise.all(imgs.map((i) => i.decode().catch(() => undefined)));
      const frame = root.getBoundingClientRect();
      return imgs
        .filter((i) => i.complete && i.naturalWidth > 0)
        .map((i) => {
          const r = i.getBoundingClientRect();
          return {
            fit: getComputedStyle(i).objectFit,
            natural: i.naturalWidth / i.naturalHeight,
            inside: r.left >= frame.left - 1 && r.right <= frame.right + 1 && r.top >= frame.top - 1 && r.bottom <= frame.bottom + 1,
          };
        });
    });
    expect(checks.length).toBeGreaterThan(0);
    for (const c of checks) {
      expect(c.fit).toBe("contain");
      expect(c.inside).toBe(true);
    }
    // Both orientations were drawn from their own size (portrait 0.75, landscape 1.33).
    expect(checks.some((c) => c.natural < 1)).toBe(true);
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("reader-skeleton")).toHaveCount(0);
    await page.screenshot({ path: path.join(SHOT_DIR, `23-reader-mixed-${test.info().project.name}.png`) });
  });

  test("passes axe and keeps every control at 44 px on touch", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openReader(page);
    await page.getByRole("button", { name: "Show page strip" }).click();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
    if (isNarrow(page)) {
      for (const b of await page.getByTestId("book-reader").getByRole("button").all()) {
        if (!(await b.isVisible())) continue;
        const box = await b.boundingBox();
        expect(box!.height, await b.innerText()).toBeGreaterThanOrEqual(43.5);
        expect(box!.width).toBeGreaterThanOrEqual(43.5);
      }
    }
  });

  test("an expired page link is fetched again once, keeping the page", async ({ page }) => {
    let failed = false;
    await page.route(/\/storage\/v1\/object\/sign\/book-pages\/.*\/6\.webp/, async (route) => {
      if (!failed) {
        failed = true;
        await route.abort();
        return;
      }
      await route.continue();
    });
    await page.goto(readerUrl(openId, chapterTwo));
    await expect(page.getByTestId("book-reader")).toBeVisible();
    await expect(page.getByTestId("reader-skeleton")).toHaveCount(0);
    expect(failed).toBe(true);
    const first = page.getByTestId("reader-page-1");
    await expect.poll(() => first.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    await expect(counter(page)).toHaveText(isNarrow(page) ? "1 / 5" : "1\u20132 / 5");
  });

  test("screenshots", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openReader(page);
    await page.keyboard.press("ArrowRight");
    await page.mouse.move(10, 10);
    await page.screenshot({ path: path.join(SHOT_DIR, `23-reader-${test.info().project.name}.png`) });
    await page.getByRole("button", { name: "Show page strip" }).click();
    await page.screenshot({ path: path.join(SHOT_DIR, `23-reader-strip-${test.info().project.name}.png`) });
  });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("pages change in one frame and no animation runs", async ({ page }) => {
    await signIn(page, STUDENT_EXAM_OPEN.username, STUDENT_EXAM_OPEN.password, STUDENT_HOME);
    await openReader(page);
    const narrow = isNarrow(page);
    await page.keyboard.press("ArrowRight");
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    expect(await counter(page).textContent()).toBe(narrow ? "2 / 5" : "3\u20134 / 5");
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
    expect(running).toBe(0);
    const chrome = await page.getByTestId("reader-bar").evaluate((el) => getComputedStyle(el).opacity);
    expect(chrome).toBe("1");
  });
});

test.describe("access", () => {
  test("a student without the curriculum gets the not-found page and no page data", async ({ page }) => {
    await signIn(page, STUDENT_CONSENTED.username, STUDENT_CONSENTED.password, STUDENT_HOME);
    await page.goto(readerUrl(openId, chapterTwo));
    await expect(page.getByRole("heading", { name: "This page could not be found" })).toBeVisible();
    await expect(page.getByTestId("book-reader")).toHaveCount(0);
    const html = await page.content();
    expect(html).not.toContain("book-pages");
    expect(html).not.toContain("At the clinic");
  });

  test("staff are sent to the staff area and a visitor to sign in", async ({ page }) => {
    await signIn(page, STAFF.email, STAFF.password, /\/staff$/);
    await page.goto(readerUrl(openId, chapterTwo));
    await expect(page).toHaveURL(/\/staff$/);
    await page.context().clearCookies();
    await page.goto(readerUrl(openId, chapterTwo));
    await expect(page).toHaveURL(/\/login$/);
  });
});
