# Spec change 1: immediate marks, two free attempts, independent curriculum exams

Date: 2026-11-18. Amends `2026-11-13-talenttrackplatform-design.md`. Where the two disagree, this document wins.

## Intent
The owner (Life Planner) simplified the product after seeing phase 1 run locally. Marks are for students, not a staff-gated release. Students should not wait for approval to take their normal attempts. Each curriculum is its own exam with its own result.

## Goals
1. No video capture anywhere (it was only planned for phase 2; nothing was built).
2. Marks are visible to the student immediately after the exam is submitted or time runs out. There is no hold and no release step. The staff review panel stays as a read-only view of every attempt.
3. Every student gets 2 attempts per curriculum by default, with no staff approval. A student who fails the last allowed attempt is blocked. Staff can then give extra attempts. Staff can also give extra attempts at any time.
4. Each curriculum is separate and independent. A student with two curriculums sees one card per curriculum, can start either in any order, and each has its own attempts, percentage, pass or fail and block. A curriculum can have many exam sets (as today).
5. Within a curriculum a student never gets the same exam set twice: attempt 1 uses one exam set, attempt 2 a different one. If the curriculum has fewer exam sets than the attempts allowed, staff can override for that student (allow repeats).

## Non-goals and anti-goals
- No forced order between curriculums. No shared attempts, blocks or results across curriculums.
- Do not weaken privacy: students never see the answer key or per-question results, only totals, percentage and topic totals.
- Do not change percent-first display, the 90% default pass mark, the pass-mark snapshot on attempts, the reminder popup, or the duration controls.
- Do not delete data: existing attempts, answers and scores keep working.

## Decisions (owner, from the conversation)
- Video capture: dropped.
- Marks: immediate. No release layer. Review panel: kept, read-only.
- Default attempts: 2 per curriculum, per student, no approval. Block after the last failed attempt. Extra attempts by staff.
- Curriculums: independent cards, any order; many exam sets per curriculum stay.
- Retries: a different exam set of the same curriculum each time. Staff override when needed.

## My calls (owner may correct)
- The attempt limit moves from the exam set to the curriculum: `curriculums.max_attempts` (default 2); `exam_sets.max_attempts` is dropped and its form field moves to the curriculum page.
- Extra attempts are a counter on the student's assignment (`extra_attempts`), replacing the attempt_grants table. Allowance = curriculum `max_attempts` + `extra_attempts`. Attempts used = the student's submitted or released attempts across all exam sets of that curriculum.
- Which exam set an attempt gets: chosen by the system, at random among the curriculum's exam sets the student has not used yet (the student does not pick). Override = `allow_repeats` flag on the assignment, set by staff: when every exam set has been used it picks the least recently used set, and within a set prefers questions not seen before.
- Questions inside an exam set keep today's unseen-first draw; the pool warning becomes: approved questions >= question count per exam set, and the curriculum warns when it has fewer exam sets than attempts allowed.
- Remove `exam_sets.hold_result` and the Release button, the "awaiting review" state and `result_pending`. Scoring and release become one atomic step; the attempt is `released` the moment it is scored.
- A student may have one exam in progress per exam (existing unique index). No new cross-curriculum locking: independent means independent.
- Blocking is decided at scoring: failed and attempts used >= allowance. A pass sets the assignment to `passed`. Giving extra attempts unblocks.

## Approaches considered
A. Keep the grant table and auto-create grants for the first two attempts. Rejected: two sources of truth, and a race between auto-grant and staff grant.
B. Compute allowance as `max_attempts + extra_attempts` and count attempts used (chosen). One number to reason about; atomic under the assignment row lock that already orders start, grant, remove and reorder.
C. Hide the release button but keep the hold machinery. Rejected: dead states and masking rules that could leak or confuse.

## What changes (for the builder)
Database (new numbered migrations after the latest, pgTAP first, hardening pattern, lock order assignment -> attempts):
- Drop `exam_sets.hold_result` and `exam_sets.max_attempts`; add `curriculums.max_attempts int not null default 2 check (1..20)`; add `assignments.extra_attempts int not null default 0 check >= 0` and `assignments.allow_repeats boolean not null default false`; migrate unused grants into `extra_attempts`; drop `attempt_grants`.
- `start_attempt(student, curriculum)`: no grant and no exam set argument; locks the assignment, refuses with `not_open`, `blocked`, `passed`, `no_attempts_left` (used >= allowance), `in_progress` (one in progress per curriculum); picks the exam set as above, `no_exam_sets_left` when all are used and `allow_repeats` is false, `insufficient_pool` when the chosen set has too few approved questions. Keep every earlier guarantee (assignment FOR UPDATE, unique in-progress, db now(), pass-mark snapshot, service_role only, empty search_path).
- `record_score` releases in the same transaction (status `released`); blocking and pass logic move there; `release_attempt` becomes internal or is removed; release of attempts already `submitted` and scored by migration.
- Replace `grant_attempt` with `give_extra_attempts(student, curriculum, n, staff, allow_repeats)`; staff only; unblocks; `n` 1..10.
- Views: `student_attempts` shows points once scored (status released); `student_assignments` no longer masks.
App:
- Student `/exam/start`: one card per assigned curriculum (any order), states `ready` (attempts left shown; the exam set is chosen for them), `in_progress`, `passed`, `blocked`, `unavailable` (no unused exam set or too few questions: contact trainer); results list per curriculum, percentage first. Remove sequential "next curriculum" logic, `awaiting_review`, `waiting`.
- After submit the student goes straight to their result.
- Staff: `/staff/review` becomes read-only "Attempts" (all attempts, filters, evaluation view, no Release); `/staff/grants` becomes "Extra attempts" (give 1..N, allow repeats toggle, list of blocked and exam-set-short students); the exam set form loses "Hold results" and "Maximum attempts"; the curriculum page gets "Attempts per student" (default 2) and the warnings above.
- Spec, plan and CLAUDE.md updated; video mentions removed; test fixtures and e2e rewritten for the new flow (full-flow, blocking, exam, results).

## Constraints
- Local Supabase only; nothing deployed or pushed. Production must apply the new migrations in order.
- All existing security rules hold (requireRole in every action, service-role only for attempt writes, no passwords in logs).
- TDD, pgTAP before SQL, review per task, final whole-branch review, CodeRabbit and security review re-run.

## Left to the builder
Migration numbering and exact SQL; how the card UI is laid out within DESIGN.md; the name of the pool-shortfall message; whether to keep `release_attempt` as a thin internal function.
