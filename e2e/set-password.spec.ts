import { expect, test, type Page } from "@playwright/test";
import { STUDENT_CONSENTED } from "./fixtures";
import { inviteLinkFor, seed } from "./seed";

test.beforeEach(async () => {
  await seed();
});

const INVALID = "This link is no longer valid. Ask your trainer to send you a new invite.";

async function trySignIn(page: Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Username or email").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function submit(page: Page, password: string, repeat = password) {
  await page.getByLabel("New password").fill(password);
  await page.getByLabel("Repeat the password").fill(repeat);
  await page.getByRole("button", { name: "Save password" }).click();
}

test("opening the link (even twice) does not use it up; a weak password is refused; a good one works", async ({ page }) => {
  const link = await inviteLinkFor(STUDENT_CONSENTED.username);
  // Two plain GETs, like a mail scanner and then the student.
  const first = await page.request.get(link);
  expect(first.ok()).toBe(true);
  await page.goto(link);
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Choose your password" })).toBeVisible();

  await submit(page, "short");
  await expect(page.locator("#set-password-error")).toContainText("at least 8 characters");

  await submit(page, "a-fresh-pass-1", "a-different-pass");
  await expect(page.locator("#set-password-error")).toContainText("not the same");

  await submit(page, "a-fresh-pass-1");
  await expect(page).toHaveURL(/\/login$/);

  await trySignIn(page, STUDENT_CONSENTED.username, STUDENT_CONSENTED.password);
  await expect(page.locator("#login-error")).toContainText("Incorrect username or password");
  await trySignIn(page, STUDENT_CONSENTED.username, "a-fresh-pass-1");
  await expect(page).toHaveURL(/\/exam\/start$/);
});

test("a used link shows the safe expired message", async ({ page }) => {
  const link = await inviteLinkFor(STUDENT_CONSENTED.username);
  await page.goto(link);
  await submit(page, "a-fresh-pass-1");
  await expect(page).toHaveURL(/\/login$/);

  await page.goto(link);
  await submit(page, "another-pass-2");
  await expect(page.locator("#set-password-error")).toHaveText(INVALID);
  await trySignIn(page, STUDENT_CONSENTED.username, "another-pass-2");
  await expect(page.locator("#login-error")).toBeVisible();
});

test("a garbage or missing token shows the same message", async ({ page }) => {
  await page.goto("/set-password?token_hash=not-a-real-token");
  await submit(page, "a-fresh-pass-1");
  await expect(page.locator("#set-password-error")).toHaveText(INVALID);

  await page.goto("/set-password");
  await expect(page.getByTestId("set-password-invalid")).toContainText(INVALID);
  await expect(page.getByLabel("New password")).toHaveCount(0);
});
