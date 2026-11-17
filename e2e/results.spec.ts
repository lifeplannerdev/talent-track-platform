import { expect, test, type Page } from "@playwright/test";
import { EXAM_CURRICULUM_HELD, STAFF, STUDENT_EXAM, STUDENT_EXAM_OPEN } from "./fixtures";
import { adminDb, seed } from "./seed";

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

async function choose(page: Page, option: string) {
  await page.getByRole("radio", { name: option, exact: true }).click();
  await expect(page.getByTestId("save-status")).toHaveText(/Saved/);
}

/** Takes the student's exam answering in paper order and submits. Every question's key is "Nein". */
async function takeExam(page: Page, picks: string[], beforeSubmit?: () => void): Promise<string> {
  await page.getByRole("button", { name: "Start exam" }).click();
  await expect(page).toHaveURL(/\/exam\/[0-9a-f-]{36}$/);
  for (let i = 0; i < picks.length; i++) {
    await expect(page.getByRole("heading", { name: `Question ${i + 1} of ${picks.length}` })).toBeVisible();
    await choose(page, picks[i]);
    if (i < picks.length - 1) await page.getByRole("button", { name: "Next", exact: true }).click();
  }
  await page.getByRole("button", { name: "Review and submit" }).click();
  beforeSubmit?.();
  await page.getByRole("dialog").getByRole("button", { name: "Submit exam" }).click();
  await expect(page).toHaveURL(/\/results\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop()!;
}

async function assignmentStatus(username: string, curriculumName: string) {
  const db = adminDb();
  const { data: p } = await db.from("profiles").select("id").eq("username", username).single();
  const { data: c } = await db.from("curriculums").select("id").eq("name", curriculumName).single();
  const { data } = await db.from("assignments").select("status").eq("student_id", p!.id).eq("curriculum_id", c!.id).single();
  return data!.status as string;
}

test("held result: no marks before release, staff checks the bilingual evaluation and releases, the student then sees and prints the report", async ({
  page,
}) => {
  // Network level: from the submit click on, nothing served to the student (documents and
  // fetches, including the submit server action POST that redirects to the result page and
  // the result page's RSC payloads) may carry marks or the key before release.
  let capturing = false;
  const bodies: Promise<{ url: string; method: string; body: string }>[] = [];
  page.on("response", (res) => {
    if (!capturing || !["document", "fetch", "xhr"].includes(res.request().resourceType())) return;
    const method = res.request().method();
    bodies.push(res.text().then((body) => ({ url: res.url(), method, body }), () => ({ url: res.url(), method, body: "" })));
  });

  await signIn(page, STUDENT_EXAM.username, STUDENT_EXAM.password, /\/exam\/start$/);
  const attemptId = await takeExam(page, ["Nein", "Nein", "Ja"], () => {
    capturing = true;
  }); // 2 of 3, pass mark 60 %
  const resultUrl = page.url();
  await expect(page.getByTestId("result-status")).toHaveText(/Submitted, awaiting review/);
  await page.reload();
  await expect(page.getByTestId("result-status")).toBeVisible();
  expect(await page.locator("body").innerText()).not.toMatch(/\d+\s*(\/|of)\s*\d+|points|%|passed|bestanden/i);
  capturing = false;
  const seen = await Promise.all(bodies);
  expect(seen.some((r) => r.method === "POST" && r.url.includes("/exam/"))).toBe(true); // the submit action
  expect(seen.some((r) => r.url.includes("/results/"))).toBe(true);
  for (const { url, body } of seen) {
    expect(body, url).not.toMatch(/"?(points|max_points|maxPoints|correct_option_id|percent|topics)"?\s*:/);
    expect(body, url).not.toContain("correct_option_id");
    expect(body, url).not.toContain("max_points");
    expect(body, url).not.toContain("Bestanden");
  }

  // A student cannot reach the staff review.
  await page.goto("/staff/review");
  await expect(page).toHaveURL(/\/exam\/start$/);

  // Staff: list, evaluation view, release.
  await signIn(page, STAFF.email, STAFF.password, /\/staff$/);
  await page.getByRole("link", { name: "Review and release results" }).click();
  await expect(page).toHaveURL(/\/staff\/review$/);
  const row = page.getByRole("row").filter({ hasText: STUDENT_EXAM.fullName });
  await expect(row).toContainText(EXAM_CURRICULUM_HELD);
  await expect(row).toContainText("2 / 3");
  await row.getByRole("link", { name: STUDENT_EXAM.fullName }).click();
  await expect(page).toHaveURL(new RegExp(`/staff/review/${attemptId}$`));

  await expect(page.getByRole("heading", { name: STUDENT_EXAM.fullName })).toBeVisible();
  await expect(page.getByTestId("review-question")).toHaveCount(3);
  await expect(page.getByText("Ist Berlin die Hauptstadt von Frankreich?")).toBeVisible();
  await expect(page.getByText("Is Berlin the capital of France?")).toBeVisible();
  await expect(page.getByTestId("review-option").filter({ hasText: "Vielleicht" }).first()).toContainText("Maybe");
  await expect(page.locator("[data-testid=review-option][data-correct]")).toHaveCount(3);
  await expect(page.locator("[data-testid=review-option][data-chosen]")).toHaveCount(3);
  await expect(page.getByText("Correct answer")).toHaveCount(3);
  await expect(page.getByTestId("awarded-points").filter({ hasText: "1 / 1 points" })).toHaveCount(2);
  await expect(page.getByTestId("awarded-points").filter({ hasText: "0 / 1 points" })).toHaveCount(1);
  await expect(page.getByTestId("review-status")).toHaveText("Awaiting release");

  await page.getByRole("button", { name: "Release result" }).click();
  const dialog = page.getByRole("dialog", { name: "Release this result?" });
  await expect(dialog).toContainText("2 of 3");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  const { data: still } = await adminDb().from("attempts").select("status").eq("id", attemptId).single();
  expect(still!.status).toBe("submitted");

  await page.getByRole("button", { name: "Release result" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Release", exact: true }).click();
  await expect(page.getByTestId("review-status")).toHaveText("Released");
  await expect(page.getByRole("button", { name: "Released" })).toBeDisabled();
  await expect(page.getByText(`by ${STAFF.fullName}`)).toBeVisible();

  const { data: released } = await adminDb().from("attempts").select("status, points, released_by").eq("id", attemptId).single();
  expect(released).toMatchObject({ status: "released", points: 2 });
  const { data: staffProfile } = await adminDb().from("profiles").select("id").eq("username", "e2e.staff").single();
  expect(released!.released_by).toBe(staffProfile!.id);
  expect(await assignmentStatus(STUDENT_EXAM.username, EXAM_CURRICULUM_HELD)).toBe("passed");

  await page.getByRole("link", { name: "Back to review list" }).click();
  await expect(page.getByRole("row").filter({ hasText: STUDENT_EXAM.fullName })).toHaveCount(0);

  // Staff still find the released result: the Results list (filtered) and the student page.
  await page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Results" }).click();
  await expect(page).toHaveURL(/\/staff\/results$/);
  await page.getByRole("combobox", { name: "Curriculum" }).selectOption({ label: EXAM_CURRICULUM_HELD });
  await page.getByRole("combobox", { name: "Status" }).selectOption("released");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page).toHaveURL(/status=released/);
  const staffRow = page.getByTestId("results-table").getByRole("row").filter({ hasText: STUDENT_EXAM.fullName });
  await expect(staffRow).toContainText("Released");
  await expect(staffRow).toContainText("2 / 3");
  await staffRow.getByRole("link", { name: STUDENT_EXAM.fullName }).click();
  await expect(page).toHaveURL(new RegExp(`/staff/review/${attemptId}$`));
  await page.goto("/staff/students?q=" + STUDENT_EXAM.username);
  await page.getByRole("link", { name: `Open ${STUDENT_EXAM.fullName}` }).click();
  const studentResults = page.getByTestId("student-results-table");
  await expect(studentResults.getByRole("row").filter({ hasText: EXAM_CURRICULUM_HELD })).toContainText("2 / 3");

  // Student: the bilingual report.
  await signIn(page, STUDENT_EXAM.username, STUDENT_EXAM.password, /\/exam\/start$/);
  // The passed assignment is no longer the student's next exam; the result stays reachable.
  await expect(page.getByTestId("all-completed")).toBeVisible();
  const resultRow = page.getByTestId("results-list").getByRole("listitem").filter({ hasText: EXAM_CURRICULUM_HELD });
  await expect(resultRow).toContainText("2 / 3");
  await expect(resultRow).toContainText("Passed");
  await resultRow.getByRole("link", { name: /View result/ }).click();
  await expect(page).toHaveURL(resultUrl);
  await expect(page.getByRole("heading", { name: "Ergebnis / Result" })).toBeVisible();
  await expect(page.getByTestId("result-score")).toHaveText(/^2 of 3\s*\(66\.7%\)$/);
  await expect(page.getByTestId("result-outcome")).toHaveText("Bestanden / Passed");
  const topics = page.getByTestId("topic-table");
  await expect(topics).toContainText("Thema / Topic");
  await expect(topics.getByRole("row").filter({ hasText: "allgemein" })).toContainText("2 / 3");
  await expect(page.getByText("Prüfung / Exam")).toBeVisible();
  await expect(page.getByRole("button", { name: "Print report" })).toBeVisible();
  // No answer key or question-by-question results for students.
  const html = await page.content();
  expect(html).not.toContain("correct_option_id");
  expect(html).not.toContain("Ist Berlin die Hauptstadt");

  // Print view: report content stays, app controls disappear.
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("heading", { name: "Ergebnis / Result" })).toBeVisible();
  await expect(page.getByTestId("result-outcome")).toHaveText("Bestanden / Passed");
  await expect(page.getByText("Name / Name")).toBeVisible();
  await expect(page.getByText(STUDENT_EXAM.fullName)).toBeVisible();
  await expect(page.getByText("Punkte / Points").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Print report" })).toBeHidden();
  await expect(page.getByRole("link", { name: "Back to exams" })).toBeHidden();
  await page.emulateMedia({ media: null });
});

test("a released result is only visible to its own student", async ({ page }) => {
  await signIn(page, STUDENT_EXAM_OPEN.username, STUDENT_EXAM_OPEN.password, /\/exam\/start$/);
  const attemptId = await takeExam(page, ["Nein", "Nein", "Nein"]); // not held: released at once
  await expect(page.getByTestId("result-outcome")).toHaveText("Bestanden / Passed");
  await expect(page.getByTestId("result-score")).toHaveText(/^3 of 3\s*\(100%\)$/);

  // Another student with a valid session gets not found and none of the numbers.
  await signIn(page, STUDENT_EXAM.username, STUDENT_EXAM.password, /\/exam\/start$/);
  // notFound() inside the streamed Suspense boundary renders the not-found UI (HTTP status stays 200).
  const res = await page.goto(`/results/${attemptId}`);
  await expect(page.getByText(/could not be found/i)).toBeVisible();
  const body = await res!.text();
  for (const leak of ["Bestanden", "3 of 3", "result-score", "allgemein", STUDENT_EXAM_OPEN.fullName]) {
    expect(body).not.toContain(leak);
  }
  expect(await page.content()).not.toContain("Bestanden");
});
