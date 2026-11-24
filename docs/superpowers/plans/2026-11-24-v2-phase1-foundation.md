# v2 Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin, trainer and student roles with trainer-scoped student access, private study-abroad student details, and emailed set-your-password invites.

**Architecture:** One migration pair adds the role values, `trainer_id`, `active`, `student_details` and a single RLS rule `private.manages_student(uuid)` that every trainer-visible table reuses. TypeScript keeps `requireRole("staff")` meaning admin or trainer and adds `requireAdmin()`. Invites use the Auth admin `generateLink` plus our own mail module; the token is consumed only when the student submits the new password.

**Tech Stack:** Next.js 16 (App Router), Supabase (Postgres RLS, Auth admin API), Vitest, pgTAP, Playwright. No new npm dependency (Resend is called with `fetch`).

**Spec:** `docs/superpowers/specs/2026-11-24-v2-roadmap-and-foundation-design.md` (read its "Calls made after the builder check" section too). Project rules: `CLAUDE.md`, `DESIGN.md`.

## Global Constraints

- Every public table has RLS; an RLS change needs a failing `supabase/tests/*.test.sql` test first. New functions: explicit `grant execute` (default privileges revoke PUBLIC).
- Accounts are created only through the Auth admin API; passwords are never logged, put in URLs, stored or returned (tests assert results never contain them).
- `private.is_staff()` keeps meaning "admin or trainer". Admin-only: creating trainers, deleting students, writing curriculums, exam sets and questions.
- Trainer scope: sees and manages only students whose `profiles.trainer_id` is theirs; unassigned students are admin-only; curriculums, exam sets and questions are readable by all staff.
- Passport and other details live in `student_details` (admin and the student's trainer only; students and anon nothing). Notes are visible to admin and that trainer.
- Mail failure never blocks creating a student. Invite lifetime is 24 hours and follows the Auth OTP expiry setting. Mail contains the username and a link, never a password.
- UI: tokens from `DESIGN.md`/`globals.css` only, light theme only, 44 px touch targets, `requireRole` inside `<Suspense>`, role locators in e2e.
- Reuse, do not duplicate: extend `createStudentAccount`, `validateStudentFields`, `parseStudentsCsv`, `requireRole`, `usernameToEmail`, `scripts/create-staff.ts`, `revoke_user_sessions`.
- Commits carry no attribution lines. Model use: Sonnet for tasks, Haiku only for the docs-only steps, Opus only if a task blocks.

## Review Focus

1. A mail scanner or link previewer opens the invite URL: the token must survive a GET (consumed only on form submit).
2. A trainer calls a service-role function (`give_extra_attempts`, `remove_curriculum`, `reorder_curriculums`) for another trainer's student: refused.
3. A trainer types an admin URL or posts an admin server action directly: redirected, nothing written.
4. A deactivated user holding a live session: their next request must fail (ban plus revoked sessions).
5. CSV import with some rows lacking a contact email and with a trainer assignment: those students are created without invites and the preview says so.

---

### Task 1: Roles, ownership and details schema (migration 0026)

**Files:**
- Create: `supabase/migrations/0026_roles_and_student_details.sql`
- Create: `supabase/tests/roles_and_scope.test.sql`

**Interfaces:**
- Produces: `profiles.role in ('admin','trainer','student')`; `profiles.trainer_id uuid null references profiles(id)`; `profiles.active boolean not null default true`; `private.is_admin() returns boolean`; `private.manages_student(p_student uuid) returns boolean` (true for admin, or a trainer whose id equals the student's `trainer_id`); table `student_details`.

- [ ] **Step 1: Write the failing pgTAP test** `roles_and_scope.test.sql`, following the setup style of `supabase/tests/rls.test.sql`. Assertions: admin reads all students; trainer A reads only students with `trainer_id = A` in `profiles`, `assignments`, `attempts`, `student_details`; trainer cannot read an unassigned student; a student reads no `student_details` row and cannot update `trainer_id` or `active`; trainer cannot insert or update `curriculums`, `exam_sets` or `questions` (admin can); anon reads nothing; `private.is_staff()` is true for both staff roles.
- [ ] **Step 2: Run** `npm run db:test`. Expected: the new file FAILS (columns and functions missing).
- [ ] **Step 3: Implement the migration.** Widen the role check; `update profiles set role = 'admin' where role = 'staff'`; add the columns; replace `private.handle_new_user()` so it also reads `trainer_id` from `raw_app_meta_data` (app metadata is admin-API only, so this is safe; a missing or invalid value stays null) and add a test that a user created with `app_metadata.trainer_id` gets that `trainer_id`; create `private.is_admin` and `private.manages_student` (security definer, empty `search_path`, explicit grants); create `student_details` (columns per spec: contact email not null, phone, guardian name and phone, date of birth, gender, address, passport number and expiry, destination country, target intake, German level `A0..C1`, qualification, joined on, programme start, status `active|on_hold|completed|dropped` default `active`, notes, timestamps) with `student_id` as primary key referencing `profiles(id) on delete cascade`; enable RLS with policies using `private.manages_student(student_id)`. Rewrite the existing staff SELECT policies on `profiles` (student rows only; staff can always read own row and staff rows needed for the team page via admin), `assignments`, `attempts`, `attempt_questions`, `answers` to use `manages_student`; restrict INSERT and UPDATE policies on `curriculums`, `exam_sets`, `questions` to `private.is_admin()`; staff INSERT on `assignments` additionally requires `manages_student(student_id)`. Read the current policies in 0001, 0012, 0013, 0023, 0025 first and replace them, not add beside them.
- [ ] **Step 4: Run** `npm run db:reset && npm run db:test && npm run db:lint`. Expected: all PASS, lint no errors.
- [ ] **Step 5: Commit** `feat(db): roles, trainer ownership and student_details`.

### Task 2: Ownership check inside service-role functions (migration 0027)

**Files:**
- Create: `supabase/migrations/0027_ownership_checks.sql`
- Modify: `supabase/tests/extra_attempts.test.sql`, `supabase/tests/assignment_functions.test.sql`

**Interfaces:**
- Consumes: `private.manages_student(uuid)` from Task 1.
- Produces: `give_extra_attempts`, `remove_curriculum`, `reorder_curriculums` raise `not_staff` when the caller (their `p_staff_id`/staff argument) is not staff, and `not_your_student` when staff is a trainer who does not manage the student. `manages_student` must work for an explicit staff id argument, so add `private.staff_manages_student(p_staff uuid, p_student uuid) returns boolean` and have `manages_student` call it with `auth.uid()`.

- [ ] **Step 1: Add failing cases** to the two test files: a trainer id passed for another trainer's student raises `not_your_student`; an admin succeeds; existing cases still pass.
- [ ] **Step 2: Run** `npm run db:test`. Expected: the new cases FAIL.
- [ ] **Step 3: Implement** by replacing the three functions in 0027 (copy their latest bodies from 0021/0016/0024, add the check right after the existing `not_staff` check, keeping the lock order from CLAUDE.md). Grants stay `service_role` only.
- [ ] **Step 4: Run** `npm run db:reset && npm run db:test && npm run db:lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): trainer ownership checks in staff functions`.

### Task 3: Role types, guards and routing

**Files:**
- Modify: `src/lib/auth/require-role.ts`, `src/proxy.ts`, `src/lib/auth/public-paths.ts`, `src/app/staff/staff-nav.tsx`, `src/app/staff/staff-nav.test.ts`
- Modify (swap to `requireAdmin()`): `src/app/staff/curriculums/{page,actions}.tsx|ts`, `src/app/staff/curriculums/[id]/page.tsx`, `src/app/staff/questions/{page,actions}`, the `deleteStudent` action in `src/app/staff/students/actions.ts`
- Test: `src/lib/auth/require-role.test.ts` (create; mock the Supabase client the way `staff-manage.test.ts` does)

**Interfaces:**
- Produces: `type Role = "admin" | "trainer" | "student"`; `type RoleGroup = Role | "staff"`; `requireRole(role: RoleGroup): Promise<Profile>` (`"staff"` passes admin and trainer); `requireAdmin(): Promise<Profile>` (a trainer is redirected to `/staff`); `Profile` gains `trainer_id: string | null` and `active: boolean`; `isStaffRole(role: Role): boolean`; `STAFF_NAV` items carry `adminOnly?: boolean`.

- [ ] **Step 1: Write failing tests**: `requireRole("staff")` accepts admin and trainer and redirects a student to `/exam/start`; `requireRole("student")` redirects both staff roles to `/staff`; `requireAdmin()` redirects a trainer to `/staff`; an inactive profile redirects to `/login`; nav hides admin-only items for a trainer.
- [ ] **Step 2: Run** `npm test -- require-role staff-nav`. Expected: FAIL.
- [ ] **Step 3: Implement** the types and guards in `require-role.ts` (select the two new columns); `proxy.ts` uses `isStaffRole` for the staff area; add `/set-password` to `PUBLIC_PATHS` (exact match) and let the proxy pass it through for signed-out users only; pass the role into `StaffNav` from `src/app/staff/layout.tsx` via the profile read inside a Suspense boundary (the layout currently reads no session, keep it cheap: one `requireRole("staff")` call in a small server component).
- [ ] **Step 4: Run** `npm test && npm run lint`. Expected: PASS (existing tests unchanged in meaning).
- [ ] **Step 5: Commit** `feat: admin and trainer roles in guards, proxy and nav`.

### Task 4: Student detail fields and validation

**Files:**
- Modify: `src/lib/csv/students.ts`, `src/lib/csv/students.test.ts`
- Create: `src/lib/student-details.ts`, `src/lib/student-details.test.ts`

**Interfaces:**
- Produces in `student-details.ts`: `type StudentDetails` (camelCase mirror of the table columns), `GERMAN_LEVELS`, `STUDENT_STATUSES`, `validateStudentDetails(input: Partial<Record<keyof StudentDetails, string>>): { ok: true; details: StudentDetails } | { ok: false; message: string }`, `detailsToRow(details): Record<string, unknown>` and `rowToDetails(row): StudentDetails`.
- Changes: `NewStudent` and `StudentFields` gain `contactEmail: string` (optional in CSV, required by the form via a separate `requireContactEmail` flag on `validateStudentFields(fields, { requireContactEmail })`) and `details?: StudentDetails`; `parseStudentsCsv` accepts optional columns `contact_email`, `phone`, `passport_number`, `destination_country`, `german_level`, `programme_start` and reports row-level errors; `REQUIRED_COLUMNS` is unchanged so old files still import.

- [ ] **Step 1: Write failing tests**: valid and invalid email, German level outside `A0..C1`, passport expiry before today refused, dates must be ISO, a CSV without the new columns still parses, a CSV row with a bad `german_level` is a row error, error messages never include the password.
- [ ] **Step 2: Run** `npm test -- student-details students`. Expected: FAIL.
- [ ] **Step 3: Implement** the module and extend the two existing functions (no second validator).
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: study-abroad student detail fields and validation`.

### Task 5: Account creation with ownership and details

**Files:**
- Modify: `src/lib/staff-students.ts`, `src/app/staff/students/actions.ts`, `src/app/staff/students/actions.test.ts`
- Test: extend `actions.test.ts`

**Interfaces:**
- Consumes: Task 4 types, Task 3 `requireRole`.
- Produces: `createStudentAccount(staff: SupabaseClient, student: NewStudent, owner: { trainerId: string | null }): Promise<CreateAccountResult>` (passes `trainer_id` in the createUser `app_metadata`, which Task 1's trigger reads, so the owner is set before the assignments insert that Task 1's RLS requires `manages_student` for; the existing rollback path covers it); a details row is inserted when `student.details` or `contactEmail` is present; `createStudent` action returns `{ ok: true; studentId: string; invite: "sent" | "failed" | "skipped" }` (invite wired in Task 7). `trainerId` rule: a trainer caller is always the owner; an admin passes the chosen trainer id or null.

- [ ] **Step 1: Write failing tests**: a trainer-created student gets that trainer's id; a trainer cannot pass another trainer id (ignored, uses own); an admin can choose a trainer; if the details insert fails the auth user is deleted again and the message is the existing generic one; the result never contains the password.
- [ ] **Step 2: Run** `npm test -- students/actions`. Expected: FAIL.
- [ ] **Step 3: Implement** by extending `createStudentAccount` (same rollback pattern as the assignments failure) and the actions' admin-only `deleteStudent` check; confirm `deleteStudent` cascades to `student_details` (covered by Task 1 foreign key; add an assertion in `roles_and_scope.test.sql`).
- [ ] **Step 4: Run** `npm test && npm run db:test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: students created with owner and details`.

### Task 6: Mail module

**Files:**
- Create: `src/lib/mail/index.ts`, `src/lib/mail/transports.ts`, `src/lib/mail/invite-template.ts`, and a test file for each
- Modify: `.env.example`

**Interfaces:**
- Produces: `type MailMessage = { to: string; subject: string; text: string; html: string }`; `sendMail(message: MailMessage): Promise<{ ok: true } | { ok: false }>` (never throws, never logs the body, logs only `to` domain and status); transport chosen by `MAIL_TRANSPORT` (`log` default outside production, `resend`); `resend` posts to `https://api.resend.com/emails` with `fetch`, `RESEND_API_KEY`, `MAIL_FROM`; `buildInviteMail({ fullName, username, link }: ...): MailMessage` (plain, branded per `DESIGN.md`, name written "Talent Track Platform", "F.L.A.G." exact).

- [ ] **Step 1: Write failing tests**: `log` transport returns ok and writes nothing containing the link token to the console; `resend` transport sends the right payload (stub `fetch`) and maps a non-2xx or throw to `{ ok: false }`; `buildInviteMail` contains the username and link, contains no password-like field, escapes the name in HTML.
- [ ] **Step 2: Run** `npm test -- mail`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add `MAIL_TRANSPORT`, `RESEND_API_KEY`, `MAIL_FROM`, `APP_URL` to `.env.example` with comments.
- [ ] **Step 4: Run** `npm test && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: mail module with log and Resend transports`.

### Task 7: Invite flow and /set-password

**Files:**
- Create: `src/lib/invites.ts`, `src/lib/invites.test.ts`, `src/app/set-password/page.tsx`, `src/app/set-password/actions.ts`, `src/app/set-password/set-password-form.tsx`
- Modify: `src/app/staff/students/actions.ts` (call invite after create; add `resendInvite`), student page (Resend button)
- Test: `e2e/set-password.spec.ts`

**Interfaces:**
- Consumes: `sendMail`, `buildInviteMail`, admin client, `revoke_user_sessions`.
- Produces: `createInviteLink(studentId: string): Promise<{ ok: true; link: string } | { ok: false }>` (admin `generateLink({ type: "recovery", email })` where `email` is read from the auth user with `admin.auth.admin.getUserById(studentId)`, not recomputed, because trainers created in Task 9 use their real email; link `${APP_URL}/set-password?token_hash=...`); `sendInvite(studentId: string): Promise<"sent" | "failed" | "skipped">` (skipped when no contact email); `resendInvite(studentId)` action calling `requireRole("staff")` and the ownership rule; `setPasswordAction({ tokenHash, password })`: `verifyOtp({ type: "recovery", token_hash })`, `checkPassword`, `updateUser({ password })`, then `signOut({ scope: "others" })`, redirects to `/login`.

- [ ] **Step 1: Write failing tests**: unit: `sendInvite` is `skipped` with no contact email, `failed` when `sendMail` fails (student still exists), never returns the link; e2e: opening `/set-password?token_hash=...` with GET does NOT consume the token (a second GET and the later submit still work), a weak password shows the `checkPassword` message, a good password signs in with the username, a used or garbage token shows a safe expired message.
- [ ] **Step 2: Run** `npm test -- invites` and `npm run test:e2e -- set-password`. Expected: FAIL.
- [ ] **Step 3: Implement.** The page only renders the form (the token is a hidden field); verification happens in the server action. Rate-limit by relying on Auth; show one generic error for every failure. Trainer resend works only for managed students (RLS read first).
- [ ] **Step 4: Run** the same commands plus `npm test`. Expected: PASS. Note in the PR that the Auth OTP expiry must be set to 86400 (24 hours, the hosted maximum) in the dashboard for production.
- [ ] **Step 5: Commit** `feat: emailed set-your-password invites`.

### Task 8: Student form, student page and CSV import UI

**Files:**
- Modify: `src/app/staff/students/add-student-form.tsx`, `import-students.tsx`, `page.tsx`, `[id]/page.tsx`, `ui.ts`
- Create: `src/app/staff/students/[id]/student-details-card.tsx`, `src/app/staff/students/details-actions.ts` (+ `details-actions.test.ts`)
- Test: `e2e/staff.spec.ts` (extend), `e2e/design.spec.ts` (new shots)

**Interfaces:**
- Consumes: Task 4, 5, 7.
- Produces: `saveStudentDetails({ studentId, details })` action (`requireRole("staff")`, session-client write under RLS, returns `{ ok }`); admin-only trainer picker (`trainer-select`) on add and edit; add-student form sections: Account, Contact, Passport and travel, Course, Notes; student page shows a details card and an invite status line (`invite-status`).

- [ ] **Step 1: Write failing tests**: action rejects a trainer saving another trainer's student (RLS returns no row); the e2e: trainer adds a student with contact email, sees only own students in the list, cannot see another trainer's student by URL; admin sees all and can assign a trainer; the form is usable at 375 px with no horizontal overflow (existing axe and overflow checks in `design.spec.ts` cover the new page).
- [ ] **Step 2: Run** the new unit test and `npm run test:e2e -- staff`. Expected: FAIL.
- [ ] **Step 3: Implement** grouped, labelled sections using existing form primitives and `PageHeader`; CSV preview shows "no invite (no email)" per row; passport fields use `autocomplete="off"`.
- [ ] **Step 4: Run** `npm test && npm run test:e2e`. Expected: PASS (refresh `docs/design-review` shots only through the existing `design.spec.ts`).
- [ ] **Step 5: Commit** `feat: student details form, page card and import columns`.

### Task 9: Team management (trainers)

**Files:**
- Create: `src/app/staff/team/page.tsx`, `actions.ts`, `actions.test.ts`, `trainer-form.tsx`
- Modify: `scripts/create-staff.ts`, `src/lib/create-staff.test.ts`, `src/lib/staff-students.ts` (extract the shared admin-API create call, do not copy it), `src/app/staff/staff-nav.tsx`

**Interfaces:**
- Produces: `createTrainer({ email, username, fullName })` (admin only; creates auth user with `app_metadata.role = "trainer"` and a random one-time password that is never returned, then sends the invite via Task 7 using the real email as contact and auth email); `setTrainerActive(trainerId, active)` (admin only; refuses while the trainer has students; sets `profiles.active`, bans with `admin.updateUserById(..., { ban_duration })`, calls `revoke_user_sessions`); `reassignStudents({ fromTrainerId, toTrainerId })` (admin only, one service-role update); `staffAccountFromEnv` accepts optional `STAFF_ROLE` (`admin` default, `trainer`).

- [ ] **Step 1: Write failing tests**: a trainer calling any team action is redirected; deactivation refused with students assigned and allowed after reassignment; deactivated user's password sign-in fails and existing sessions end; `STAFF_ROLE=trainer` sets the role, bad values are rejected, no password in output.
- [ ] **Step 2: Run** `npm test -- team create-staff`. Expected: FAIL.
- [ ] **Step 3: Implement** with `requireAdmin()` first in every action; nav item "Team" is admin-only.
- [ ] **Step 4: Run** `npm test && npm run test:e2e -- staff`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: admin trainer management`.

### Task 10: Docs, demo seed and full verification

**Files:**
- Modify: `CLAUDE.md`, `DESIGN.md`, `.env.example`, `scripts/demo-seed.mjs`, `e2e/seed.ts`, `e2e/fixtures.ts`, `docs/superpowers/specs/2026-11-24-v2-roadmap-and-foundation-design.md` (status line)

- [ ] **Step 1: Update docs** (Haiku is enough): CLAUDE.md gets the roles section, `student_details`, `manages_student`, the admin-only list, invite flow, mail env vars, new migration numbers 0026 and 0027 in the production checklist (mail domain, Auth OTP expiry 86400 s, create first trainer); DESIGN.md gets the new pages. Check every file path named in the docs exists.
- [ ] **Step 2: Seed** a demo admin, a demo trainer (`demo-trainer@example.test`) with `demo.student` assigned to them, TEST credentials only; update `e2e/seed.ts` helpers to create trainer users.
- [ ] **Step 3: Run the whole gate**: `npm run db:reset && npm run db:test && npm run db:lint && npm test && npm run lint && npm run build && npm run test:e2e`. Expected: all PASS. Run `security-review` on the branch and CodeRabbit per the global rules if the repo is configured.
- [ ] **Step 4: Log to the Monday board** (when the connector can write) and commit `docs: v2 phase 1 roles, details and invites`.

---

## Self-review notes

- Spec coverage: roles/RLS (T1, T3), ownership and scope (T1, T2, T5), details table (T1, T4, T8), invites and mail (T6, T7), trainer management and deactivation (T9), CSV (T4, T8), docs and env (T10), erasure cascade (T5).
- Types: `RoleGroup`, `requireAdmin`, `createStudentAccount(..., owner)`, `sendInvite` and `createInviteLink` are used with the same names where consumed.
- Deferred to later phases on purpose: reader, exercises, exam requests, plans, payments.
