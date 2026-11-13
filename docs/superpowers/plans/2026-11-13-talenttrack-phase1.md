# TalentTrackPlatform Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff can create students, curriculums, exam sets and questions; students log in, take a per-student randomised multiple-choice exam, and see a bilingual score once staff release it; failed-out students are blocked and visible to staff.

**Architecture:** One Next.js app (App Router, TypeScript) on Vercel; Supabase (Postgres + Auth) holds all data with row-level security. Pure TypeScript modules (`lib/draw`, `lib/scoring`) hold the exam logic so it is unit-tested without a database. Server actions do every write; the exam timer lives in the database.

**Tech Stack:** Next.js, TypeScript, Tailwind + shadcn/ui, Supabase (Postgres, Auth, RLS), Vitest, Playwright, Papa Parse (CSV).

**Spec:** `docs/superpowers/specs/2026-11-13-talenttrackplatform-design.md` (sections 1-13). Phase 1 covers goals 1-5, 7-8 and sections 4, 5 (without video), 12, 13.4, 13.5, 13.6. Out of this plan: scheduled events and login window (phase 2), video questions (phase 2), Gmail mail centre and hall tickets (phase 3), AI question drafting from PDFs (phase 4).

## Global Constraints

- Supabase project in Mumbai `ap-south-1`; Vercel region `bom1`. Production domain `talenttrackplatform.lifeplanneruniversal.com`.
- Student UI in English; exam questions and options in German; staff evaluation view and report show German and English together.
- No self sign-up. Students log in with a staff-issued username and password; staff set the first password; students are not forced to change it; only staff reset passwords.
- A second login ends the first session.
- Marks are never visible to a student until staff release the attempt. Staff cannot edit auto-scored marks.
- Retakes are never automatic: only staff grant attempts. A granted attempt never reuses questions that student has already been given; staff are told when the pool is too small.
- A student who fails their last allowed attempt is blocked; blocked students appear on a Blocked page and a dashboard summary.
- Curriculum is complete when passed; any order unless staff set one.
- Timer enforced on the server; answers saved continuously; auto-submit at expiry.
- Consent acceptance recorded with a timestamp before a student's first exam.
- Responsive at 375px and desktop; shadcn components; visible focus states; real empty, loading and error states.
- No attribution lines in commits or PRs (settings.json attribution is empty).
- Every task: use TDD, look up library docs with Context7 before using a library API, and add a Monday log item (board 5032458950: https://developerlifeplanners-team.monday.com/boards/5032458950) when the task finishes.

## Review Focus

Failure modes the spec implies but did not pin; each has a test in the owning task.
1. Student refreshes or reopens the exam mid-attempt: same paper, same option order, same deadline (Task 5).
2. Pool has fewer unseen questions than the configured count: clear error to staff, nothing half-created (Tasks 3, 8).
3. Staff CSV from Excel: UTF-8 BOM, German umlauts and ß, blank rows, duplicate questions, rows with no valid correct option (Task 4).
4. Student opens a result URL, or queries the API directly, before release or for someone else's attempt (Tasks 1, 6).
5. Double submit, or submit arriving after the deadline, must score once and honour the deadline (Task 5).

---

## File Structure

- `lib/types.ts` shared types. `lib/draw.ts` paper draw. `lib/scoring.ts` scoring.
- `lib/auth/` username mapping and role helpers. `lib/csv/` question and student CSV parsers.
- `supabase/migrations/` schema and RLS. `supabase/tests/` SQL policy tests.
- `app/(staff)/...` staff pages. `app/(student)/...` student pages. `app/login`.
- `e2e/` Playwright tests.

### Task 1: Scaffold, environments and schema with RLS

**Files:**
- Create: Next.js app at repo root, `CLAUDE.md` (stack, commands), `supabase/migrations/0001_schema.sql`, `supabase/tests/rls.test.sql`, `vitest.config.ts`
- Modify: git init the folder; `.gitignore`

**Interfaces:**
- Produces tables: `profiles(id, role 'staff'|'student', username, full_name, batch, track, consent_at)`, `curriculums(id, name)`, `exam_sets(id, curriculum_id, name, question_count, time_limit_min, pass_mark_percent, max_attempts, hold_result bool, topic_mix jsonb)`, `questions(id, exam_set_id, topic, difficulty, stem_de, stem_en, options jsonb, correct_option_id, points, status 'draft'|'approved')`, `assignments(id, student_id, curriculum_id, position, status 'open'|'passed'|'blocked')`, `attempts(id, student_id, exam_set_id, status 'in_progress'|'submitted'|'released', started_at, deadline_at, submitted_at, granted_by, points, max_points, passed, released_at)`, `attempt_questions(id, attempt_id, question_id, position, option_order text[])`, `answers(attempt_question_id, option_id, saved_at)`, `attempt_grants(id, student_id, exam_set_id, granted_by, used_attempt_id)`.

- [ ] **Step 1:** `git init`, scaffold Next.js (TypeScript, Tailwind, App Router), install shadcn, Vitest, Playwright; write `CLAUDE.md`. Run `npm run build` and expect success.
- [ ] **Step 2:** Create two Supabase projects (dev and prod, region Mumbai) with the Supabase connector; link the dev one. Record ids in `CLAUDE.md`.
- [ ] **Step 3:** Write `supabase/tests/rls.test.sql` first: a student cannot select another student's attempts; a student cannot select `points`/`passed` of an attempt whose status is not `released`; a student cannot read `correct_option_id`; staff can read everything.
- [ ] **Step 4:** Run the policy test and see it fail; then write `0001_schema.sql` (tables above plus RLS policies; expose student-safe question columns through a view without `correct_option_id`). Run again and expect PASS; run Supabase advisors and fix any finding.
- [ ] **Step 5:** Commit.

### Task 2: Login, roles, sessions and consent

**Files:**
- Create: `lib/auth/username.ts`, `lib/auth/username.test.ts`, `app/login/page.tsx`, `middleware.ts`, `app/(student)/consent/page.tsx`
- Test: `lib/auth/username.test.ts`, `e2e/login.spec.ts`

**Interfaces:**
- Produces: `usernameToEmail(username: string): string` (lowercase, trimmed, `<username>@students.talenttrack.internal`), `requireRole(role: 'staff'|'student'): Promise<Profile>`.

- [ ] **Step 1:** Write failing tests: `usernameToEmail('  Anu.K ')` returns `anu.k@students.talenttrack.internal`; spaces inside throw.
- [ ] **Step 2:** Implement, run, expect PASS.
- [ ] **Step 3:** Login page (username + password; staff use email + password) with English copy and error state; on student login call sign-out of other sessions (`scope: 'others'`). Middleware sends unauthenticated users to `/login`, students to `/consent` until `consent_at` is set, and staff/student to their own areas.
- [ ] **Step 4:** Playwright: student logs in, accepts consent, and is redirected straight to the start page of their next open curriculum exam (lowest `position`, status `open`); a student visiting `/staff` is redirected; a second login invalidates the first session. Expect PASS at 375px and desktop.
- [ ] **Step 5:** Commit.

### Task 3: Draw engine (pure)

**Files:**
- Create: `lib/types.ts`, `lib/draw.ts`
- Test: `lib/draw.test.ts`

**Interfaces:**
- Produces: `drawPaper(input: { pool: Question[]; seenIds: Set<string>; count: number; topicMix?: Record<string, number>; rng: () => number }): { questionId: string; optionOrder: string[] }[]` and `class InsufficientPoolError extends Error { available: number; needed: number }`. Only `status === 'approved'` questions are eligible.

- [ ] **Step 1:** Failing tests, each its own test: returns exactly `count` unique questions; never returns an id in `seenIds`; honours `topicMix` (`{ anatomy: 2, care: 3 }` with count 5 gives 2 and 3); different seeded `rng` values give different papers; option order is a permutation of the question's option ids; draft questions are never drawn; fewer eligible than `count` throws `InsufficientPoolError` with `available` and `needed` set.
- [ ] **Step 2:** Run, expect FAIL. Implement with a Fisher-Yates shuffle driven by `rng`. Run, expect PASS.
- [ ] **Step 3:** Commit.

### Task 4: Scoring (pure) and question CSV parsing

**Files:**
- Create: `lib/scoring.ts`, `lib/csv/questions.ts`
- Test: `lib/scoring.test.ts`, `lib/csv/questions.test.ts`

**Interfaces:**
- Produces: `scoreAttempt(questions: Question[], answers: Record<string, string | null>, passMarkPercent: number): { points: number; max: number; percent: number; passed: boolean; byTopic: Record<string, { points: number; max: number }> }` and `parseQuestionsCsv(text: string): { valid: NewQuestion[]; errors: { row: number; message: string }[] }`. CSV columns: `topic,difficulty,stem_de,stem_en,option_a_de,option_a_en,...option_d_de,option_d_en,correct,points`.

- [ ] **Step 1:** Failing scoring tests: all correct gives 100 and passed; unanswered counts zero; `passMarkPercent` boundary (exactly equal passes); points weights; `byTopic` sums equal the totals.
- [ ] **Step 2:** Failing CSV tests: UTF-8 BOM is stripped; `ä ö ü ß` survive; blank rows skipped; `correct` not in a..d is an error naming the row; missing English text is an error; duplicate `stem_de` within the file is an error; a valid file of 3 rows returns 3 valid and 0 errors.
- [ ] **Step 3:** Implement both (Papa Parse for CSV); run, expect PASS.
- [ ] **Step 4:** Commit.

### Task 5: Attempt lifecycle (start, resume, save, submit)

**Files:**
- Create: `lib/attempts.ts`, `app/(student)/exam/[attemptId]/page.tsx`, `app/(student)/exam/actions.ts`
- Test: `lib/attempts.test.ts` (against the dev database), `e2e/exam.spec.ts`

**Interfaces:**
- Consumes: `drawPaper`, `scoreAttempt`.
- Produces: `startAttempt(studentId: string, examSetId: string): Promise<{ attemptId: string }>` (requires an unused grant, draws with the student's previously seen question ids, stores `attempt_questions`, sets `deadline_at = started_at + time_limit_min`); `saveAnswer(attemptId: string, attemptQuestionId: string, optionId: string): Promise<void>` (rejects after `deadline_at`); `submitAttempt(attemptId: string): Promise<void>` (idempotent, scores once, sets `submitted`, then `released` immediately only when `hold_result` is false); `sweepExpired(): Promise<number>` (submits every in-progress attempt past its deadline).

- [ ] **Step 1:** Failing tests: resuming an in-progress attempt returns the same questions and option order and the same deadline; `saveAnswer` after the deadline throws; `submitAttempt` twice leaves one score and one state change; a submit after the deadline scores only answers saved before the deadline; `sweepExpired` submits only expired attempts; `startAttempt` with no grant throws.
- [ ] **Step 2:** Run, expect FAIL. Implement with database transactions; the deadline is compared with database time, never client time.
- [ ] **Step 3:** Exam page: one question at a time, German text with English interface chrome, countdown from the server deadline, answer autosave on select, a confirm dialog on submit, an offline banner. Add a Vercel cron route calling `sweepExpired` every minute plus a lazy expiry check when an attempt is read.
- [ ] **Step 4:** Playwright: take a 3-question exam at 375px and desktop, refresh mid-way and see the same paper. Expect PASS.
- [ ] **Step 5:** Commit.

### Task 6: Results, release and student result page

**Files:**
- Create: `app/(student)/results/[attemptId]/page.tsx`, `app/(staff)/review/page.tsx`, `lib/release.ts`
- Test: `lib/release.test.ts`, `e2e/results.spec.ts`

**Interfaces:**
- Produces: `releaseAttempt(attemptId: string, staffId: string): Promise<void>` (only from `submitted`; sets `released_at`, `status = 'released'`; if passed marks the assignment `passed`, else applies the Task 7 blocking rule via `applyOutcome(attemptId)`).

- [ ] **Step 1:** Failing tests: a student reading a `submitted` attempt's points gets nothing (RLS); a student cannot read another student's released attempt; release of an already released attempt is a no-op; staff cannot change `points`.
- [ ] **Step 2:** Implement; the student page shows "awaiting review" until released, then score, pass or fail and per-topic breakdown in English and German. Staff review page lists submitted attempts with a bilingual question-by-question evaluation view (German and English side by side) and a Release button. Print stylesheet gives a bilingual printable report.
- [ ] **Step 3:** Run tests and Playwright (staff releases, student then sees score). Expect PASS.
- [ ] **Step 4:** Commit.

### Task 7: Blocking, grants and the dashboard

**Files:**
- Create: `lib/outcome.ts`, `app/(staff)/dashboard/page.tsx`, `app/(staff)/blocked/page.tsx`, `app/(staff)/grants/actions.ts`
- Test: `lib/outcome.test.ts`

**Interfaces:**
- Produces: `applyOutcome(attemptId: string): Promise<void>` (on a failed released attempt, if the student has used `max_attempts` grants for that set, set the assignment to `blocked`); `grantAttempt(studentId: string, examSetId: string, staffId: string): Promise<{ ok: true } | { ok: false; unseenAvailable: number; needed: number }>` (checks that enough unseen approved questions exist, otherwise returns the shortfall and creates nothing).

- [ ] **Step 1:** Failing tests: failing the last allowed attempt blocks; failing with attempts left does not; a pass marks the assignment passed; `grantAttempt` with too few unseen questions returns the shortfall and writes no grant; a second grant after a block unblocks.
- [ ] **Step 2:** Implement. Dashboard: counts of students by status, a "Blocked" summary card with the first five blocked students linking to the Blocked page, submitted attempts awaiting review. Blocked page lists every blocked student with curriculum, attempts used, last score and a Grant attempt / Reassign action.
- [ ] **Step 3:** Run tests; Playwright: fail twice, see blocked on both pages, grant, student can start. Expect PASS.
- [ ] **Step 4:** Commit.

### Task 8: Staff management: students, curriculums, exam sets, questions

**Files:**
- Create: `app/(staff)/students/`, `app/(staff)/curriculums/`, `app/(staff)/questions/`, `lib/csv/students.ts`
- Test: `lib/csv/students.test.ts`, `e2e/staff.spec.ts`

**Interfaces:**
- Produces: `parseStudentsCsv(text: string): { valid: { username: string; fullName: string; batch: string; track: 'nursing'|'other'; password: string }[]; errors: { row: number; message: string }[] }`; server actions `createStudent`, `resetPassword`, `assignCurriculum`, `removeCurriculum`, `saveExamSet`, `saveQuestion`, `importQuestions`.

- [ ] **Step 1:** Failing tests for `parseStudentsCsv`: duplicate usernames, blank password, unknown track, BOM handling.
- [ ] **Step 2:** Implement; build the pages with shadcn tables and forms. Creating a student with track `nursing` assigns Pflege Ausbildung and Life in Germany; any other track assigns Life in Germany; staff can add or remove any curriculum per student afterwards. Exam set form exposes question count, topic mix, time limit, pass mark, max attempts and hold-result. Question page supports manual bilingual entry, approve/draft status, and CSV import showing row errors before anything is saved.
- [ ] **Step 3:** Playwright: create a student, import 20 questions, assign, log in as that student. Expect PASS at 375px and desktop.
- [ ] **Step 4:** Commit.

### Task 9: Design pass, deploy and end-to-end check

**Files:**
- Create: `DESIGN.md` (via the design-md skill), `e2e/full-flow.spec.ts`
- Modify: shared UI styles from the chosen direction

- [ ] **Step 1:** Run ui-ux-pro-max and frontend-design for a calm, trustworthy exam look; apply tokens across pages; keep contrast and focus states.
- [ ] **Step 2:** Create the Vercel project with region `bom1`, set env vars, deploy a preview; add `talenttrackplatform.lifeplanneruniversal.com` to the project and give the owner the CNAME to add in Cloudflare (DNS only).
- [ ] **Step 3:** Full-flow Playwright on the preview: staff creates student and exam, student takes it, staff releases, student sees the bilingual score, blocked flow works. Expect PASS at 375px and desktop.
- [ ] **Step 4:** Run security-review, the Supabase advisors, and CodeRabbit review; fix findings. Log results to Monday and hand the preview URL to the owner.
