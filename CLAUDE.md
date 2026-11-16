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
- `npm test` (Vitest), `npm run test:e2e` (Playwright; run `npx playwright install` once first)
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

## Auth and sessions
- Next 16 uses `src/proxy.ts` (the renamed middleware) for auth redirects: unauthenticated to `/login`, students to `/consent` until `consent_at`, staff and students kept to their own areas. It calls `getUser()` so a session ended by a newer login is rejected at once.
- Login ends other sessions (`signOut({ scope: 'others' })`). Consent is written by a server action with the service role.
- Pages that read the session call `requireRole()` (which awaits `connection()`) inside `<Suspense>`, as required by `cacheComponents`.
- e2e (`npm run test:e2e`) needs the local stack and `.env.local`; it seeds test users with the service role (`e2e/seed.ts`).

## Workflow
Superpowers (TDD). Project log lives on the Monday board named "TalentTrackPlatform - Project Log". Commits carry no attribution lines.
