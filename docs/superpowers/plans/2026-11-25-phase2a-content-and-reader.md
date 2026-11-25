# Phase 2A (curriculum content and book reader) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin uploads a curriculum PDF that is converted to page images, marks chapter starts and publishes; students read each chapter in a full-screen book reader reached from a pathway home.

**Architecture:** The admin's browser renders PDF pages with `pdfjs-dist` to WebP (page and thumbnail) and uploads them to a private Storage bucket through server-minted signed upload URLs; atomic service-role SQL functions swap pages, save chapters and publish. Students never touch Storage: server code checks assignment and publication, then returns short-lived signed URLs for one chapter's pages. The reader wraps the `page-flip` core (MIT) in our own client component. Exercises, locking and progress tracking are slice 2B (this slice leaves every chapter open).

**Tech Stack:** Next.js 16 (App Router), Supabase (Postgres, Storage, RLS), `pdfjs-dist` 6.x (Apache-2.0), `page-flip` 2.0.7 (MIT), Vitest, pgTAP, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-25-phase2-curriculum-reader-design.md` (read "Sample curriculum" and "Calls made after the builder check" too). Project rules: `CLAUDE.md`, `DESIGN.md`.

## Global Constraints

- Every public table has RLS; anon has nothing; any RLS change needs a failing `supabase/tests/*.test.sql` test first; new functions need explicit `grant execute` (service_role for the atomic functions). Next migration is `0028`.
- Content is **admin-only to author** (`requireAdmin()` first in every action and page; trainers get no Content area); all staff may read content tables; students have no direct access to any content table or to the bucket (no student or anon storage policy at all).
- Students only ever see published books. The PDF file and a bulk set of page images are never downloadable: private bucket `book-pages`, page URLs signed for a few minutes only.
- Caps: PDF at most 50 MiB and 400 pages, rejected with a clear message. Page images WebP, long edge about 1600 px, quality about 0.82 (builder tunes with the real sample); thumbnails about 160 px wide.
- Chapter rules in one pure module: starts strictly increasing, first chapter starts at page 1, a chapter ends where the next begins, the last ends at the final page. Replacing a PDF requires the book to be unpublished first and clears chapter starts beyond the new page count.
- Look: `DESIGN.md` tokens only, light theme only, 44 px touch targets (`pointer-coarse:`), no raw hex. Motion respects `prefers-reduced-motion` (page flip becomes an instant change, no pulses). The reader is a documented full-screen exception to the narrow student column.
- Reuse, do not duplicate: `requireAdmin`/`requireRole`, `PageHeader`, `StudentHeader`, `Skeleton`, shadcn components, `createAdminClient`. Mixed page sizes in one PDF must work (size every page from its own width and height).
- Frontend tasks (5, 7, 8) use the approved skills: `frontend-design`, `impeccable`, `ui-ux-pro-max`, `shadcn`. Models: Sonnet; Haiku only for doc-only steps; Opus only if a task blocks.
- Never commit the real curriculum PDF (the owner's file `Deutscher_Fleischer_Berufskurs_Complete_Edition_plus_Fisch.pdf`, 51 pages, A4, 2.5 MB); tests use a small generated PDF fixture; the real file is a manual check (path from the owner).
- The working tree may hold unrelated uncommitted edits (`.claude/`, `demo-video/`): never stage them. Commits carry no attribution lines.

## Review Focus

1. A corrupt, password-protected or zero-page PDF: a clear error, nothing stored, existing book untouched.
2. An upload cut off half way (tab closed, network lost): the old pages stay live until the final swap; orphaned files from the failed upload are not served.
3. A student opening a chapter of a curriculum they are not assigned, an unpublished book, or a guessed Storage path: no URLs, nothing leaks.
4. A PDF with mixed portrait and landscape pages, and a device rotated mid-read: pages never stretch or clip, the current page stays.
5. A very small phone (360 px) and a very wide monitor, with reduced motion on: no horizontal overflow, controls reachable, no animation.

---

### Task 1: Book tables, functions and private bucket (migration 0028)

**Files:**
- Create: `supabase/migrations/0028_books_and_chapters.sql`, `supabase/tests/books_and_chapters.test.sql`

**Interfaces:**
- Produces: tables `books(curriculum_id pk -> curriculums on delete cascade, status 'draft'|'published' default 'draft', page_count int default 0, upload_id uuid null, updated_by uuid, updated_at)`, `book_pages(curriculum_id, page_number, path, thumb_path, width, height, pk(curriculum_id, page_number))`, `chapters(id uuid pk, curriculum_id, title, start_page >= 1, unique(curriculum_id, start_page))`; private bucket `book-pages`; service-role functions `finalize_book_upload(p_admin uuid, p_curriculum uuid, p_upload uuid, p_pages jsonb) returns void` (p_pages = array of `{page, path, thumb, width, height}`; atomically replaces `book_pages`, sets `page_count`/`upload_id`, status 'draft', deletes chapters with `start_page > page_count`; raises `not_admin`, `book_published`, `no_pages`, `too_many_pages` (> 400)), `save_chapters(p_admin, p_curriculum, p_chapters jsonb) returns void` (array of `{title, start_page}`; atomic replace; raises `not_admin`, `no_book`, `invalid_chapters` unless first start is 1, starts strictly increasing and <= page_count, titles non-empty), `set_book_status(p_admin, p_curriculum, p_status text) returns void` (publish needs at least one chapter and a first chapter at page 1: `no_chapters`; raises `not_admin`, `no_book`).

- [ ] **Step 1: Write the failing pgTAP test** `books_and_chapters.test.sql` in the style of `roles_and_scope.test.sql`: staff (admin and trainer) can select `books`, `book_pages`, `chapters`; a student and anon read nothing; no session role can insert, update or delete any of the three tables directly (42501); the three functions are executable only by service_role and each refuses a non-admin id (`not_admin`, including an inactive admin and a trainer); `finalize_book_upload` on a published book raises `book_published`; a second upload with fewer pages deletes chapters whose start is beyond the new count and leaves the others; `save_chapters` rejects first start 2, a duplicate start, a start above `page_count`; `set_book_status` rejects publishing with no chapters and accepts it once chapters exist; deleting a curriculum cascades pages and chapters; the bucket `book-pages` exists and is not public, and `storage.objects` has no policy granting anon or authenticated access to it.
- [ ] **Step 2: Run** `npm run db:test`. Expected: the new file FAILS (objects missing).
- [ ] **Step 3: Implement the migration.** Security invoker functions with empty `search_path`, locking the book row first (`FOR UPDATE`), same grant pattern as 0021/0027; bucket via `insert into storage.buckets ... on conflict do nothing` (private); RLS with select policies `private.is_staff()` and revoked table write privileges.
- [ ] **Step 4: Run** `npm run db:reset && npm run db:test && npm run db:lint`. Expected: PASS, lint clean.
- [ ] **Step 5: Commit** `feat(db): books, chapters, page images bucket`.

### Task 2: Chapter module (pure)

**Files:**
- Create: `src/lib/book/chapters.ts`, `src/lib/book/chapters.test.ts`

**Interfaces:**
- Produces: `type ChapterInput = { title: string; startPage: number }`; `validateChapters(chapters: ChapterInput[], pageCount: number): { ok: true; chapters: ChapterInput[] } | { ok: false; message: string }` (trims titles, sorts nothing: input order must already be by start page; messages name the problem in plain English); `type ChapterRange = { index: number; title: string; startPage: number; endPage: number; pageCount: number }`; `chapterRanges(chapters: ChapterInput[], pageCount: number): ChapterRange[]`; `chapterOfPage(ranges: ChapterRange[], page: number): ChapterRange | null`.

- [ ] **Step 1: Write failing tests**: valid 3-chapter file; first start not 1; duplicate and descending starts; start 0 and start > pageCount; empty and whitespace titles; 120-character title limit; zero chapters (valid for a draft, `chapterRanges` returns []); ranges for starts [1, 12, 30] over 51 pages are 1-11, 12-29, 30-51; `chapterOfPage` at boundaries and out of range (null).
- [ ] **Step 2: Run** `npx vitest run src/lib/book/chapters` and see it fail.
- [ ] **Step 3: Implement** the four exports in `chapters.ts`.
- [ ] **Step 4: Run** the same command; PASS. **Step 5: Commit** `feat: chapter ranges and validation`.

### Task 3: PDF to page images (client module)

**Files:**
- Create: `src/lib/book/convert-pdf.ts`, `src/lib/book/convert-pdf.test.ts`, `src/lib/book/limits.ts`, `e2e/fixtures/make-pdf.ts` (generates a small valid multi-page PDF in code, no new dependency)
- Modify: `package.json` (add `pdfjs-dist`)

**Interfaces:**
- Produces in `limits.ts`: `BOOK_MAX_PDF_BYTES = 50 * 1024 * 1024`, `BOOK_MAX_PAGES = 400`, `checkPdfFile(file: { size: number; type?: string; name: string }): string | null` (error message or null). In `convert-pdf.ts` (browser only): `type ConvertedPage = { page: number; image: Blob; thumb: Blob; width: number; height: number }`; `convertPdf(file: File, opts: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal }): AsyncGenerator<ConvertedPage, void, void>` yielding pages in order so the caller uploads while converting and memory stays flat (one canvas at a time, released after each page); throws `PdfError` with `code: 'password' | 'corrupt' | 'empty' | 'too_many_pages'`.

- [ ] **Step 1: Write failing tests**: `checkPdfFile` rejects 50 MiB + 1 byte, non-PDF names, empty files; accepts a normal one; messages are plain English. The browser-level conversion is exercised end to end in Task 5's e2e (no test-only route is added); Task 3 is unit-only plus `makePdf` itself (deterministic bytes, starts with `%PDF-`, page count as asked, landscape pages when `landscapeEvery` is set).
- [ ] **Step 2: Run** `npx vitest run src/lib/book` and see it fail.
- [ ] **Step 3: Implement** `limits.ts` and `convert-pdf.ts`: dynamic `import("pdfjs-dist")` only inside `convertPdf` (never at module top, never on the server), the worker via the bundler-supported `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)` (confirm the current setup for Next 16 with the Context7 docs), `OffscreenCanvas` when available else a DOM canvas, scale so the long edge is about 1600 px (thumb about 160 px wide), `canvas.toBlob("image/webp", 0.82)`, abort checked between pages. Add `e2e/fixtures/make-pdf.ts` exporting `makePdf(pages: number, opts?: { landscapeEvery?: number }): Uint8Array` (hand-written minimal PDF with a title string per page; deterministic).
- [ ] **Step 4: Run** unit tests (PASS), `npx tsc --noEmit`, `npm run build` (the dependency must not break the server build). **Step 5: Commit** `feat: client PDF to page images conversion`.

### Task 4: Authoring actions and readers

**Files:**
- Create: `src/lib/book/book-admin.ts` (+ test), `src/app/staff/content/actions.ts` (+ test), `src/lib/book/read.ts` (+ test)

**Interfaces:**
- Consumes: Task 1 tables and functions, Task 2 `validateChapters`, `requireAdmin`.
- Produces: `listContent(): Promise<{ curriculumId: string; name: string; status: 'none' | 'draft' | 'published'; pageCount: number; chapterCount: number }[]>` and `getBookForEditor(curriculumId: string): Promise<{ status; pageCount; uploadId: string | null; chapters: { id: string; title: string; startPage: number }[]; pages: { page: number; thumbUrl: string; width: number; height: number }[] } | null>` (staff session reads; thumbs signed by the service role for a few minutes). Server actions, each `requireAdmin()` first, returning `{ ok: true; ... } | { ok: false; message: string }`: `startBookUpload(curriculumId): { uploadId: string }` (refuses a published book with "Unpublish the book before replacing the PDF"), `mintUploadUrls({ curriculumId, uploadId, pages: number[] }): { urls: { page: number; imageUrl: string; thumbUrl: string; imagePath: string; thumbPath: string }[] }` (at most 25 pages per call, signed upload URLs valid for minutes, paths `{curriculum_id}/{upload_id}/{page}.webp` and `{page}.thumb.webp`), `finishBookUpload({ curriculumId, uploadId, pages: { page; width; height }[] })` (calls `finalize_book_upload`; then removes the previous upload's files from the bucket; also removes files of `uploadId`s abandoned earlier for this curriculum), `saveChapterStarts({ curriculumId, chapters: ChapterInput[] })` (runs `validateChapters` against the stored page count, then `save_chapters`), `setBookPublished({ curriculumId, published: boolean })`. Error codes from SQL map to messages.

- [ ] **Step 1: Write failing tests** (real local stack, follow `students/actions.test.ts` style): a trainer and a student calling each action are redirected and nothing is written; `startBookUpload` refuses a published book; `mintUploadUrls` refuses more than 25 pages and a page number outside 1..400; `finishBookUpload` swaps pages atomically (old pages stay readable until the call, then are gone, previous upload files removed, a failed finalize leaves the old book intact); `saveChapterStarts` returns the pure module's message for a bad set and nothing changes; `setBookPublished` refuses with no chapters; `listContent` counts correctly with and without a book; an interrupted upload's files are cleaned on the next `finishBookUpload` for that curriculum.
- [ ] **Step 2: Run** `npm test -- content` and see them fail.
- [ ] **Step 3: Implement** the modules; one shared storage helper for signing and deleting (no copies); the service role only for Storage and the atomic functions.
- [ ] **Step 4: Run** `npm test` (PASS), `npx tsc --noEmit`, `npm run lint`. **Step 5: Commit** `feat: book authoring actions`.

### Task 5: Staff Content area (UI)

**Files:**
- Create: `src/app/staff/content/page.tsx`, `src/app/staff/content/[curriculumId]/page.tsx`, `book-uploader.tsx`, `chapter-strip.tsx`, `chapter-list.tsx`, `publish-card.tsx` (all under `src/app/staff/content/[curriculumId]/`), `e2e/content.spec.ts`
- Modify: `src/app/staff/staff-nav.tsx` (+ `staff-nav.test.ts`: add `{ href: "/staff/content", label: "Content", adminOnly: true }`), `e2e/design.spec.ts` (axe and 375 px overflow for both pages), `e2e/seed.ts` only if a helper is needed

**Interfaces:**
- Consumes: Task 3 `convertPdf`, `checkPdfFile`; Task 4 actions and readers; Task 2 `validateChapters`, `chapterRanges`.

- [ ] **Step 1: Write the failing e2e** `content.spec.ts`: admin opens Content, picks a curriculum, uploads a generated 6-page PDF (`makePdf(6)`), sees "Converting page n of 6" then the page strip with 6 thumbnails; drops chapter starts on pages 1 and 4 with titles, sees ranges "1–3, 4–6", publishes; a trainer has no Content link and is redirected from `/staff/content`; replacing a published book is refused until unpublished; a corrupt file (`new Uint8Array([1,2,3])` named .pdf) shows a plain error and changes nothing; a 51-page file converts and reports its elapsed time in the test log (page count, total image bytes). Unit-level: nav shows Content for admin only.
- [ ] **Step 2: Run** `npm run test:e2e -- content` and see it fail.
- [ ] **Step 3: Implement** list page (curriculum cards with status badges: No book, Draft, Published) and the editor: **Book** card (drag-and-drop or button, progress bar, cancel, uploads pages as they convert through `mintUploadUrls` in batches of 25, then `finishBookUpload`), **Chapters** (horizontal thumbnail strip with a marker control per page, title inputs in a list, live ranges, inline validation from `validateChapters`), **Publish** card. Skills as in Global Constraints; staff page conventions from `DESIGN.md` (grey canvas, `PageHeader`, framed cards); every control 44 px on touch; no raw hex.
- [ ] **Step 4: Run** `npm run test:e2e -- content design` and `npm test`; PASS. **Step 5: Commit** `feat: staff content editor for books and chapters`.

### Task 6: Student page access (server module)

**Files:**
- Create: `src/lib/book/pages-access.ts`, `src/lib/book/pages-access.test.ts`

**Interfaces:**
- Consumes: Task 1 tables, Task 4's shared storage signer, `chapterRanges`.
- Produces: `listLearningPaths(studentId: string): Promise<{ curriculumId: string; name: string; chapters: { id: string; title: string; startPage: number; endPage: number; pageCount: number }[] }[]>` (only curriculums the student is assigned to whose book is published and has chapters, ordered by `assignments.position`); `getChapterForReading(studentId: string, curriculumId: string, chapterId: string): Promise<{ ok: true; curriculumName: string; chapterTitle: string; chapterIndex: number; chapterCount: number; pages: { page: number; url: string; thumbUrl: string; width: number; height: number }[]; prev: { chapterId: string } | null; next: { chapterId: string } | null } | { ok: false; reason: 'not_found' }>` (signed URLs valid a few minutes; one reason for every refusal so existence never leaks; callers pass the session user id, never a client id).

- [ ] **Step 1: Write failing tests** (real stack): an assigned student gets the chapter's pages with signed URLs that fetch (200) and a guessed other chapter's path without signature fails; unassigned student, unpublished book, draft re-upload in progress, a chapter id from another curriculum, and a nonexistent id all return the same `not_found`; `listLearningPaths` returns only assigned and published books in `position` order; URLs expire (a URL minted with a short test TTL is refused after it).
- [ ] **Step 2: Run** `npm test -- pages-access` and see it fail. **Step 3: Implement** with the service role after the assignment and publication checks. **Step 4: Run** tests, tsc; PASS. **Step 5: Commit** `feat: student book page access with signed urls`.

### Task 7: Book reader (component and route)

**Files:**
- Create: `src/components/reader/book-reader.tsx`, `src/components/reader/use-reader-layout.ts`, `src/components/reader/reader-thumbs.tsx`, `src/app/(student)/learn/[curriculumId]/read/[chapterId]/page.tsx`, `e2e/reader.spec.ts`
- Modify: `package.json` (add `page-flip`), `e2e/seed.ts` (add `seedBook(curriculumId, pageCount)`: writes generated small images to the bucket and rows with the service role, publishes; reuse for tests), `DESIGN.md` (reader section)

**Interfaces:**
- Consumes: Task 6 `getChapterForReading`. Produces: `<BookReader chapterTitle pages onClose />` (client): spread of two pages when the viewport is wide, single page when narrow (`usePortrait` behaviour), page proportions taken from each page's own width and height, preloads the next pages, keyboard (arrows, Home, End, Escape), swipe and click-drag, thumbnail strip jump, page counter ("12 / 26"), chapter title, close button, fit and zoom toggle, rotation-safe (current page kept), reduced motion = instant page change; `use-reader-layout.ts` exports `useReaderLayout(): { mode: 'spread' | 'single'; pageBox: { width: number; height: number } }`.

- [ ] **Step 1: Write the failing e2e** `reader.spec.ts` (seed a 10-page book with two chapters, assign a student): the student opens chapter 2 and sees only its pages (counter shows the chapter's range), keyboard right/left changes the page, a thumbnail click jumps, Escape closes back to the path; at 375 px the reader is single page with no horizontal overflow; with `reducedMotion: 'reduce'` no flip animation runs (page changes in one frame); a mixed portrait/landscape seed shows both without clipping; axe passes; another student not assigned gets the not-found page with no page data; screenshots at 375 px and desktop saved with the existing design-review convention.
- [ ] **Step 2: Run** `npm run test:e2e -- reader` and see it fail.
- [ ] **Step 3: Implement.** Wrap the `page-flip` core (`PageFlip` with `loadFromImages`/HTML pages) in our own client component, imported dynamically with SSR off; confirm the current API with the Context7 docs; do not add `react-pageflip` (React 19 support unverified). Editorial look from the approved mockup: soft desk background, spine shadow, page curl, calm chrome that fades after idle but returns on touch or key. Skills as in Global Constraints.
- [ ] **Step 4: Run** `npm run test:e2e -- reader design`, `npm test`, `npm run build`; PASS. **Step 5: Commit** `feat: full-screen book reader`.

### Task 8: Learning home (`/learn`), pathway and navigation

**Files:**
- Create: `src/app/(student)/learn/page.tsx`, `src/app/(student)/learn/learning-path.tsx`, `src/app/(student)/learn/template.tsx`, `e2e/learn.spec.ts`
- Modify: `src/proxy.ts` (student home `/learn`), `src/lib/auth/public-paths.ts` only if needed (it is not), `src/components/app/student-header.tsx` (Learn and Exams links, `aria-current`), `src/app/login/actions.ts` (post-login target if it hardcodes `/exam/start`), existing e2e and unit tests that expect `/exam/start` right after login (update, do not weaken), `e2e/design.spec.ts`

**Interfaces:**
- Consumes: Task 6 `listLearningPaths`. Produces: route `/learn`: a student with no learning paths is redirected to `/exam/start` (no proxy database query needed); otherwise one pathway per curriculum: node per chapter (in this slice every chapter is open, showing its title and page count), final "Main exam" node display-only ("Request opens when every chapter is done", Phase 3), progress bar placeholder hidden until slice 2B, entrance motion with `Reveal`, reduced motion respected.

- [ ] **Step 1: Write the failing e2e** `learn.spec.ts`: login lands on `/learn` and, with no book, ends on `/exam/start` (existing flow intact); with a seeded published book the student sees the pathway, chapter nodes link to the reader, the header shows Learn and Exams, Exams still opens the existing start page and a full exam flow still works; a student not assigned to the curriculum sees no path; axe and no horizontal overflow at 375 px and desktop.
- [ ] **Step 2: Run** `npm run test:e2e -- learn login exam` and see failures. **Step 3: Implement** with the approved skills (pathway nodes per the approved mockup: connected line, pulsing current node reserved for 2B, locked style reserved). **Step 4: Run** `npm test`, `npm run test:e2e` (full), `npx tsc --noEmit`, `npm run lint`; PASS. **Step 5: Commit** `feat: learning home with chapter pathway`.

### Task 9: Docs, seed and full verification

**Files:**
- Modify: `CLAUDE.md`, `DESIGN.md`, `scripts/demo-seed.mjs` (demo book for the demo curriculum, small generated images), `docs/superpowers/specs/2026-11-25-phase2-curriculum-reader-design.md` (status: slice 2A implemented, known gaps)

- [ ] **Step 1: Update docs** (Haiku is enough): CLAUDE.md gets a "Curriculum books (v2 phase 2A)" section (tables, functions, bucket, signed URL rule, caps, admin-only authoring, `/staff/content`, `/learn`, student home change, the conversion module) and corrected statements elsewhere (migration range to 0028, student home, nav list); DESIGN.md gets the Content pages, the pathway and the reader (including the full-screen exception and motion rules); verify every named path, function and number against the code.
- [ ] **Step 2: Run the whole gate**: `npm run db:reset && npm run db:test && npm run db:lint && npm test && npm run lint && npx tsc --noEmit && npm run build && npm run test:e2e` (set `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` if `.env.local` still points at 57321). Expected: all PASS.
- [ ] **Step 3: Manual check with the real sample file** (path from the owner, never committed): upload it in the Content editor, mark a few chapters, publish, read on a phone-sized window; report page count, total image size, conversion time and anything that looks wrong in the report.
- [ ] **Step 4: Commit** `docs: phase 2a curriculum books and reader`.

---

## Self-review notes

- Spec coverage for 2A: upload and conversion (T3, T4, T5), chapter strip and rules (T2, T4, T5), publish and replace rules (T1, T4), private storage and signed URLs (T1, T4, T6), pathway home and navigation (T8), reader with spread, single page, thumbnails, keyboard, swipe, zoom, motion (T7), admin-only authoring and trainer redirect (T4, T5), docs (T9). Deferred to 2B on purpose: exercises, gating and locked states, progress, reading telemetry, last-page memory, "Main exam" request.
- Type consistency: `ChapterInput`, `ChapterRange`, `validateChapters`, `chapterRanges` (T2) are used in T4, T5, T6; `convertPdf`/`ConvertedPage` (T3) in T5; `getChapterForReading`/`listLearningPaths` (T6) in T7 and T8.
