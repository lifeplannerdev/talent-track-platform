import { expect, test } from "@playwright/test";
import { EXAM_CURRICULUM, EXAM_CURRICULUM_OPEN, EXAM_CURRICULUM_TWO, STAFF, STUDENT_EXAM, STUDENT_EXAM_OPEN } from "./fixtures";
import { assignment, attemptRow, curriculumCard, signIn, staffNav, takeExam } from "./helpers";
import { seed } from "./seed";

// Spec change 1: the result is shown the moment the exam is submitted (percentage first), with no
// hold or release; staff see every attempt read-only, with the bilingual evaluation.

test.beforeEach(async () => {
  await seed();
});

test("result at once: the student sees the percentage, staff see the read-only bilingual evaluation, the student prints the report", async ({
  page,
}) => {
  // Network level: from the submit click on, nothing served to the student (documents, fetches,
  // the submit server action and the result page payloads) carries the answer key or question texts.
  let capturing = false;
  const bodies: Promise<{ url: string; method: string; body: string }>[] = [];
  page.on("response", (res) => {
    if (!capturing || !["document", "fetch", "xhr"].includes(res.request().resourceType())) return;
    const method = res.request().method();
    bodies.push(res.text().then((body) => ({ url: res.url(), method, body }), () => ({ url: res.url(), method, body: "" })));
  });

  await signIn(page, STUDENT_EXAM.username, STUDENT_EXAM.password, /\/exam\/start$/);
  const attemptId = await takeExam(page, EXAM_CURRICULUM, ["Nein", "Nein", "Ja"], {
    beforeSubmit: () => {
      capturing = true;
    },
  }); // 2 of 3, pass mark 60 %
  const resultUrl = page.url();
  await expect(page.getByTestId("result-score")).toHaveText("66.7%");
  await expect(page.getByTestId("result-points")).toContainText("2 of 3 points");
  await expect(page.getByTestId("result-outcome")).toHaveText("Bestanden / Passed");
  await page.reload();
  await expect(page.getByTestId("result-score")).toHaveText("66.7%");
  capturing = false;
  const seen = await Promise.all(bodies);
  expect(seen.some((r) => r.method === "POST" && r.url.includes("/exam/"))).toBe(true); // the submit action
  expect(seen.some((r) => r.url.includes("/results/"))).toBe(true);
  for (const { url, body } of seen) {
    expect(body, url).not.toContain("correct_option_id");
    expect(body, url).not.toContain("correctOptionId");
    expect(body, url).not.toContain("Ist Berlin die Hauptstadt");
    expect(body, url).not.toContain("Ist der Mond aus");
    expect(body, url).not.toMatch(/awaiting review/i);
  }
  const examSetName = (await attemptRow(attemptId)).exam_sets.name;
  // The exam set is chosen at random among the curriculum's sets (seed: set 1 starts with Berlin, set 2 with the moon).
  const [firstDe, firstEn] =
    examSetName === "Grundlagen 1"
      ? ["Ist Berlin die Hauptstadt von Frankreich?", "Is Berlin the capital of France?"]
      : ["Ist der Mond aus Käse?", "Is the moon made of cheese?"];

  // A student cannot reach the staff attempts list.
  await page.goto("/staff/review");
  await expect(page).toHaveURL(/\/exam\/start$/);

  // Staff: the read-only Attempts list and the evaluation view (no Release anywhere).
  await signIn(page, STAFF.email, STAFF.password, /\/staff$/);
  await staffNav(page, "Attempts");
  await expect(page).toHaveURL(/\/staff\/review$/);
  const row = page.getByTestId("results-table").getByRole("row").filter({ hasText: STUDENT_EXAM.fullName });
  await expect(row).toContainText(EXAM_CURRICULUM);
  await expect(row).toContainText(examSetName);
  await expect(row).toContainText("66.7%");
  await expect(row).toContainText("2 / 3");
  await expect(row).toContainText("Passed");
  await expect(page.getByRole("button", { name: /release/i })).toHaveCount(0);
  await row.getByRole("link", { name: new RegExp(STUDENT_EXAM.fullName) }).click();
  await expect(page).toHaveURL(new RegExp(`/staff/review/${attemptId}$`));

  await expect(page.getByRole("heading", { name: STUDENT_EXAM.fullName })).toBeVisible();
  await expect(page.getByTestId("review-question")).toHaveCount(3);
  await expect(page.getByText(firstDe)).toBeVisible();
  await expect(page.getByText(firstEn)).toBeVisible();
  await expect(page.getByTestId("review-option").filter({ hasText: "Vielleicht" }).first()).toContainText("Maybe");
  await expect(page.locator("[data-testid=review-option][data-correct]")).toHaveCount(3);
  await expect(page.locator("[data-testid=review-option][data-chosen]")).toHaveCount(3);
  await expect(page.getByText("Correct answer")).toHaveCount(3);
  await expect(page.getByTestId("awarded-points").filter({ hasText: "1 / 1 points" })).toHaveCount(2);
  await expect(page.getByTestId("awarded-points").filter({ hasText: "0 / 1 points" })).toHaveCount(1);
  await expect(page.getByTestId("review-score")).toHaveText("66.7%");
  await expect(page.getByTestId("review-points")).toHaveText("2 of 3 points");
  await expect(page.getByTestId("review-status")).toHaveText("Passed");
  await expect(page.getByRole("button", { name: /release/i })).toHaveCount(0);
  const stored = await attemptRow(attemptId);
  expect(stored).toMatchObject({ status: "released", points: 2, passed: true });
  expect((await assignment(STUDENT_EXAM.username, EXAM_CURRICULUM)).status).toBe("passed");

  // Back to the list: the attempt stays there (nothing to release).
  await page.getByRole("link", { name: "Back to attempts" }).click();
  await expect(page).toHaveURL(/\/staff\/review$/);
  await expect(page.getByTestId("results-table").getByRole("row").filter({ hasText: STUDENT_EXAM.fullName })).toHaveCount(1);

  // Filters: curriculum and status. The old Results address leads to the same list.
  await page.getByRole("combobox", { name: "Curriculum" }).selectOption({ label: EXAM_CURRICULUM });
  await page.getByRole("combobox", { name: "Status" }).selectOption("passed");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page).toHaveURL(/status=passed/);
  await expect(page.getByTestId("results-table").getByRole("row").filter({ hasText: STUDENT_EXAM.fullName })).toContainText("2 / 3");
  await page.getByRole("combobox", { name: "Status" }).selectOption("not_passed");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page).toHaveURL(/status=not_passed/);
  await expect(page.getByTestId("results-empty")).toBeVisible();
  await page.goto("/staff/results");
  await expect(page).toHaveURL(/\/staff\/review$/);

  // The student page lists the result with its evaluation link.
  await page.goto("/staff/students?q=" + STUDENT_EXAM.username);
  await page.getByRole("link", { name: `Open ${STUDENT_EXAM.fullName}` }).click();
  const studentResults = page.getByTestId("student-results-table");
  const resultRow = studentResults.getByRole("row").filter({ hasText: EXAM_CURRICULUM });
  await expect(resultRow).toContainText("2 / 3");
  await expect(resultRow).toContainText("Passed");
  await resultRow.getByRole("link", { name: /Evaluation/ }).click();
  await expect(page).toHaveURL(new RegExp(`/staff/review/${attemptId}$`));

  // Student: the passed card, the results list and the bilingual report.
  await signIn(page, STUDENT_EXAM.username, STUDENT_EXAM.password, /\/exam\/start$/);
  await expect(curriculumCard(page, EXAM_CURRICULUM)).toHaveAttribute("data-kind", "passed");
  await expect(curriculumCard(page, EXAM_CURRICULUM_TWO)).toHaveAttribute("data-kind", "ready");
  const group = page.getByTestId("results-group").filter({ visible: true }).filter({ hasText: EXAM_CURRICULUM });
  const listRow = group.getByTestId("result-row").first();
  await expect(listRow.getByTestId("result-percent")).toHaveText("66.7%");
  await expect(listRow).toContainText("2 / 3");
  await expect(listRow).toContainText("Passed");
  await listRow.getByRole("link", { name: /View result/ }).click();
  await expect(page).toHaveURL(resultUrl);
  await expect(page.getByRole("heading", { name: "Ergebnis / Result" })).toBeVisible();
  await expect(page.getByTestId("result-score")).toHaveText("66.7%");
  await expect(page.getByTestId("result-points")).toContainText("2 of 3 points");
  // The pass mark snapshot of the attempt (this curriculum's exam sets use 60%).
  await expect(page.getByTestId("result-pass-mark")).toContainText("60%");
  await expect(page.getByTestId("result-outcome")).toHaveText("Bestanden / Passed");
  const topics = page.getByTestId("topic-table");
  await expect(topics).toContainText("Thema / Topic");
  await expect(topics.getByRole("row").filter({ hasText: "allgemein" })).toContainText("2 / 3");
  await expect(page.getByText("Prüfung / Exam")).toBeVisible();
  await expect(page.getByTestId("result-report")).toContainText(examSetName);
  await expect(page.getByRole("button", { name: "Print report" })).toBeVisible();
  // No answer key or question-by-question results for students.
  const html = await page.content();
  expect(html).not.toContain("correct_option_id");
  expect(html).not.toContain(firstDe);

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

test("a failed attempt is shown at once with its percentage; the other curriculum is independent", async ({ page }) => {
  await signIn(page, STUDENT_EXAM.username, STUDENT_EXAM.password, /\/exam\/start$/);
  // The second curriculum first: any order.
  const attemptId = await takeExam(page, EXAM_CURRICULUM_TWO, ["Ja", "Ja", "Nein"]); // 1 of 3, pass mark 90 %
  await expect(page.getByTestId("result-score")).toHaveText("33.3%");
  await expect(page.getByTestId("result-outcome")).toHaveText("Nicht bestanden / Not passed");
  await expect(page.getByTestId("result-pass-mark")).toContainText("90%");
  expect(await attemptRow(attemptId)).toMatchObject({ status: "released", points: 1, passed: false });
  // One of two attempts used: still open.
  expect((await assignment(STUDENT_EXAM.username, EXAM_CURRICULUM_TWO)).status).toBe("open");

  await page.getByRole("link", { name: "Back to exams" }).click();
  await expect(page).toHaveURL(/\/exam\/start$/);
  await expect(curriculumCard(page, EXAM_CURRICULUM_TWO)).toHaveAttribute("data-kind", "ready");
  await expect(curriculumCard(page, EXAM_CURRICULUM_TWO).getByTestId("attempts-left")).toHaveText("1 attempt left");
  await expect(curriculumCard(page, EXAM_CURRICULUM_TWO)).toContainText("This is your last attempt.");
  await expect(curriculumCard(page, EXAM_CURRICULUM).getByTestId("attempts-left")).toHaveText("2 attempts left");
  const group = page.getByTestId("results-group").filter({ visible: true }).filter({ hasText: EXAM_CURRICULUM_TWO });
  await expect(group.getByTestId("result-row")).toHaveCount(1);
  await expect(group.getByTestId("result-percent")).toHaveText("33.3%");
  await expect(group).toContainText("Not passed");
  // Nothing about the other curriculum, and no promise of a later review.
  await expect(page.getByTestId("results-group").filter({ visible: true })).toHaveCount(1);
  // innerText skips routes Next keeps rendered but hidden after navigation.
  expect(await page.locator("body").innerText()).not.toMatch(/awaiting|review|released/i);
});

test("a result is only visible to its own student", async ({ page }) => {
  await signIn(page, STUDENT_EXAM_OPEN.username, STUDENT_EXAM_OPEN.password, /\/exam\/start$/);
  const attemptId = await takeExam(page, EXAM_CURRICULUM_OPEN, ["Nein", "Nein", "Nein"]);
  await expect(page.getByTestId("result-outcome")).toHaveText("Bestanden / Passed");
  await expect(page.getByTestId("result-score")).toHaveText("100%");
  // This exam set was created without a pass mark: the 90% standard applies.
  await expect(page.getByTestId("result-pass-mark")).toContainText("90%");

  // Another student with a valid session gets not found and none of the numbers.
  await signIn(page, STUDENT_EXAM.username, STUDENT_EXAM.password, /\/exam\/start$/);
  // notFound() inside the streamed Suspense boundary renders the not-found UI (HTTP status stays 200).
  const res = await page.goto(`/results/${attemptId}`);
  await expect(page.getByText(/could not be found/i)).toBeVisible();
  // One skip-link target, also when the not-found UI streams into a page with a header.
  await expect(page.locator("#main-content")).toHaveCount(1);
  const body = await res!.text();
  for (const leak of ["Bestanden", "3 of 3", "result-score", "allgemein", STUDENT_EXAM_OPEN.fullName]) {
    expect(body).not.toContain(leak);
  }
  expect(await page.content()).not.toContain("Bestanden");
});
