# Talent Track Platform v2: roadmap and Phase 1 (Foundation) design

Status: draft for owner approval, 2026-11-24. Amends `2026-11-13-talenttrackplatform-design.md` and `2026-11-18-immediate-marks-attempts-design.md`. Only Phase 1 is designed in detail here; Phases 2 to 5 get their own design docs when they start.

## Intent and why

F.L.A.G. (Foreign Languages Academy Gurukulam) trains students in Kerala for study-abroad exams. v1 is an exam engine with one "staff" role. v2 turns it into a learning platform: the instructor's PDF curriculum becomes a book-style reader with chapter exercises, trainers vouch for each student before the main exam, admins approve, and students who found us online can join without a trainer. The curriculum PDFs are the instructor's work: their layout is never altered, only presented.

## Users

- **Admin**: full access to everything, including curriculum authoring, the exam-request decision, plans, and the trainer list.
- **Trainer**: adds and manages their own students, authors exercises and curriculum content, reviews a student's journey, enters model-exam marks and feedback, requests the main exam from the admin, reopens a curriculum after the exam.
- **Student**: internal (enrolled at F.L.A.G.) or external (found the website).

(The owner's brief listed "ADMIN" twice; the third role is read as Student.)

## Roadmap (build and design one phase at a time)

1. **Foundation** (this doc): roles, trainer-to-student assignment, student details, email invites.
2. **Curriculum content**: PDF book reader (research free, ad-free flipbook or swipe libraries first), chapters, trainer-set exercises (any questions and timing, unlimited retries), chapter gating (pass to unlock the next).
3. **Exam request workflow**: student requests the main exam after the last chapter; trainer sees the full journey (date and time, duration per chapter, every exercise attempt and result); trainer enters model-exam marks, **duration of programme, attendance and feedback** when submitting the request; admin approves or rejects; approval locks all curriculum and exercise access until the result; trainers can reopen after.
4. **External students and plans**: self sign-up, access per student and curriculum, admin "External students" view.
5. **Payments**: Razorpay (test mode first), signed-webhook unlock, optional expiry once durations are decided.

Plans (names are the assistant's proposal; the owner may rename): **Prüfung** (default, exam only, no curriculum), **Lernpfad** (curriculum and exercises, exams any time, no approval), **Mentor** (Lernpfad plus an assigned trainer and the full internal flow). Internal students are Mentor with no payment. The plan is stored per student and curriculum (`assignments.access`), and one pure function `capabilities(access)` answers every "can this student..." question so no screen repeats the rule.

## Phase 1: goals

1. Three roles with correct RLS and routing.
2. Trainer-to-student ownership (a Mentor/internal student has one trainer).
3. Rich student details for study-abroad students, kept private.
4. Staff-created students receive an email invite to set their own password.
5. Admin can create and manage trainers.

## Non-goals

No PDF reader, exercises, exam request, plans UI, external sign-up or payments in this phase. No change to the exam engine, scoring or attempts.

## Anti-goals

- No plaintext password in email or logs.
- Passport and other personal data must not leak to students, other trainers or anon.
- No second copy of logic that exists: staff checks, student creation, CSV validation and the admin-API account helper are extended, not duplicated.

## Design

### Roles
- `profiles.role` check becomes `('admin','trainer','student')`. Migration `0026`: existing `staff` rows become `admin` (the current staff are the owners; trainers are then added by the admin).
- `private.is_staff()` keeps its meaning "admin or trainer" so every existing policy and the 8 TS call sites keep working. New `private.is_admin()`. Admin-only today: creating trainers, deleting students, curriculum and question authoring (trainers get content authoring in Phase 2).
- TS: `Role = 'admin' | 'trainer' | 'student'`; one `STAFF_ROLES` group so `requireRole('staff')` still means admin or trainer; new `requireAdmin()`. `proxy.ts` and `requireRole` route both staff roles to `/staff`. Keep the single `/staff` area; the nav hides admin-only items (a trainer who types an admin URL gets the server-side `requireAdmin` redirect).
- Trainer scope: a trainer sees and manages only students whose `trainer_id` is theirs; admin sees all. Enforced in RLS through `private.manages_student(student_id)`, not in the page code.

### Ownership
- `profiles.trainer_id uuid references profiles(id)` (null for unassigned and for Prüfung/Lernpfad external students). Only an admin can change it; a student's own trainer is never writable by the student (profile writes are already closed since 0025).

### Student details (new table, private)
`student_details` (one row per student, RLS: admin and the student's own trainer read and write; the student reads nothing, anon nothing). Separate from `profiles` because every staff session can read profiles and passport data must not be that widely visible.

Fields (all optional except where noted): contact email (**required**, for the invite), phone, guardian name and phone, date of birth, gender, address, passport number, passport expiry, destination country, target intake, current German level (A0 to C1), qualification, joined on, programme start date, status (active, on hold, completed, dropped), internal notes. `batch` and `track` stay on `profiles` where they are. Validation lives in the existing shared validators (`validateStudentFields`, extended), used by the form and the CSV import.

### Invites
- Staff create the student as today (username identifies login). The contact email goes in `student_details`; the auth email stays the internal username address.
- **The mail carries the username and a one-time link, not a password** (owner asked for "credentials"; sending a password in clear is unsafe, so the link lets the student choose their own). Link: server action calls the Auth admin `generateLink`, we send our own email with `/set-password?token_hash=...`, and the page verifies the token and sets the password. Expiry 24 hours (the hosted Auth maximum); staff can resend. Existing "reset password" stays as the manual path.
- Mail provider: **Resend** (free tier, domain verification, simple API), behind one `sendMail()` module in `src/lib/mail/`, with a console/log transport in development so tests need no network. Template is bilingual-ready, plain and branded per `DESIGN.md`. The sending domain is an open decision for the owner (see below).
- CSV import gains the new columns and sends invites after a successful import.

### Admin: trainers
`/staff/team` (admin only): list, add trainer (same account helper and invite flow, role `trainer`), deactivate. The first admin still comes from `scripts/create-staff.ts` (extended with a `STAFF_ROLE` value, default admin).

### Reuse map (no duplicates)
Extend: `createStudentAccount` and the admin-API helpers in `staff-students.ts`; `validateStudentFields` / `parseStudentsCsv`; `requireRole`; `private.is_staff`; `usernameToEmail`; `scripts/create-staff.ts`; shared UI in `src/components/app/`. New: `src/lib/mail/`, `student_details` and its readers, `/set-password`, `/staff/team`.

## Approaches considered

- **Roles:** (a) add a `role` value and keep one staff area, chosen; (b) separate `/admin` and `/trainer` apps (more routes to keep consistent, no benefit now).
- **Personal data:** (a) separate `student_details` table with tight RLS, chosen; (b) more columns on `profiles` (simple, but every staff session would read passports).
- **Invite:** (a) own mail via Resend with a one-time link, chosen; (b) Supabase's built-in invite (needs real auth emails, which students do not use, and gives less control of the template).

## Constraints from the project docs (must hold)

Every public table has RLS; any RLS change needs a failing `supabase/tests/rls.test.sql` test first; new functions need explicit `grant execute`; account creation only through the admin API; passwords never logged or returned; Next 16 patterns in CLAUDE.md (`requireRole` inside Suspense); DESIGN.md tokens only; DPDP erasure via `deleteStudent` must also remove `student_details` (cascade). Docs to update at the end of the phase: CLAUDE.md (roles, tables, conventions), DESIGN.md (new pages), this spec, `.env.example` (mail keys), production checklist (mail domain, rotating `CRON_SECRET`-style keys).

## Left to the builder

Migration numbering and exact column types; the policy SQL; component layout of the student form (group the many fields into sections); email copy; test breakdown.

## Calls made after the builder check (assistant's decisions, owner may override)

- **Migration 0026**: every existing staff row becomes admin. New trainers are created by an admin afterwards. Until Phase 2, curriculum, exam set and question authoring and "Delete student" stay admin-only; trainers manage their own students, give them extra attempts, and read their attempts and results.
- **Trainer scope** applies to students and everything hanging off them (assignments, attempts, results, extra attempts, dashboard figures). Curriculums, exam sets and questions are global and readable by every trainer. The service-role functions (`give_extra_attempts`, `remove_curriculum`, `reorder_curriculums`) gain an ownership check through the same `manages_student` rule, not only `not_staff`.
- **Ownership**: a student a trainer creates is assigned to that trainer; an admin picks the trainer when creating or importing. Unassigned students are visible to admins only, so after 0026 trainers see nothing until an admin assigns students (acceptable: no student has a trainer today). A trainer with students cannot be deactivated until an admin reassigns them.
- **Deactivate** means a `profiles.active` flag plus an Auth ban and session revocation (`revoke_user_sessions`).
- **Contact email**: required in the single add-student form, optional in CSV import. No email means no invite, and the existing manual password path remains. Existing students get a details row on first edit. Shared emails are allowed (siblings). The invite is re-sent only by an explicit Resend button.
- **Invite link**: the internal Auth email stays; the token is verified and consumed server-side on `/set-password` (added to the public paths), and setting a password ends other sessions like login does. The 24-hour lifetime (the hosted Auth maximum, 86400 s) depends on the Auth OTP expiry setting, which must be set to 86400 in the dashboard (production checklist). The mail names the username; with no password in it the leak risk is low.
- **Mail failure** never blocks creating the student: the account is created and the page shows "Invite not sent, Resend". Until the sending domain exists, only the log transport ships, which is enough to sign off Phase 1 in development.
- **Passport data**: RLS only in Phase 1 (no field encryption, no read audit); the existing consent screen covers notice; erasure cascades through `deleteStudent`. Revisit audit and retention before launch.
- **`student_details.status`** is informational in Phase 1; it gates nothing. Internal notes are visible to the admin and the student's trainer.

## Open owner decisions

1. Sending domain for invites (for example `mail.<your-domain>`) and the sender name. Not needed to build Phase 1, needed before real mail goes out.
2. Names of the plans (Phase 4).
