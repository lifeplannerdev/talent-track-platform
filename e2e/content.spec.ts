import { expect, test, type Page } from "@playwright/test";
import { EXAM_CURRICULUM_OPEN, STAFF, TRAINER_ONE } from "./fixtures";
import { makePdf } from "./fixtures/make-pdf";
import { curriculumId, signIn, staffNav } from "./helpers";
import { adminDb, removeBookFiles, seed } from "./seed";

// Staff Content: books and chapters. Admin only. Real browser conversion (pdf.js worker, canvas
// WebP), real uploads to the local Storage, real database checks through the service role.

test.setTimeout(240_000);

const CURRICULUM = EXAM_CURRICULUM_OPEN;

test.beforeEach(async () => {
  await seed();
});

test.afterAll(async () => {
  await removeBookFiles(await curriculumId(CURRICULUM));
});

const pdfFile = (pages: number, name = "book.pdf") => ({
  name,
  mimeType: "application/pdf",
  buffer: Buffer.from(makePdf(pages)),
});

async function openEditor(page: Page) {
  await signIn(page, STAFF.email, STAFF.password, /\/staff$/);
  await staffNav(page, "Content");
  await expect(page).toHaveURL(/\/staff\/content$/);
  await page.getByRole("link", { name: CURRICULUM, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: CURRICULUM })).toBeVisible();
}

async function upload(page: Page, pages: number) {
  await expect(page.getByTestId("book-file")).toBeEnabled();
  await page.getByTestId("book-file").setInputFiles(pdfFile(pages));
  await expect(page.getByTestId("page-thumb")).toHaveCount(pages, { timeout: 180_000 });
}

async function chaptersInDb() {
  const { data, error } = await adminDb()
    .from("chapters")
    .select("id, title, start_page, archived_at, retired_start_page")
    .eq("curriculum_id", await curriculumId(CURRICULUM));
  if (error) throw error;
  // Retired chapters have no start page; order by the page they had.
  return [...data].sort((a, b) => (a.start_page ?? a.retired_start_page ?? 0) - (b.start_page ?? b.retired_start_page ?? 0));
}

async function bookInDb() {
  const { data, error } = await adminDb()
    .from("books")
    .select("status, page_count, upload_id")
    .eq("curriculum_id", await curriculumId(CURRICULUM))
    .maybeSingle();
  if (error) throw error;
  return data;
}

test("admin uploads a 6-page PDF (worker and WebP work), marks chapters, sees ranges and publishes", async ({ page }) => {
  // Watch every text change of the status line so the short "Converting page n of 6" is not missed.
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __status: string[] }).__status = seen;
    new MutationObserver(() => {
      const el = document.querySelector('[data-testid="upload-status"]');
      const t = el?.textContent?.trim();
      if (t && seen[seen.length - 1] !== t) seen.push(t);
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  const failures: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 400 && /pdf\.worker|\.mjs/.test(r.url())) failures.push(`${r.status()} ${r.url()}`);
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await openEditor(page);
  await expect(page.getByTestId("book-empty")).toBeVisible();
  await upload(page, 6);
  const seen = await page.evaluate(() => (window as unknown as { __status: string[] }).__status);
  expect(seen.some((t) => /^Converting page \d of 6/.test(t)), JSON.stringify(seen)).toBe(true);
  expect(failures).toEqual([]);
  expect(errors).toEqual([]);

  // Thumbnails are real WebP files in Storage.
  const src = await page.getByTestId("page-thumb").first().locator("img").getAttribute("src");
  const res = await page.request.get(src!);
  expect(res.headers()["content-type"]).toContain("image/webp");

  const book = await bookInDb();
  expect(book).toMatchObject({ status: "draft", page_count: 6 });

  await page.getByRole("button", { name: "Page 1: Start here" }).click();
  await page.getByRole("button", { name: "Page 4: Start here" }).click();
  await page.getByRole("textbox", { name: "Title of chapter 1" }).fill("Grundlagen");
  await page.getByRole("textbox", { name: "Title of chapter 2" }).fill("Alltag");
  const ranges = page.getByTestId("chapter-range");
  await expect(ranges).toHaveText(["Pages 1–3 (3 pages)", "Pages 4–6 (3 pages)"]);
  await page.getByRole("button", { name: "Save chapters" }).click();
  await expect(page.getByTestId("chapters-saved")).toBeVisible();
  expect((await chaptersInDb()).map((c) => [c.title, c.start_page])).toEqual([["Grundlagen", 1], ["Alltag", 4]]);

  await page.getByRole("button", { name: "Publish book" }).click();
  await expect(page.getByTestId("publish-status")).toHaveText(/Published/);
  expect((await bookInDb())?.status).toBe("published");
  await page.goto("/staff/content");
  await expect(page.getByTestId("content-card").filter({ hasText: CURRICULUM })).toContainText("Published");
});

test("editing a title and moving a marker keeps the chapter ids", async ({ page }) => {
  await openEditor(page);
  await upload(page, 6);
  await page.getByRole("button", { name: "Page 1: Start here" }).click();
  await page.getByRole("button", { name: "Page 4: Start here" }).click();
  await page.getByRole("textbox", { name: "Title of chapter 1" }).fill("Eins");
  await page.getByRole("textbox", { name: "Title of chapter 2" }).fill("Zwei");
  await page.getByRole("button", { name: "Save chapters" }).click();
  await expect(page.getByTestId("chapters-saved")).toBeVisible();
  const before = await chaptersInDb();

  await page.getByRole("textbox", { name: "Title of chapter 1" }).fill("Eins neu");
  await page.getByRole("spinbutton", { name: "Start page of chapter 2" }).fill("5");
  await expect(page.getByTestId("chapter-range")).toHaveText(["Pages 1–4 (4 pages)", "Pages 5–6 (2 pages)"]);
  await page.getByRole("button", { name: "Save chapters" }).click();
  await expect(page.getByTestId("chapters-saved")).toBeVisible();

  const after = await chaptersInDb();
  expect(after.map((c) => c.id)).toEqual(before.map((c) => c.id));
  expect(after.map((c) => [c.title, c.start_page, c.archived_at])).toEqual([["Eins neu", 1, null], ["Zwei", 5, null]]);

  // A slip of the finger on the marker and its undo give the same chapter back (same id, same title).
  await page.getByRole("button", { name: "Page 5: Chapter starts" }).click();
  await expect(page.getByTestId("chapter-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Page 5: Start here" }).click();
  await expect(page.getByTestId("chapter-row")).toHaveCount(2);
  await expect(page.getByRole("textbox", { name: "Title of chapter 2" })).toHaveValue("Zwei");
  await expect(page.getByRole("button", { name: "Save chapters" })).toBeDisabled();

  // Removing a marker retires the chapter (kept in the database, gone from the list).
  await page.getByRole("button", { name: "Remove chapter 2" }).click();
  await page.getByRole("button", { name: "Save chapters" }).click();
  await expect(page.getByTestId("chapters-saved")).toBeVisible();
  await expect(page.getByTestId("chapter-row")).toHaveCount(1);
  const retired = (await chaptersInDb()).find((c) => c.title === "Zwei");
  expect(retired?.archived_at).not.toBeNull();
  expect(retired?.id).toBe(before[1].id);
});

test("inline validation: a chapter needs a title and the first must start on page 1", async ({ page }) => {
  await openEditor(page);
  await upload(page, 6);
  await page.getByRole("button", { name: "Page 3: Start here" }).click();
  await expect(page.getByTestId("chapter-validation")).toHaveText(/Chapter 1 needs a title|first chapter must start on page 1/);
  await expect(page.getByRole("button", { name: "Save chapters" })).toBeDisabled();
});

test("a trainer has no Content link and is redirected from /staff/content", async ({ page }) => {
  await signIn(page, TRAINER_ONE.email, TRAINER_ONE.password, /\/staff$/);
  await expect(page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: "Content" })).toHaveCount(0);
  await page.goto("/staff/content");
  await expect(page).toHaveURL(/\/staff$/);
  await page.goto(`/staff/content/${await curriculumId(CURRICULUM)}`);
  await expect(page).toHaveURL(/\/staff$/);
});

test("replacing a published book is refused until it is unpublished", async ({ page }) => {
  await openEditor(page);
  await upload(page, 3);
  await page.getByRole("button", { name: "Page 1: Start here" }).click();
  await page.getByRole("textbox", { name: "Title of chapter 1" }).fill("Alles");
  await page.getByRole("button", { name: "Save chapters" }).click();
  await expect(page.getByTestId("chapters-saved")).toBeVisible();
  await page.getByRole("button", { name: "Publish book" }).click();
  await expect(page.getByTestId("publish-status")).toHaveText(/Published/);

  await expect(page.getByTestId("book-file")).toHaveCount(0);
  await expect(page.getByTestId("replace-blocked")).toContainText("Unpublish the book to replace the PDF");
  const uploadId = (await bookInDb())?.upload_id;

  await page.getByRole("button", { name: "Unpublish book" }).click();
  await expect(page.getByTestId("publish-status")).toHaveText(/Draft/);
  await expect(page.getByTestId("book-file")).toHaveCount(1);
  await expect(page.getByTestId("book-file")).toBeEnabled();
  await page.getByTestId("book-file").setInputFiles(pdfFile(2, "second.pdf"));
  await expect(page.getByTestId("page-thumb")).toHaveCount(2, { timeout: 120_000 });
  const book = await bookInDb();
  expect(book?.page_count).toBe(2);
  expect(book?.upload_id).not.toBe(uploadId);
  expect(book?.status).toBe("draft");
});

test("a corrupt file shows a plain error and changes nothing", async ({ page }) => {
  await openEditor(page);
  await upload(page, 3);
  const before = await bookInDb();
  await expect(page.getByTestId("book-file")).toBeEnabled();
  await page.getByTestId("book-file").setInputFiles({
    name: "broken.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(new Uint8Array([1, 2, 3])),
  });
  await expect(page.getByTestId("upload-error")).toContainText("could not be read");
  await expect(page.getByTestId("upload-error")).toContainText("current book was not changed");
  expect(await bookInDb()).toEqual(before);
  await expect(page.getByTestId("page-thumb")).toHaveCount(3);
});

test("a password-protected PDF shows a plain error and changes nothing", async ({ page }) => {
  // A tiny PDF whose trailer names the Standard security handler with made-up O and U entries:
  // pdf.js cannot open it with an empty password, which is the same signal as a real protected file.
  const hex = (n: number, c: string) => c.repeat(n * 2);
  const body =
    "%PDF-1.4\n" +
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\n" +
    `4 0 obj\n<< /Filter /Standard /V 1 /R 2 /O <${hex(32, "a")}> /U <${hex(32, "b")}> /P -4 >>\nendobj\n` +
    `trailer\n<< /Size 5 /Root 1 0 R /Encrypt 4 0 R /ID [<${hex(16, "c")}> <${hex(16, "c")}>] >>\nstartxref\n0\n%%EOF\n`;
  await openEditor(page);
  await expect(page.getByTestId("book-file")).toBeEnabled();
  await page.getByTestId("book-file").setInputFiles({ name: "locked.pdf", mimeType: "application/pdf", buffer: Buffer.from(body) });
  await expect(page.getByTestId("upload-error")).toContainText("password protected");
  expect(await bookInDb()).toBeNull();
  await expect(page.getByTestId("book-empty")).toBeVisible();
});

test("a 51-page PDF converts and uploads (timing logged)", async ({ page }, info) => {
  await openEditor(page);
  const started = Date.now();
  await expect(page.getByTestId("book-file")).toBeEnabled();
  await page.getByTestId("book-file").setInputFiles(pdfFile(51, "fifty-one.pdf"));
  await expect(page.getByTestId("page-thumb")).toHaveCount(51, { timeout: 220_000 });
  const seconds = (Date.now() - started) / 1000;
  const db = adminDb();
  const { data: pages, error } = await db
    .from("book_pages")
    .select("path, thumb_path")
    .eq("curriculum_id", await curriculumId(CURRICULUM));
  if (error) throw error;
  const sizes = await Promise.all(
    (pages ?? []).flatMap((p) => [p.path, p.thumb_path]).map(async (path) => {
      const { data } = await db.storage.from("book-pages").download(path);
      return data?.size ?? 0;
    }),
  );
  const total = sizes.reduce((a, b) => a + b, 0);
  const line = `[51-page book] ${pages?.length} pages, ${sizes.length} files, ${(total / 1024).toFixed(0)} KiB image bytes, ${seconds.toFixed(1)} s end to end (${info.project.name})`;
  console.log(line);
  expect(pages).toHaveLength(51);
  expect(sizes.every((s) => s > 0)).toBe(true);
});
