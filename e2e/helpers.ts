import { expect, type Locator, type Page } from "@playwright/test";
import { adminDb } from "./seed";

/** The page itself never scrolls sideways (wide tables scroll inside their own frame). */
export async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, "page scrolls horizontally").toBeLessThanOrEqual(clientWidth);
}

/** Signs out (cookies), signs in and waits for the home page of the account. */
export async function signIn(page: Page, username: string, password: string, home: RegExp) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Username or email").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(home);
}

export async function staffNav(page: Page, name: string) {
  await page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name, exact: true }).click();
}

/**
 * The student's start card of one curriculum (visible only: Next keeps visited routes in the DOM,
 * hidden).
 */
export function curriculumCard(page: Page, curriculum: string): Locator {
  return page
    .getByTestId("curriculum-card")
    .filter({ visible: true })
    .filter({ has: page.getByRole("heading", { name: curriculum, exact: true }) });
}

/** Clicks Start exam on the curriculum's card and waits for the exam page. Returns the attempt id. */
export async function startExam(page: Page, curriculum: string): Promise<string> {
  await curriculumCard(page, curriculum).getByRole("button", { name: "Start exam" }).click();
  await expect(page).toHaveURL(/\/exam\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop()!;
}

export async function choose(page: Page, option: string) {
  await page.getByRole("radio", { name: option, exact: true }).click();
  await expect(page.getByTestId("save-status")).toHaveText(/Saved/);
}

/** Answers the running exam in paper order (one pick per question). */
export async function answerAll(page: Page, picks: string[]) {
  for (let i = 0; i < picks.length; i++) {
    await expect(page.getByRole("heading", { name: `Question ${i + 1} of ${picks.length}` })).toBeVisible();
    await choose(page, picks[i]);
    if (i < picks.length - 1) await page.getByRole("button", { name: "Next", exact: true }).click();
  }
}

/** Starts the curriculum's exam, answers it, submits and waits for the result page. Returns the attempt id. */
export async function takeExam(
  page: Page,
  curriculum: string,
  picks: string[],
  opts: { beforeSubmit?: () => void; onExamPage?: () => Promise<void> } = {},
): Promise<string> {
  const attemptId = await startExam(page, curriculum);
  await opts.onExamPage?.();
  await answerAll(page, picks);
  await page.getByRole("button", { name: "Review and submit" }).click();
  opts.beforeSubmit?.();
  await page.getByRole("dialog").getByRole("button", { name: "Submit exam" }).click();
  await expect(page).toHaveURL(new RegExp(`/results/${attemptId}$`));
  return attemptId;
}

export async function profileId(username: string): Promise<string> {
  const { data, error } = await adminDb().from("profiles").select("id").eq("username", username).single();
  if (error) throw error;
  return data.id as string;
}

export async function curriculumId(name: string): Promise<string> {
  const { data, error } = await adminDb().from("curriculums").select("id").eq("name", name).single();
  if (error) throw error;
  return data.id as string;
}

/** The stored assignment row (status, extra attempts, repeats). */
export async function assignment(username: string, curriculum: string) {
  const { data, error } = await adminDb()
    .from("assignments")
    .select("status, extra_attempts, allow_repeats")
    .eq("student_id", await profileId(username))
    .eq("curriculum_id", await curriculumId(curriculum))
    .single();
  if (error) throw error;
  return data as { status: string; extra_attempts: number; allow_repeats: boolean };
}

/** The stored attempt (status, score, exam set). */
export async function attemptRow(attemptId: string) {
  const { data, error } = await adminDb()
    .from("attempts")
    .select("status, points, max_points, passed, released_at, exam_set_id, exam_sets(name)")
    .eq("id", attemptId)
    .single();
  if (error) throw error;
  return data as unknown as {
    status: string;
    points: number | null;
    max_points: number | null;
    passed: boolean | null;
    released_at: string | null;
    exam_set_id: string;
    exam_sets: { name: string };
  };
}
