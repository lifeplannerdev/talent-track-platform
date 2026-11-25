# Phase 2: curriculum content, book reader and chapter exercises

Status: draft for owner approval, 2026-11-25. Part of the v2 roadmap in `2026-11-24-v2-roadmap-and-foundation-design.md` (Phase 1 is merged on `main`). Phase 3 (exam request workflow) and later phases are out of scope here.

## Intent and why

The instructor's curriculum exists as PDFs and cannot be re-laid out. Students should read it like a book on any screen, work through it chapter by chapter, and prove each chapter with a admin-set exercise they may retry as often as needed. Passing unlocks the next chapter. Everything a trainer needs for Phase 3 (when a student read, how long, every attempt and score) must be recorded now.

## Goals

1. An admin uploads one PDF per curriculum and marks where each chapter starts on a page strip.
2. A student reads a chapter in a full-screen book with a real page-turn animation (swipe, arrow keys, thumbnails), on phone, tablet and desktop, with the last page remembered.
3. Each chapter may have an exercise written by an admin: any number of multiple-choice questions, optional timer, own pass mark, unlimited retries.
4. A chapter unlocks only when the previous chapter is complete (exercise passed, or last page reached when the chapter has no exercise).
5. Reading time, page position and every exercise attempt are stored with server timestamps, readable by the student's trainer and admin.
6. After a failed attempt the student sees the score and each question marked right or wrong; correct answers stay hidden until the chapter exercise has been passed (owner decision).
7. The look follows the owner's choice: a pathway home (done, pulsing current, locked chapters, final "Main exam" node) opening into an editorial book reader (spine shadow, page curl), light theme per `DESIGN.md`.

## Non-goals

No exam request, programme duration, attendance or feedback (Phase 3). No plans, self sign-up or payments (Phases 4 and 5). No annotations, search, OCR, video or downloads. No change to the exam engine, attempts allowance, scoring or `/exam/*`. No automatic chapter detection from the PDF.

## Anti-goals

- The PDF file or a bulk set of page images must never be downloadable by a student (no public bucket, no long-lived links).
- The instructor's page layout is never altered: pages are rendered, not reflowed.
- Exercise rules must not leak into or weaken exam rules (separate tables and functions).
- Animation must never block reading: `prefers-reduced-motion` turns the page flip into an instant change and removes pulses and celebrations.

## Constraints from the project docs (must hold)

Every public table has RLS, anon has nothing; any RLS change needs a failing pgTAP test first; new functions need explicit grants (service role for attempt-style functions); students never read answer keys directly: exercise papers come only from server code, like the exam paper (`getAttemptForStudent` pattern); Next 16 patterns (`requireRole` inside `<Suspense>`, `cacheComponents`); `DESIGN.md` tokens only, light theme only, 44 px touch targets on coarse pointers, no raw hex; passwords, links and personal data never logged; one source of truth per rule (reuse list below). Staff pages `/staff/curriculums` stay admin-only; content authoring gets its own pages so the admin-only curriculum pages stay untouched.

## Design

### Authoring (admin only)
- New staff area `/staff/content` (nav item "Content", admin only): list of curriculums with book status (No book, Draft, Published, chapters, pages), and `/staff/content/[curriculumId]` with three parts: **Book** (upload or replace the PDF), **Chapters** (page strip of thumbnails with a start marker the trainer drops on a page, chapter titles, reorder is implicit by start page, delete a marker), **Exercises** (per chapter: questions, timer, pass mark, status).
- Only admins author content (owner decision, 2026-11-25: the trainer-authoring idea was dropped). Every write records `updated_by`/`updated_at`. A book has status `draft` or `published`; students only ever see published books and published exercises. Trainers have no Content area in this phase; they see their students' progress (Phase 3 journey view).
- PDF to pages: the admin's browser renders each page with `pdfjs-dist` onto a canvas, exports WebP (long edge about 1600 px, quality about 0.82; builder tunes), and uploads each image through short-lived signed upload URLs minted by a staff server action; a final action records the pages (count, size) and sets the book to draft. A progress bar shows "Converting page 12 of 48". Caps: PDF up to 50 MiB (the local Storage limit), at most 400 pages, rejected with a clear message. Replacing a PDF with a different page count keeps chapter titles but clears start pages beyond the new count and returns the book to draft.
- Chapter rules: starts strictly increasing, the first chapter starts at page 1 (front matter belongs to chapter 1), a chapter ends where the next begins, the last ends at the final page. Validation lives in one pure module.

### Storage and access
- Private bucket `book-pages`, path `{curriculum_id}/{upload_id}/{page}.webp`. No student or anon storage policy at all. Students get pages only through a server action that checks, with the session user, assignment to the curriculum and that the chapter is unlocked, then returns short-lived signed URLs (a few minutes) for that chapter's pages; the reader prefetches the next pages.
- Staff read pages through their own signed URLs for preview (admin only; trainers get no Content area in this phase).

### Data model (names are proposals; the builder owns exact DDL)
- `books` (one per curriculum: status, page_count, upload_id, updated_by/at), `book_pages` (curriculum_id, page_number, path, width, height), `chapters` (id, curriculum_id, title, start_page), `chapter_exercises` (chapter_id unique: status, time_limit_min null, pass_mark_percent, question_count null = all, shuffle), `exercise_questions` (chapter_id, position, stem_de, stem_en null, options jsonb {id, de, en?}, correct_option_id).
- `chapter_progress` (student_id, chapter_id: first_opened_at, last_page, max_page, completed_at, completed_by 'exercise' | 'read'), `reading_sessions` (student_id, chapter_id, started_at, last_seen_at, pages_viewed), `exercise_attempts` (student_id, chapter_id, started_at, submitted_at, deadline_at null, status, points, max_points, percent, passed, pass_mark snapshot) with `exercise_attempt_questions` (the drawn questions and order, per-question correct flag, selected option).
- RLS: content tables readable by all staff, writable by admin only (`is_admin()`), read-only for trainers; students have no direct access to any of these tables (server code with the service role after session checks, as with attempts). Progress and attempt tables: staff read through `private.manages_student`, writes only through service-role SQL functions (`record_page`, `start_exercise_attempt`, `submit_exercise_attempt`, `complete_chapter_read`), which re-check everything under a lock on the student's progress row. Exactly one in-progress exercise attempt per student and chapter; deadlines use database time.
- Gating is one pure function `chapterState(chapters, progress)` returning locked, open, done per chapter, mirrored by a SQL guard used by the page-link action and by `start_exercise_attempt`, so the UI and the database cannot disagree.
- Student result view for an attempt: score, percent (`formatPercent`), pass mark, and per-question right/wrong; the correct option of a question is revealed only when the student has a passed attempt for that chapter (checked server side).

### Student pages
- `/learn` (after login, students with a published book land here; others keep `/exam/start`): one pathway per assigned curriculum, nodes Chapter 1..n then "Main exam" (display only in this phase; the request button is Phase 3). `StudentHeader` gets Learn and Exams links.
- `/learn/[curriculumId]/read/[chapterId]` the reader: full-screen, spreads on wide screens and single pages on narrow ones, chapter-limited pages, thumbnails strip, page counter, keyboard and swipe, pinch zoom, a bar on the chapter's last page offering the exercise (or, with no exercise, marking the chapter complete).
- `/learn/[curriculumId]/exercise/[chapterId]` the exercise runner and result, reusing the exam client's countdown logic by extracting it into a shared hook rather than copying.
- Reader library: StPageFlip core (`page-flip`, MIT) wrapped in our own small client component, because the community React wrappers may not support React 19 (builder verifies; fallback is a CSS 3D flip component).
- Reading telemetry: a heartbeat every 30 s while the tab is visible plus page changes, sent by a server action that uses server time only.

### Motion
Path node pulse for the current chapter, progress bars filling, page curl and flip, a short unlock moment when an exercise is passed. All behind one reduced-motion rule; the exam pages stay calm as `DESIGN.md` already requires. `DESIGN.md` is updated: the reader is a documented full-screen exception to the narrow student column.

### Reuse map (no duplicates)
`percent.ts` (`formatPercent`, `meetsPassMark`, `percentValue`), `scoring.ts` pure scoring, `question-fields.ts` (extend validation with an option for optional English instead of a second validator), `csv/rows.ts` `readCsvRows` and limits, `requireRole`/`requireAdmin`, `StudentHeader`, `PageHeader`, `Skeleton`, `duration.ts`, the exam countdown, `ScoreBar`, shadcn components in `src/components/ui`, `Reveal` for entrance motion. New: book conversion module, chapter module, reader, exercise tables and functions, `/learn/*` and `/staff/content/*`.

## Slices (one plan each, in this order)

- **2A Content and reader:** storage bucket and tables, upload and conversion, chapter strip editor, signed page links, the pathway home and the reader (everything except exercises and locks; every chapter open).
- **2B Exercises and progress:** exercise editor, runner, scoring and result rules, gating, reading telemetry and attempt history for staff.

## Approaches considered

- **A (chosen):** convert in the admin's browser once, private page images, separate lightweight exercise tables reusing pure helpers.
- **B:** reuse the exam tables with an exercise flag: less code, but every exam invariant (allowance, blocking, 90% pass mark, hidden key) would have to be bypassed, a standing risk to exam integrity.
- **C:** render the original PDF live with PDF.js in the student's browser: students would receive the real file, and phones would carry the PDF engine.

## Calls made (assistant's decisions; owner may override)

Only admins author content (owner decision, 2026-11-25); a chapter without an exercise completes when the last page is reached; the first chapter holds the front matter; default exercise pass mark proposed at 80% (trainer-set per exercise); WebP at about 1600 px; 400-page and 50 MiB caps; own wrapper around `page-flip`; unlimited retries with one attempt in progress at a time; the pathway "Main exam" node is display-only until Phase 3.

## Left to the builder

Exact DDL and function bodies, image size and quality tuning after trying the real PDFs, thumbnail strategy, retry-safe upload (resume after a dropped connection), the celebration's exact motion, test fixture PDFs.

## Calls made after the builder check (assistant's decisions; owner may override)

- **One book per curriculum, 1:1.** Every curriculum may have at most one book, including "Life in Germany" (shared by the nursing and other tracks: both read the same book, progress is per student). A student with two curriculums has two independent pathways. The "Main exam" node is display-only in this phase and links nowhere.
- **Editing a published book.** Titles, exercise settings and questions can be edited in place at any time. Moving or deleting a chapter marker is allowed in place. Replacing the PDF requires unpublishing the book first (students then see "This book is being updated" and keep their progress); after re-upload the admin re-checks the chapter markers and republishes.
- **Completion is never revoked.** A chapter marked complete stays complete whatever the admin changes later: adding an exercise to a chapter already completed by reading, changing questions, or changing the pass mark (a pass mark applies to attempts started afterwards; each attempt stores its own snapshot). A student's last page is clamped to the chapter's current range. See "History is permanent" below for deletes and re-cuts.
- **History is permanent (owner requirement, 2026-11-25).** Whatever an admin changes later (chapter titles, markers, a deleted or new chapter, a replaced PDF, edited questions or pass marks), a student's recorded history never changes: completion dates, time spent per chapter, every exercise attempt with its questions and score as taken. Mechanics: a chapter is never hard-deleted once it could have history; removing it from the list **retires** it (`archived_at` set, hidden from pathways and ranges, history rows keep pointing at it; a chapter with no history may be physically deleted). The unique start-page rule applies to active chapters only. History tables (2B) reference chapters with `on delete restrict`, never cascade, and store a title snapshot per progress row and per attempt, so the history reads correctly even after renames. Attempts store their drawn questions and pass-mark snapshot (already designed). **Access never re-locks:** a student may open a chapter if the previous active chapter is complete or if they have completed any chapter after it, so inserting or re-cutting chapters cannot lock out someone who has already moved on. Replacing the PDF changes pages only; progress and attempts are untouched, and last page is clamped.
- **Content writes are admin-only.** Content tables are readable by all staff (a trainer's students' progress and attempts stay scoped through `manages_student`) and writable only through `is_admin()`. Staff can read exercise answer keys; students never can before passing.
- **Exercise drawing.** `question_count` null means every question. If a count is set, each attempt draws a random subset. `shuffle` reorders questions per attempt; options keep the trainer's order. The drawn questions and their order are stored per attempt. After a student has passed a chapter's exercise, correct answers stay visible on later attempts and in the history.
- **Reading completion for chapters without an exercise.** Jumping with the thumbnails must not bypass a chapter: the chapter completes only when the student has viewed at least 80% of its pages (each page view is recorded) and the last page is among them.
- **Exam access is unchanged.** `/exam/*` keeps working independently of reading progress until Phase 3; students with a published book land on `/learn`, with an Exams link in the header, and the proxy's home redirect and `StudentHeader` change accordingly.
- **Storage budget.** Roughly 150 to 300 KB per page image, so a 50-page book is about 10 to 15 MB. Production budget (hosted Supabase plan limits) is to be checked before launch; defaults are tuned after the real PDFs.
- **Server-side conversion fallback** is not built. If real PDFs turn out too heavy for an admin's laptop (very large scans), the cap is lowered or the fallback becomes its own task.

## Sample curriculum (received 2026-11-25)

`Deutscher_Fleischer_Berufskurs_Complete_Edition_plus_Fisch.pdf` (German butcher vocational course): 51 pages, A4 portrait (595 x 842 pt), 2.5 MB, a text-based Microsoft Word 2021 export with 11 embedded fonts and 12 images, no PDF outline or bookmarks. What this settles:
- Chapters cannot be detected automatically (no bookmarks; headings like "Kapitel 07." sit inside the running text of pages that all share one header), so the manual chapter-start strip is required, as designed.
- It is well within the caps (50 MiB, 400 pages). At about 1600 px on the long edge a page image is roughly 1130 x 1600, so a book of this size is about 10 to 15 MB of images.
- A4 portrait pages give a natural two-page spread on desktop (landscape) and one page at a time on phones; the reader must size to the page's aspect ratio, not assume a fixed one.
- It is the first end-to-end test fixture: the plan includes a test that converts this file in a real browser and checks page count, image sizes and the time taken (report it).

## Open owner decisions

None blocking. (The sample PDF is received; the real curriculum files are uploaded in the app by an admin once 2A is built.)

## Status: Slice 2A implemented (2026-11-25)

Built and covered by pgTAP, unit and e2e tests: private `book-pages` bucket and tables (migration 0028), browser-side PDF conversion and upload, chapter strip editor with permanent history (retire, never delete), publish and replace rules, signed page links (300 s, one `not_found` reason), the pathway home at `/learn`, and the full-screen reader. Every chapter is open and the Main exam node is display-only; exercises, gating, progress and telemetry are slice 2B. Details live in CLAUDE.md ("Curriculum books") and DESIGN.md.

Known gaps (small, deliberately deferred):
- `save_chapters` compares ids case-sensitively, so two ids that differ only in letter case count as different; `validateChapters` does not check that ids are UUIDs (the editor only sends valid ids or none). Note for 2B: never upsert chapters by start page, only by id.
- `mintUploadUrls` does not check that the curriculum exists (an admin could leave orphan files). A signing failure while reading shows an empty thumbnail silently.
- Reader: arrow, Home and End keys are also handled inside the page strip and the zoomed view; focus falls to the page after a thumbnail jump closes the strip; faded chrome can still be clicked; switching between spread and single page can move the exact page (3-4 becomes 3); reduced motion is read when the reader is created, not live; thumbnails are not lazy and a broken thumbnail is not handled; if a refresh after a failed image brings no new pages, later errors are ignored; the retry state is not reset if the reader is reused for another chapter within a minute.
- `/learn` redirects a student without a book only after streaming starts (a brief header flash); `/exam/start` runs one extra learning-path query for its header; the "Main exam" node copy ("Request opens when every chapter is done") describes a later mechanic and should be softened.
- Test gaps: the idle chrome fade and the reduced-motion and no-JS behaviour of the pathway are only lightly covered; the mixed-page-shape reader e2e measures against its root; no test for a one-chapter book range.
