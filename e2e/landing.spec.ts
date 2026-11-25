import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { STAFF, STUDENT_CONSENTED, STUDENT_NEW } from "./fixtures";
import { expectNoHorizontalOverflow, signIn } from "./helpers";
import { seed } from "./seed";

test.beforeEach(async () => {
  await seed();
});

test("the landing page is public, has one h1 and the brand words", async ({ page }) => {
  await page.context().clearCookies();
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Talent\s+Track\s+Platform/);
  await expect(page).toHaveTitle(/Talent Track Platform/);
  const main = page.getByRole("main");
  await expect(main.getByText("Powered by F.L.A.G.").first()).toBeVisible();
  await expect(page.getByRole("contentinfo")).toContainText("Foreign Languages Academy Gurukulam");
  await expect(page.getByText("Powered by F.L.A.G.").first()).toBeVisible();
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /Talent Track Platform/);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /.+/);
  for (const landmark of ["banner", "main", "contentinfo"] as const) {
    await expect(page.getByRole(landmark)).toHaveCount(1);
  }
  // No old brand text anywhere on the page.
  expect(await page.locator("body").innerText()).not.toMatch(/KVP|Knowledge Validation|TalentTrack|Life Planner/i);
});

test("the sample score is in the page text, and the call to action goes to sign in", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/");
  await expect(page.locator("body")).toContainText("92%");
  await page.getByRole("main").getByRole("link", { name: "Sign in" }).first().click();
  await expect(page).toHaveURL(/\/login$/);
});

test("skip link jumps to the main content of the landing page", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/");
  await expect(page.locator("#main-content")).toHaveCount(1);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("main-content");
});

test("signed-in users visiting the landing page go to their own area", async ({ page }) => {
  await signIn(page, STUDENT_CONSENTED.username, STUDENT_CONSENTED.password, /\/exam\/start$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/exam\/start$/);

  await signIn(page, STAFF.email, STAFF.password, /\/staff$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/staff$/);

  await signIn(page, STUDENT_NEW.username, STUDENT_NEW.password, /\/consent$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/consent$/);
});

test("the landing page never scrolls sideways at any common width", async ({ page }) => {
  await page.context().clearCookies();
  for (const width of [320, 375, 768, 1024, 1280, 1536]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("everything is visible at once and axe finds nothing serious", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    // Reveal never hides content when motion is reduced.
    for (const heading of await page.getByRole("heading", { level: 2 }).all()) {
      await expect(heading).toHaveCSS("opacity", "1");
    }
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the content is readable and the final score is in the text", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "How it works" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "How it works" })).toHaveCSS("opacity", "1");
    await expect(page.locator("body")).toContainText("92%");
  });
});

test("with motion on, sections reveal as they scroll into view, once", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/");
  const trust = page.locator("#trust-title");
  await trust.scrollIntoViewIfNeeded();
  await expect(trust.locator("xpath=ancestor::*[contains(@class,'reveal')][1]")).toHaveAttribute("data-in", "");
  await expect(trust).toHaveCSS("opacity", "1");
});
