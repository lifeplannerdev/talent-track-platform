# Spec change 1 Implementation Plan (immediate marks, 2 attempts per curriculum, independent curriculums)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the marks-release layer and video, give every student 2 attempts per curriculum without approval (staff add extras), make each curriculum an independent card, and never repeat an exam set within a curriculum.

**Architecture:** Attempt allowance is `curriculums.max_attempts` (default 2) + `assignments.extra_attempts`, computed and enforced inside the SQL functions under the assignment row lock (lock order assignment -> attempts, as in CLAUDE.md). TypeScript picks the exam set (random among unused, or least recently used when staff set `allow_repeats`) and draws the paper, then calls `start_attempt`, which re-validates everything under the lock. Scoring releases in the same transaction as `record_score`; blocking and passing are decided there per curriculum.

**Tech Stack:** Next.js 16, Supabase local (Postgres, pgTAP), Vitest, Playwright (existing).

**Spec:** `docs/superpowers/specs/2026-11-18-immediate-marks-attempts-design.md` (amends `2026-11-13-talenttrackplatform-design.md`). Read `CLAUDE.md` and `DESIGN.md` first. Branch `spec-change-1` (off `percent-first`, which holds ui-polish, exam-controls and percent-first).

## Global Constraints
- No video capture anywhere; strike it from the spec/plan docs (no code existed).
- Marks visible to the student immediately after submit or expiry; no hold, no release step, no "awaiting review". Review panel stays, read-only. Students still never see the answer key or per-question results (topic totals only).
- Default 2 attempts per curriculum, no approval; blocked only after the last allowed attempt fails; staff give extra attempts (any time, `n` 1..10) which also unblocks.
- Many exam sets per curriculum stay. One attempt = one exam set; the same exam set is never used twice in a curriculum for a student unless staff set `allow_repeats`.
- Curriculums are independent: separate cards, attempts, percentage, pass, block; any order; no cross-curriculum locks or sequencing.
- Percent-first display, 90% default pass mark, pass-mark snapshot on attempts, reminder popup, duration controls: unchanged.
- Security rules unchanged: `requireRole`/`requireStudentWithConsent` in every action, identity from session, attempt writes only via service-role SQL functions (search_path empty, revoked from PUBLIC/anon/authenticated, granted to service_role), pgTAP failing test first for any SQL/RLS change, RLS on every table, no passwords in logs.
- TDD, focused commits, no attribution lines, nothing pushed or deployed, local Supabase only. Keep existing test ids unless a task deliberately changes them (update the tests in the same task).

## Review Focus
- Two concurrent `start_attempt` calls for the same student and curriculum (different exam sets): exactly one starts.
- Curriculum with fewer exam sets than attempts allowed: student sees "contact your trainer"; staff see a warning; `allow_repeats` unlocks.
- Student fails attempt 2 of 2: result visible at once AND assignment blocked in the same transaction; extra attempt unblocks; a pass after extras sets `passed`.
- Submit/expiry racing (double submit, sweep, lazy expiry): attempt scored and released once; blocking counted once.
- Student with two curriculums, one passed one blocked: each card independent; results list per curriculum; nothing leaks across.
- A submitted but unscored attempt (crash between close and score) shows "being calculated", not a score, and heals on the next read/sweep.

---

### Task 1: Schema and attempt functions (migrations 0020, 0021)

**Files:**
- Create: `supabase/migrations/0020_immediate_marks_curriculum_attempts.sql`, `supabase/migrations/0021_extra_attempts.sql`
- Create: `supabase/tests/immediate_marks.test.sql`, `supabase/tests/extra_attempts.test.sql`
- Modify: existing pgTAP files that reference `hold_result`, `max_attempts`, `attempt_grants`, `grant_attempt`, `release_attempt` (`attempt_functions`, `blocking_grants`, `final_review`, `percent_first`, `rls`, `assignment_functions`): update or replace assertions deliberately; keep every guarantee still true.

**Interfaces:**
- Produces (SQL, service_role only): `start_attempt(p_student_id uuid, p_exam_set_id uuid, p_draw jsonb) returns uuid`; errors (typed messages, as today): `not_open`, `blocked`, `passed`, `no_attempts_left` (used >= max_attempts + extra_attempts), `exam_set_used` (same exam set already used in this curriculum and not `allow_repeats`), `in_progress` (an attempt is in progress in this curriculum), plus the existing draw/snapshot errors. `record_score(...)` (same parameters as 0019) scores, releases (status `released`, `released_at = now()`), and in the same transaction sets the assignment: pass -> `passed`; fail and used >= allowance -> `blocked`. `give_extra_attempts(p_staff_id uuid, p_student_id uuid, p_curriculum_id uuid, p_n integer, p_allow_repeats boolean) returns void`: staff only (`not_staff`), `n` 1..10 (`invalid_n`), locks the assignment FOR UPDATE, adds `n` to `extra_attempts`, sets `allow_repeats` when true, sets status `open` if it was `blocked`, refuses if `passed` (`already_passed`).
- Used attempts = the student's attempts with status `submitted` or `released` over all exam sets of the curriculum (in_progress does not count until submitted).

- [ ] **Step 1: Write failing pgTAP** covering: `curriculums.max_attempts` defaults to 2; `exam_sets` has no `hold_result`/`max_attempts`; `assignments.extra_attempts` default 0 and `allow_repeats` default false; start without any grant succeeds twice (two different exam sets), third start raises `no_attempts_left`; second start on the same exam set raises `exam_set_used` unless `allow_repeats`; start refuses `not_open`/`blocked`/`passed`; `in_progress` while another attempt in the curriculum is in progress; `record_score` of a failed 2nd attempt leaves attempt `released` with points set and assignment `blocked`; a failed 1st attempt leaves assignment `open`; a pass sets `passed`; `give_extra_attempts` unblocks, validates n, refuses non-staff and passed; EXECUTE grants (service_role only, none for PUBLIC/anon/authenticated) on the new/changed functions; `student_assignments` no longer masks status; `student_attempts` shows points for released attempts and nothing for in-progress.
- [ ] **Step 2: Run `npm run db:test`** and confirm the new tests fail for the right reasons.
- [ ] **Step 3: Implement migration 0020** (additive then destructive, in one transaction): add `curriculums.max_attempts int not null default 2 check (max_attempts between 1 and 20)`; add `assignments.extra_attempts int not null default 0 check (>= 0)` and `allow_repeats boolean not null default false`; convert each unused `attempt_grants` row into `+1 extra_attempts` on the matching assignment; release every `submitted` attempt that has points (via the same logic as `record_score`, `released_by` null); replace `start_attempt`, `record_score`, `student_assignments` (no hold masking); drop `release_attempt`, `grant_attempt`, table `attempt_grants`, columns `exam_sets.hold_result` and `exam_sets.max_attempts`. Preserve every guarantee from 0004/0013/0015/0017/0019 (assignment locked FOR UPDATE first, unique in-progress index, db `now()`, pass-mark snapshot, empty search_path, explicit grants). Document lock order in the header.
- [ ] **Step 4: Implement migration 0021**: `give_extra_attempts` with the grants above; update `remove_curriculum` (0016) so it no longer touches grants.
- [ ] **Step 5: Run `npm run db:reset` then `npm run db:test` and `npm run db:lint`**; expected: all pgTAP pass (updated old tests included), lint clean.
- [ ] **Step 6: Commit** `feat: immediate marks and per-curriculum attempts in the database (0020, 0021)`.

### Task 2: Server library (attempts, exam-start state, extra attempts, results)

**Files:**
- Modify: `src/lib/attempts.ts`, `src/lib/exam-start.ts`, `src/lib/results.ts`, `src/lib/review.ts`, `src/lib/staff-overview.ts`, `src/lib/staff-overview-core.ts`, `src/lib/staff-manage.ts`, `src/lib/exam-set-fields.ts` (+ tests), `src/app/(student)/exam/actions.ts`
- Create: `src/lib/extra-attempts.ts` (+ test), `src/lib/exam-set-choice.ts` (+ test)
- Delete: `src/lib/release.ts`, `src/lib/grants.ts` and their tests (replace with the new modules' tests)

**Interfaces:**
- Produces: `chooseExamSet(sets: {id: string; lastUsedAt: string | null}[], usedIds: Set<string>, allowRepeats: boolean, random: () => number): string | null` (pure: random unused set; with `allowRepeats` and none unused, the least recently used; else null). `startAttempt(studentId: string, curriculumId: string)` (replaces the exam-set parameter; reads sets and used ids, chooses, draws with `drawPaper`, calls `start_attempt`, maps SQL errors to a typed `StartError` incl. `no_attempts_left`, `exam_set_used`, `unavailable` when no set can be chosen or the pool is too small). `giveExtraAttempts(staffId: string, studentId: string, curriculumId: string, n: number, allowRepeats: boolean)` wrapping the SQL function with `requireRole('staff')` in the calling action. `getExamStartState(studentId)` returns one card per assigned curriculum: `{ curriculumId, name, position, kind: 'ready' | 'in_progress' | 'passed' | 'blocked' | 'unavailable' | 'calculating', attemptsLeft: number, attemptId?: string }` (list ordered by position; no cross-curriculum coupling; `calculating` when the latest attempt is submitted but unscored). `submitAttempt` returns the scored, released result; no hold branch anywhere.
- Consumes: SQL functions from Task 1.

- [ ] **Step 1: Write failing tests**: `chooseExamSet` (random among unused with injected `random`; none unused and not allowRepeats -> null; allowRepeats -> least recently used; empty list -> null); `startAttempt` against the local stack (two attempts get two different exam sets; third refused `no_attempts_left`; concurrent double start for one student and curriculum yields exactly one; `allow_repeats` reuses; unavailable pool); `getExamStartState` cards for: fresh student with two curriculums (both `ready`, attemptsLeft 2 each, any order), one passed/one blocked independent, in-progress, calculating, unavailable; submit result visible immediately and blocks after the last failed attempt; `giveExtraAttempts` (unblocks, increments, validates); exam set validation no longer accepts `holdResult`/`maxAttempts`, accepts curriculum `maxAttempts` 1..20 via a new `validateCurriculumFields`.
- [ ] **Step 2: Run `npm test`** and confirm failures are the intended ones.
- [ ] **Step 3: Implement** the modules above following existing patterns (service role only in server modules with `server-only`, session client for staff readers). Staff readers (`review.ts`, `staff-overview*`, `staff-manage.ts`) drop hold/awaiting-review concepts: results lists show all attempts; blocked list and extra-attempts list use per-curriculum allowance and unused-exam-set counts (`examSetsLeft`).
- [ ] **Step 4: Run `npm run lint` and `npm test`**; expected: all pass.
- [ ] **Step 5: Commit** (focused commits per module group).

### Task 3: Student interface

**Files:**
- Modify: `src/app/(student)/exam/start/page.tsx`, `src/app/(student)/exam/actions.ts`, `src/app/(student)/exam/[attemptId]/*`, `src/app/(student)/results/[attemptId]/*`, `src/lib/greeting.ts` copy where it mentions waiting, related tests

**Interfaces:**
- Consumes: `getExamStartState`, `startAttempt(studentId, curriculumId)` from Task 2. `startExam(curriculumId: string)` server action (calls `requireStudentWithConsent`, identity from session, redirects to the new attempt).

- [ ] **Step 1: Write failing component/unit/e2e-level tests** for each card kind (copy and test ids: `curriculum-card`, `start-exam`, `resume-exam`, `attempts-left`, `contact-trainer`, `calculating`), results list per curriculum (percentage first), submit lands on `/results/[id]` showing the percentage immediately (no "awaiting review" page or copy anywhere).
- [ ] **Step 2: Run them; expect failure.**
- [ ] **Step 3: Implement** the start page as a responsive grid of curriculum cards in `position` order (DESIGN.md patterns, mobile-first, no raw hex), the immediate redirect after submit and expiry, removal of awaiting-review/waiting states and the old copy. Update the exam intro text to say how many attempts are left and that the result is shown immediately.
- [ ] **Step 4: Run lint, unit tests, `npm run build`.**
- [ ] **Step 5: Commit.**

### Task 4: Staff interface

**Files:**
- Modify: `src/app/staff/review/*` (read-only: remove the Release button, `releaseAttemptAction` and `ReleaseStatus` hold wording; page titled "Attempts"), `src/app/staff/grants/*` (becomes "Extra attempts": `giveExtraAttemptsAction`, form with number 1..10 and "Allow repeating exam sets" toggle, lists of blocked students and students short of exam sets), `src/app/staff/curriculums/*` (curriculum page: "Attempts per student" field; exam set form loses Hold results and Maximum attempts; summary line updated; warnings: fewer exam sets than attempts allowed, approved questions < question count per set), `src/app/staff/students/[id]/*` (per curriculum attempts used/allowance, extra attempts action, results), `src/app/staff/page.tsx` (dashboard counts), `staff-nav.tsx` (labels), messages and tests (`content.test.ts`, `messages.test.ts`)

**Interfaces:**
- Consumes: `giveExtraAttempts` from Task 2. `saveCurriculum` accepts `maxAttempts` (validated 1..20). Each action calls `requireRole('staff')` and takes plain objects returning `{ ok, ... }` as elsewhere.

- [ ] **Step 1: Write failing tests** (unit for validation and messages; e2e for: staff set attempts per student, extra attempts unblock a blocked student, review page has no Release control and still shows the bilingual evaluation, exam set form has no hold/max-attempts controls).
- [ ] **Step 2: Run; expect failure.**
- [ ] **Step 3: Implement** with shadcn components and DESIGN.md; keep the warning that edits during an exam affect in-progress attempts only where still true.
- [ ] **Step 4: Run lint, tests, build.**
- [ ] **Step 5: Commit.**

### Task 5: Fixtures, e2e flows, demo data, documentation

**Files:**
- Modify: `e2e/seed.ts`, `e2e/fixtures.ts`, `e2e/*.spec.ts` (full-flow, blocking, exam, results, staff, exam-controls, design), scratchpad `demo-seed.mjs` (outside repo; also make `scripts` unaffected), `CLAUDE.md`, `DESIGN.md`, `docs/superpowers/specs/2026-11-13-talenttrackplatform-design.md` (remove video capture, release layer, one-exam-at-a-time, sequential-curriculum text; add a pointer to the 2026-11-18 amendment), `docs/superpowers/plans/2026-11-13-talenttrack-phase1.md` (note superseded parts), `docs/design-review/*` screenshots

- [ ] **Step 1: Rewrite fixtures and seeds** (curriculums with `max_attempts` 2, several exam sets where a retry is tested, no grants, no hold) and the e2e flows: student with two curriculums takes either first; fails twice in one curriculum and is blocked while the other stays open; extra attempts unblock; result percentage shown immediately; review panel read-only; second attempt gets a different exam set.
- [ ] **Step 2: Run the full e2e suite; fix failures** (delete `.next` if CSS looks stale). Axe stays 0 serious/critical, no horizontal overflow at 375.
- [ ] **Step 3: Update docs**: CLAUDE.md sections (Attempts lifecycle, Results and release, Blocking and grants, Staff management, Production checklist: migrations 0001-0021, `extra_attempts` replaces grants), DESIGN.md if card patterns changed, spec/plan notes, screenshots refreshed.
- [ ] **Step 4: Full verification**: `npm run lint`, `npm test`, `npm run db:reset` + `npm run db:test` + `npm run db:lint`, `npm run build`, `npm run test:e2e`; recreate local demo data (two curriculums with several exam sets) so the owner can click through.
- [ ] **Step 5: Commit.**
