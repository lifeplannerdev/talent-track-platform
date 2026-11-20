import { expect, test, type Page } from "@playwright/test";
import { EXAM_CURRICULUM, EXAM_CURRICULUM_OPEN, EXAM_CURRICULUM_TWO, STUDENT_EXAM, STUDENT_EXAM_OPEN } from "./fixtures";
import { assignment, attemptRow, choose, curriculumCard, signIn as signInAs, startExam } from "./helpers";
import { adminDb, seed } from "./seed";

test.beforeEach(async () => {
  await seed();
});

const signIn = (page: Page, username: string, password: string) => signInAs(page, username, password, /\/exam\/start$/);

const stem = (page: Page) => page.getByTestId("question-stem");
async function optionTexts(page: Page) {
  await expect(page.getByRole("radio")).toHaveCount(3);
  return page.getByRole("radio").evaluateAll((els) => els.map((e) => e.closest("label")!.textContent));
}

test("start one curriculum, refresh mid-way to the same paper, submit and see the result at once", async ({ page }) => {
  // Network level: nothing served to the student (start, exam and result pages, server actions)
  // may carry the answer key, and no page may promise a later review.
  // Split at the submit click: before it, no /exam/ response may carry any score or pass mark.
  let submitted = false;
  const bodies: Promise<{ url: string; body: string; beforeSubmit: boolean }>[] = [];
  page.on("response", (res) => {
    const path = new URL(res.url()).pathname;
    if (path.startsWith("/exam/") || path.startsWith("/results/")) {
      const beforeSubmit = !submitted;
      bodies.push(
        res.text().then(
          (body) => ({ url: res.url(), body, beforeSubmit }),
          () => ({ url: res.url(), body: "", beforeSubmit }),
        ),
      );
    }
  });
  await signIn(page, STUDENT_EXAM.username, STUDENT_EXAM.password);
  // Two independent cards; this one is started first.
  await expect(curriculumCard(page, EXAM_CURRICULUM).getByTestId("attempts-left")).toHaveText("2 attempts left");
  await expect(curriculumCard(page, EXAM_CURRICULUM_TWO).getByTestId("attempts-left")).toHaveText("2 attempts left");
  const attemptId = await startExam(page, EXAM_CURRICULUM);
  const examUrl = page.url();

  // German question text, English interface, a running countdown.
  await expect(page.getByRole("heading", { name: "Question 1 of 3" })).toBeVisible();
  await expect(page.getByTestId("timer")).toHaveText(/^(29|30):\d\d$/);
  const stem1 = await stem(page).textContent();
  expect(stem1).toMatch(/\?$/);
  const order1 = await optionTexts(page);
  await choose(page, "Nein");

  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Question 2 of 3" })).toBeVisible();
  const stem2 = await stem(page).textContent();
  const order2 = await optionTexts(page);
  await choose(page, "Ja");

  // Refresh: same paper, same option order, saved answers restored.
  await page.reload({ waitUntil: "load" });
  await expect(page).toHaveURL(examUrl);
  await expect(stem(page)).toHaveText(stem1!);
  expect(await optionTexts(page)).toEqual(order1);
  await expect(page.getByRole("radio", { name: "Nein", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Question 2, answered" }).click();
  await expect(stem(page)).toHaveText(stem2!);
  expect(await optionTexts(page)).toEqual(order2);
  await expect(page.getByRole("radio", { name: "Ja", exact: true })).toBeChecked();

  await page.getByRole("button", { name: "Question 3, not answered" }).click();
  await expect(stem(page)).not.toHaveText(stem1!);
  await expect(stem(page)).not.toHaveText(stem2!);
  await choose(page, "Nein");

  // Confirm dialog: cancel first, then submit.
  await page.getByRole("button", { name: "Review and submit" }).click();
  const dialog = page.getByRole("dialog", { name: "Submit your exam?" });
  await expect(dialog).toContainText("You answered 3 of 3 questions");
  await expect(dialog).toContainText("Your result is shown right after you submit.");
  await dialog.getByRole("button", { name: "Keep working" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  submitted = true;
  await page.getByRole("dialog").getByRole("button", { name: "Submit exam" }).click();

  // The result at once, percentage first: 2 of 3 = 66.7%, pass mark 60%.
  await expect(page).toHaveURL(new RegExp(`/results/${attemptId}$`));
  await expect(page.getByTestId("result-score")).toHaveText("66.7%");
  await expect(page.getByTestId("result-outcome")).toHaveText("Bestanden / Passed");
  await expect(page.getByTestId("result-status")).toHaveCount(0);

  // Scored and released in one step; the assignment is passed in the same transaction.
  const attempt = await attemptRow(attemptId);
  expect(attempt).toMatchObject({ status: "released", points: 2, max_points: 3, passed: true });
  expect(attempt.released_at).not.toBeNull();
  expect((await assignment(STUDENT_EXAM.username, EXAM_CURRICULUM)).status).toBe("passed");

  // Back on the start page: this card is passed, the other curriculum is untouched and still ready.
  await page.goto("/exam/start");
  await expect(curriculumCard(page, EXAM_CURRICULUM)).toHaveAttribute("data-kind", "passed");
  await expect(curriculumCard(page, EXAM_CURRICULUM)).toContainText("66.7%");
  await expect(curriculumCard(page, EXAM_CURRICULUM).getByRole("button", { name: "Start exam" })).toHaveCount(0);
  await expect(curriculumCard(page, EXAM_CURRICULUM_TWO)).toHaveAttribute("data-kind", "ready");
  await expect(curriculumCard(page, EXAM_CURRICULUM_TWO).getByTestId("attempts-left")).toHaveText("2 attempts left");
  // The finished exam page now leads to the result.
  await page.goto(examUrl);
  await expect(page).toHaveURL(/\/results\//);

  const seen = await Promise.all(bodies);
  expect(seen.some((r) => r.url.includes("/results/"))).toBe(true);
  expect(seen.some((r) => r.url.includes("/exam/start"))).toBe(true);
  const preSubmit = seen.filter((r) => r.beforeSubmit && new URL(r.url).pathname.startsWith("/exam/"));
  expect(preSubmit.some((r) => /\/exam\/[0-9a-f-]{36}/.test(r.url))).toBe(true);
  for (const { url, body } of preSubmit) {
    for (const leak of ["points", "max_points", "maxPoints", "percent", "pass_mark_percent", "passMarkPercent"]) {
      expect(body, `${url} before submit: ${leak}`).not.toContain(leak);
    }
  }
  for (const { url, body } of seen) {
    expect(body, url).not.toContain("correct_option_id");
    expect(body, url).not.toContain("correctOptionId");
    expect(body, url).not.toMatch(/awaiting review|before it is released/i);
  }
});

test("an expired attempt is submitted and scored when the student comes back", async ({ page }) => {
  await signIn(page, STUDENT_EXAM_OPEN.username, STUDENT_EXAM_OPEN.password);
  const attemptId = await startExam(page, EXAM_CURRICULUM_OPEN);
  await choose(page, "Nein");

  // Move the deadline into the past (database time decides).
  await adminDb()
    .from("attempts")
    .update({
      started_at: new Date(Date.now() - 40 * 60_000).toISOString(),
      deadline_at: new Date(Date.now() - 60_000).toISOString(),
    })
    .eq("id", attemptId);
  // The answer was saved in time (only answers saved before the deadline count).
  const { data: aqs } = await adminDb().from("attempt_questions").select("id").eq("attempt_id", attemptId);
  await adminDb()
    .from("answers")
    .update({ saved_at: new Date(Date.now() - 30 * 60_000).toISOString() })
    .in("attempt_question_id", aqs!.map((q) => q.id));

  await page.reload();
  await expect(page).toHaveURL(new RegExp(`/results/${attemptId}$`));
  // 1 of 3 answered correctly: shown at once, below the 90% pass mark.
  await expect(page.getByTestId("result-score")).toHaveText("33.3%");
  await expect(page.getByTestId("result-outcome")).toHaveText("Nicht bestanden / Not passed");
  expect(await attemptRow(attemptId)).toMatchObject({ status: "released", points: 1, max_points: 3, passed: false });
});

test("offline: a banner shows and the answer is saved once the connection is back", async ({ page, context }) => {
  await signIn(page, STUDENT_EXAM_OPEN.username, STUDENT_EXAM_OPEN.password);
  await startExam(page, EXAM_CURRICULUM_OPEN);
  const attemptId = page.url().split("/").pop()!;
  // The countdown appears once the page is hydrated and listening for connection changes.
  await expect(page.getByTestId("timer")).not.toHaveText("--:--");

  await context.setOffline(true);
  await expect(page.getByTestId("offline-banner")).toBeVisible();
  await page.getByRole("radio", { name: "Vielleicht", exact: true }).click();
  await expect(page.getByTestId("save-status")).toHaveText("Not saved yet, will retry");

  await context.setOffline(false);
  await expect(page.getByTestId("offline-banner")).toBeHidden();
  await expect(page.getByTestId("save-status")).toHaveText(/Saved/);
  const { data: aq } = await adminDb().from("attempt_questions").select("id").eq("attempt_id", attemptId).eq("position", 1).single();
  const { data: answer } = await adminDb().from("answers").select("option_id").eq("attempt_question_id", aq!.id).single();
  expect(answer!.option_id).toBe("c");
});

test("a submit that cannot reach the server keeps the exam and its unsaved answer; after reconnecting it saves first", async ({ page }) => {
  await signIn(page, STUDENT_EXAM_OPEN.username, STUDENT_EXAM_OPEN.password);
  await startExam(page, EXAM_CURRICULUM_OPEN);
  const examUrl = page.url();
  const attemptId = examUrl.split("/").pop()!;
  await expect(page.getByTestId("timer")).not.toHaveText("--:--");

  // The browser believes it is online, but server actions (POSTs to the exam URL) fail.
  const blockActions = (route: import("@playwright/test").Route) =>
    route.request().method() === "POST" ? route.abort("internetdisconnected") : route.continue();
  await page.route(`**/exam/${attemptId}`, blockActions);
  await page.getByRole("radio", { name: "Vielleicht", exact: true }).click();
  await expect(page.getByTestId("save-status")).toHaveText("Not saved yet, will retry");

  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Submit exam" }).click();
  await expect(page.getByTestId("submit-error")).toHaveText(/Some answers are not saved yet; reconnect and try again/);
  await expect(page).toHaveURL(examUrl);
  await expect(page.getByTestId("question-stem")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Vielleicht", exact: true })).toBeChecked();
  const { data: still } = await adminDb().from("attempts").select("status").eq("id", attemptId).single();
  expect(still!.status).toBe("in_progress");

  // Reconnect: submitting now sends the pending answer before the submit.
  await page.unroute(`**/exam/${attemptId}`, blockActions);
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Submit exam" }).click();
  await expect(page).toHaveURL(new RegExp(`/results/${attemptId}$`));
  const { data: aq } = await adminDb().from("attempt_questions").select("id").eq("attempt_id", attemptId).eq("position", 1).single();
  const { data: answer } = await adminDb().from("answers").select("option_id").eq("attempt_question_id", aq!.id).single();
  expect(answer!.option_id).toBe("c");
  const { data: done } = await adminDb().from("attempts").select("status").eq("id", attemptId).single();
  expect(done!.status).toBe("released");
});

test("a save that fails while the browser stays online is retried on its own", async ({ page }) => {
  await signIn(page, STUDENT_EXAM_OPEN.username, STUDENT_EXAM_OPEN.password);
  await startExam(page, EXAM_CURRICULUM_OPEN);
  const attemptId = page.url().split("/").pop()!;
  await expect(page.getByTestId("timer")).not.toHaveText("--:--");

  // No offline event: only the server actions fail for a moment (a server error, say).
  const blockActions = (route: import("@playwright/test").Route) =>
    route.request().method() === "POST" ? route.abort("failed") : route.continue();
  await page.route(`**/exam/${attemptId}`, blockActions);
  await page.getByRole("radio", { name: "Vielleicht", exact: true }).click();
  await expect(page.getByTestId("save-status")).toHaveText("Not saved yet, will retry");

  await page.unroute(`**/exam/${attemptId}`, blockActions);
  await expect(page.getByTestId("save-status")).toHaveText(/Saved/, { timeout: 12_000 });
  const { data: aq } = await adminDb().from("attempt_questions").select("id").eq("attempt_id", attemptId).eq("position", 1).single();
  const { data: answer } = await adminDb().from("answers").select("option_id").eq("attempt_question_id", aq!.id).single();
  expect(answer!.option_id).toBe("c");
});

test("Submit is disabled while the browser is offline", async ({ page, context }) => {
  await signIn(page, STUDENT_EXAM_OPEN.username, STUDENT_EXAM_OPEN.password);
  await startExam(page, EXAM_CURRICULUM_OPEN);
  await expect(page.getByTestId("timer")).not.toHaveText("--:--");
  await context.setOffline(true);
  await expect(page.getByTestId("offline-banner")).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit", exact: true })).toBeDisabled();
  await context.setOffline(false);
  await expect(page.getByRole("button", { name: "Submit", exact: true })).toBeEnabled();
});

test("the cron sweep route is not behind the login redirect and requires its secret", async ({ request }) => {
  const res = await request.get("/api/cron/sweep", { maxRedirects: 0 });
  expect(res.status()).toBe(401);
  const wrong = await request.get("/api/cron/sweep", { maxRedirects: 0, headers: { authorization: "Bearer nope" } });
  expect(wrong.status()).toBe(401);
});
