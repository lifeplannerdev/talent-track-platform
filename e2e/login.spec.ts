import { expect, test, type Page } from "@playwright/test";
import { NEXT_CURRICULUM, STAFF, STUDENT_CONSENTED, STUDENT_NEW } from "./fixtures";
import { adminDb, seed } from "./seed";

test.beforeEach(async () => {
  await seed();
});

async function signIn(page: Page, identifier: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Username or email").fill(identifier);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("unauthenticated visitors are sent to login", async ({ page }) => {
  await page.goto("/staff");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/exam/start");
  await expect(page).toHaveURL(/\/login$/);
});

test("wrong password shows an error and stays on login", async ({ page }) => {
  await signIn(page, STUDENT_NEW.username, "not-the-password");
  await expect(page.locator("#login-error")).toContainText("Incorrect username or password");
  await expect(page).toHaveURL(/\/login$/);
});

test("student accepts consent and lands on the next open exam", async ({ page }) => {
  await signIn(page, STUDENT_NEW.username, STUDENT_NEW.password);
  await expect(page).toHaveURL(/\/consent$/);

  // Consent gate: nothing else is reachable until it is accepted.
  await page.goto("/exam/start");
  await expect(page).toHaveURL(/\/consent$/);

  await page.getByRole("button", { name: "I agree and continue" }).click();
  await expect(page).toHaveURL(/\/exam\/start$/);
  // Consent timestamp is persisted in the database.
  const { data: profile } = await adminDb()
    .from("profiles")
    .select("consent_at")
    .eq("username", STUDENT_NEW.username)
    .single();
  expect(profile?.consent_at).not.toBeNull();
  expect(Math.abs(Date.now() - new Date(profile!.consent_at!).getTime())).toBeLessThan(60_000);
  // Lowest position with status open: B (position 2), not the passed A or the later C.
  await expect(page.getByTestId("next-exam")).toContainText(NEXT_CURRICULUM);

  // Consent is only asked once.
  await page.goto("/consent");
  await expect(page).toHaveURL(/\/exam\/start$/);
});

test("a student who has not consented can sign out from the consent page", async ({ page }) => {
  await signIn(page, STUDENT_NEW.username, STUDENT_NEW.password);
  await expect(page).toHaveURL(/\/consent$/);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/consent");
  await expect(page).toHaveURL(/\/login$/);
});

test("consented student skips consent and sees the empty state without assignments", async ({ page }) => {
  await signIn(page, STUDENT_CONSENTED.username, STUDENT_CONSENTED.password);
  await expect(page).toHaveURL(/\/exam\/start$/);
  await expect(page.getByTestId("no-exams")).toContainText("No exams are assigned");
});

test("a student visiting /staff is redirected to their own area", async ({ page }) => {
  await signIn(page, STUDENT_CONSENTED.username, STUDENT_CONSENTED.password);
  await expect(page).toHaveURL(/\/exam\/start$/);
  await page.goto("/staff");
  await expect(page).toHaveURL(/\/exam\/start$/);
});

test("staff sign in with email and cannot open student areas", async ({ page }) => {
  await signIn(page, STAFF.email, STAFF.password);
  await expect(page).toHaveURL(/\/staff$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.goto("/exam/start");
  await expect(page).toHaveURL(/\/staff$/);
});

test("a second login ends the first session", async ({ browser }) => {
  const baseURL = test.info().project.use.baseURL!;
  const first = await browser.newContext({ baseURL });
  const second = await browser.newContext({ baseURL });
  const page1 = await first.newPage();
  const page2 = await second.newPage();
  await signIn(page1, STUDENT_CONSENTED.username, STUDENT_CONSENTED.password);
  await expect(page1).toHaveURL(/\/exam\/start$/);

  await signIn(page2, STUDENT_CONSENTED.username, STUDENT_CONSENTED.password);
  await expect(page2).toHaveURL(/\/exam\/start$/);

  await page1.goto("/exam/start");
  await expect(page1).toHaveURL(/\/login$/);
  await page2.goto("/exam/start");
  await expect(page2).toHaveURL(/\/exam\/start$/);
  await first.close();
  await second.close();
});

test("proxy matcher: look-alike paths are gated, real static assets bypass it", async ({ request, page }) => {
  // Not a file extension (no dot): must hit the proxy and go to login.
  await page.goto("/staff/exportpng");
  await expect(page).toHaveURL(/\/login$/);

  // A real static asset is served without being redirected to login.
  const asset = await request.get("/next.svg", { maxRedirects: 0 });
  expect(asset.status()).toBe(200);
});
