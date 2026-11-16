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
- `release_attempt(p_attempt_id, p_released_by)` (0006) records the releasing staff id in `attempts.released_by` (null for the automatic release); it refuses a non-staff releaser and never overwrites an earlier release. The failed branch is where Task 7's blocking rule goes.

## Results and release (Task 6)
- Staff: `/staff/review` lists submitted (held) attempts; `/staff/review/[attemptId]` is the bilingual evaluation view with the Release button. Readers in `src/lib/review.ts` use the staff session (RLS). `releaseAttemptAction` (`src/app/staff/review/actions.ts`) calls `requireRole('staff')` and `releaseAttempt(attemptId, profile.id)` (`src/lib/release.ts`, service role). It takes only the attempt id; points are never writable.
- Student: `/results/[attemptId]` uses `getStudentResult` (`src/lib/results.ts`): the `student_attempts` view through the session client; before release no numbers at all. After release the per-topic breakdown is computed with the service role only after re-checking owner and status, and only topic totals are returned (no key, no per-question results). The released report is bilingual and has a print stylesheet (`print:` variants plus `@media print` in globals.css).
- `notFound()` inside a Suspense boundary renders the not-found UI with HTTP 200 (streaming); tests check for absence of data, not the status.
- Expiry is lazy (on every read/save of an attempt); `/api/cron/sweep` (Bearer `CRON_SECRET`, exempt from the proxy) is a daily backup because Vercel Hobby only allows daily crons.

## Auth and sessions
- Next 16 uses `src/proxy.ts` (the renamed middleware) for auth redirects: unauthenticated to `/login`, students to `/consent` until `consent_at`, staff and students kept to their own areas. It calls `getUser()` so a session ended by a newer login is rejected at once.
- Login ends other sessions (`signOut({ scope: 'others' })`). Consent is written by a server action with the service role.
- Pages that read the session call `requireRole()` (which awaits `connection()`) inside `<Suspense>`, as required by `cacheComponents`.
- e2e (`npm run test:e2e`) needs the local stack and `.env.local`; it seeds test users with the service role (`e2e/seed.ts`).

## Workflow
Superpowers (TDD). Project log lives on the Monday board named "TalentTrackPlatform - Project Log". Commits carry no attribution lines.
