# TalentTrackPlatform

Exam platform for Life Planner students (Kerala, India). Spec: `docs/superpowers/specs/2026-11-13-talenttrackplatform-design.md`. Phase 1 plan: `docs/superpowers/plans/2026-11-13-talenttrack-phase1.md`.

## Stack
Next.js 16 (App Router, TypeScript, Tailwind 4), shadcn/ui (Base UI), Supabase (Postgres, Auth, Storage), Vitest, Playwright. Versions are pinned in `package.json`.

## Environments
- Development uses the LOCAL Supabase stack through Docker. No remote Supabase project is created, linked or touched by this repo yet (the existing "lp website" project belongs to another site).
- Production target (later): Supabase in Mumbai (ap-south-1), Vercel region bom1.
- Env vars: copy `.env.example` to `.env.local`. Local API URL is `http://127.0.0.1:54321`; keys come from `npx supabase status`. Only `.env.example` is committed.

## Commands
- `npm run dev` / `npm run build` / `npm run lint`
- `npm test` (Vitest; `src/lib/attempts.test.ts` and the cron route test need the local stack running), `npm run test:e2e` (Playwright; run `npx playwright install` once first)
- `npm run db:start` / `db:stop` (Docker must be running)
- `npm run db:reset` re-applies `supabase/migrations/*` to the local database
- `npm run db:test` runs pgTAP tests in `supabase/tests/` (RLS and privacy rules)
- `npm run db:lint` lints the local schema (must report no errors)

## Data and security conventions
- Every public table has RLS. Anon has no privileges.
- Students never read `questions`, `attempts` or `assignments` directly. They use the views `student_assignments` (status masked to open while a held attempt is submitted), `student_questions` (no `correct_option_id`) and `student_attempts` (points, max_points, passed are NULL until status = 'released').
- Staff can read everything but cannot write `attempts`, `attempt_questions`: scoring, release and attempt creation run in server code with the service role.
- Profiles are created by the `on_auth_user_created` trigger from `raw_app_meta_data` (role, username, full_name, batch, track), which only the admin API can set. The trigger is a deferred constraint trigger (0003) because the Auth admin API sets app metadata after the insert. Usernames map to internal emails via `usernameToEmail` (`username@students.talenttrack.internal`). Public sign-up is off.
- Questions: German with English translations (`stem_de`, `stem_en`, options `{id, de, en}`).
- Any change to RLS needs a failing test in `supabase/tests/rls.test.sql` first.

## Attempts (exam lifecycle)
- `src/lib/attempts.ts` (server only, service role): `startAttempt`, `getAttemptForStudent` (resume), `saveAnswer`, `submitAttempt`, `sweepExpired`. Callers authenticate with `requireRole('student')` and pass the session user id, never a client id.
- Atomic writes are SQL functions from `0004_attempt_lifecycle.sql` and `0005_release_attempt.sql` (`start_attempt`, `save_answer`, `close_attempt`, `close_expired_attempts`, `record_score`, `release_attempt`, `db_now`), executable only by `service_role`. Deadlines use database `now()`.
- Students cannot write `answers` directly any more; saves go through the `saveAnswerAction` server action.
- Submit = close (in_progress -> submitted) then score once with `scoreAttempt` (`record_score` guards `points is null`). Release is the SQL function `release_attempt` (0005): submitted with a score -> released and, if passed, the assignment set to 'passed' in the same transaction; idempotent. `record_score` calls it for non-held sets; staff release (Task 6) and blocking (Task 7) belong in it too. Held sets change nothing student-visible until release.
- Scoring snapshot (0007): `record_score(p_attempt_id, p_points, p_max_points, p_passed, p_questions)` also stores, per attempt question, the key, points, topic and awarded points that `scoreAttempt` used (`attempt_questions.correct_option_id/max_points/topic/awarded_points`). It rejects a snapshot that does not cover exactly the attempt's questions or does not add up to the totals (`invalid_snapshot`). Readers of per-question or per-topic results use only these columns, never live `questions`, because staff may edit questions after scoring. The columns are staff-only (attempt_questions has no student policy).
- `release_attempt(p_attempt_id, p_released_by)` (0006) records the releasing staff id in `attempts.released_by` (null for the automatic release); it refuses a non-staff releaser and never overwrites an earlier release. The failed branch is where Task 7's blocking rule goes.

## Results and release (Task 6)
- Staff: `/staff/review` lists submitted (held) attempts; `/staff/review/[attemptId]` is the bilingual evaluation view with the Release button. Readers in `src/lib/review.ts` use the staff session (RLS). `releaseAttemptAction` (`src/app/staff/review/actions.ts`) calls `requireRole('staff')` and `releaseAttempt(attemptId, profile.id)` (`src/lib/release.ts`, service role). It takes only the attempt id; points are never writable.
- Student: `/results/[attemptId]` uses `getStudentResult` (`src/lib/results.ts`): the `student_attempts` view through the session client; before release no numbers at all. After release the per-topic breakdown is read from the scoring snapshot with the service role only after re-checking owner and status, and only topic totals are returned (no key, no per-question results). The released report is bilingual and has a print stylesheet (`print:` variants plus `@media print` in globals.css).
- `notFound()` inside a Suspense boundary renders the not-found UI with HTTP 200 (streaming); tests check for absence of data, not the status.
- Expiry is lazy (on every read/save of an attempt); `/api/cron/sweep` (Bearer `CRON_SECRET`, exempt from the proxy) is a daily backup because Vercel Hobby only allows daily crons.

## Blocking and grants (Task 7)
- Blocking lives in `release_attempt` (0008): on a failed release, when attempts used (the student's attempts for that exam set with status 'submitted' or 'released', counted at release) >= `max_attempts`, the assignment goes 'open' -> 'blocked'. Written only at release, so a held result never shows a block early. A pass sets 'passed'; 'passed' is never downgraded.
- Attempts are only ever made available by staff: `grantAttempt(studentId, examSetId, staffId)` (`src/lib/grants.ts`, service role) wraps the SQL function `grant_attempt` (0008, service role only). It checks staff, assignment, not passed, nothing in progress and no held result (`result_pending`) on any exam set of the curriculum (0009, per curriculum because blocking is), no unused grant (no stacking, typed `GrantError`; but a blocked student who already holds one is unblocked and ok is returned, so staff can always recover), and enough unseen approved questions (per topic when `topic_mix` is set); otherwise it returns `{ ok: false, unseenAvailable, needed }` and writes nothing. A grant after a block also sets the assignment back to 'open' in the same transaction.
- Staff pages: `/staff` dashboard, `/staff/blocked`, `/staff/grants` (readers in `src/lib/staff-overview.ts`, session client and RLS; pure logic in `src/lib/staff-overview-core.ts`); `grantAttemptAction` in `src/app/staff/grants/actions.ts`. The "Reassign curriculums" link points at `/staff/students/[id]` (Task 8).

## Staff management (Task 8)
- Pages: `/staff/students` (search, batch/track filter, Add student, Import CSV with preview), `/staff/students/[id]` (curriculums with order, status, attempts; add/remove/reorder; grant shortcut via `GrantButton`; reset password), `/staff/curriculums`, `/staff/curriculums/[id]` (exam set settings), `/staff/questions` (filters, pool sizes vs 3 x question_count, manual bilingual form, approve/draft, CSV import). Readers in `src/lib/staff-manage.ts` (staff session, RLS).
- Actions (each calls `requireRole('staff')`, takes plain objects, returns `{ ok, ... }`): `students/actions.ts` (`createStudent`, `previewStudentsImport`, `importStudents`, `resetPassword`, `assignCurriculum`, `removeCurriculum`, `reorderCurriculums`), `curriculums/actions.ts` (`saveCurriculum`, `saveExamSet`), `questions/actions.ts` (`saveQuestion`, `setQuestionStatus`, `previewQuestionsImport`, `importQuestions`). Writes use the staff session except auth users and passwords (Auth admin API, `src/lib/staff-students.ts`).
- New students: auth user with app_metadata `{ role: 'student', username, full_name, batch?, track }`; track `nursing` gets "Pflege Ausbildung" (1) and "Life in Germany" (2), `other` gets "Life in Germany" (seeded by migration 0010, looked up by their fixed ids, so renaming is safe). If assignments fail the user is deleted again. Passwords are never logged, put in URLs or returned; tests assert results never contain them.
- `resetPassword` changes the password with the admin API, then ends every session with `revoke_user_sessions` (0011, service role only; deletes `auth.sessions`, refresh tokens cascade). Passwords must not start or end with whitespace (`checkPassword`, shared by form and CSV; the CSV reader passes the password untrimmed via `rawCell`). CSV caps are bytes (`src/lib/csv/limits.ts`: questions 2 MB, students 1 MB); `experimental.serverActions.bodySizeLimit` is 5mb.
- `removeCurriculum` refuses while an attempt in the curriculum is in progress; with attempts it needs `{ confirm: true }` and then deletes only the assignment and unused grants (attempts stay).
- Validation is shared: `validateQuestionFields` (`src/lib/question-fields.ts`) for CSV and manual questions, `validateStudentFields`/`parseStudentsCsv` (`src/lib/csv/students.ts`), `readCsvRows` (`src/lib/csv/rows.ts`) for both CSV parsers, `validateExamSetFields`/`examSetWarnings` (`src/lib/exam-set-fields.ts`; topic mix counts must add up to question_count). Question import is all-or-nothing by default (one insert); "only valid rows" is an explicit choice; stems already in the exam set are row errors.
- Next 16 keeps visited routes in the DOM hidden (Activity): in e2e prefer role locators over `getByLabel`, which also matches hidden pages.

## Auth and sessions
- Next 16 uses `src/proxy.ts` (the renamed middleware) for auth redirects: unauthenticated to `/login`, students to `/consent` until `consent_at`, staff and students kept to their own areas. It calls `getUser()` so a session ended by a newer login is rejected at once.
- Login ends other sessions (`signOut({ scope: 'others' })`). Consent is written by a server action with the service role.
- Pages that read the session call `requireRole()` (which awaits `connection()`) inside `<Suspense>`, as required by `cacheComponents`.
- e2e (`npm run test:e2e`) needs the local stack and `.env.local`; it seeds test users with the service role (`e2e/seed.ts`).

## Workflow
Superpowers (TDD). Project log lives on the Monday board named "TalentTrackPlatform - Project Log". Commits carry no attribution lines.
