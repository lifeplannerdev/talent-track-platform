# Final fix wave 2 (security review and CodeRabbit), on main

Status: DONE. Seven findings (S1-S4, C1-C3) fixed in focused commits 4e999ef..a6996fe, plus one e2e timing fix (a047014) on `main`. Nothing pushed or deployed, no remote services touched, and no attribution lines in the commits.

## Changes

| Finding | Fix | Commit |
|---|---|---|
| S1 student_questions exposed English text | grep found no use in `src/`, `e2e/` or `scripts/`. Migration `0014_drop_student_questions.sql` drops the view and, with it, its grants. rls.test.sql now asserts `hasnt_view`; the old view tests were removed (plan 53 -> 50). In CLAUDE.md, the paper comes only from `getAttemptForStudent` (German text, no key), and the advisor note now covers only `student_attempts` and `student_assignments`. | 4e999ef |
| C3 second in-progress exam in a curriculum | Migration `0015_start_attempt_one_per_curriculum.sql` replaces `start_attempt` (same signature, service role only). It raises `in_progress` while an attempt is in progress on another exam set of the curriculum. `startAttempt` first closes expired attempts on the curriculum's other exam sets (lazy expiry). The exam page has a message for `?error=in_progress`. `getExamStartState` already returns the curriculum's in-progress attempt first, so no state change was needed. | 2335877 |
| C1 reorder not atomic, C2 remove not atomic | Migration `0016_assignment_functions.sql` adds `reorder_curriculums(staff, student, ids[])` and `remove_curriculum(staff, student, curriculum, confirm)`. Both are security invoker with an empty search_path, revoked from public/anon/authenticated and granted to service_role, and refuse with `not_staff` unless the staff id is a staff profile. `reorder_curriculums` locks the student's rows, raises `order_mismatch` unless the list is exactly the student's curriculums, and sets all positions in one UPDATE. `remove_curriculum` locks the assignment row FOR UPDATE, raises `in_progress`, returns `{ok:false, code:'has_attempts', attempts:n}` without confirm, and otherwise deletes the unused grants and the assignment in one transaction. The actions call these RPCs with the session's staff id after `requireRole('staff')`. Messages and the confirm flag are unchanged, and `removeCurriculum` still closes expired attempts first. | e57793b |
| S3 consent not enforced in actions | `requireStudentWithConsent()` in `src/lib/auth/require-role.ts` is used by `startExam`, `saveAnswerAction` and `submitExam`. A student without consent is redirected to /consent and nothing runs. Only the consent action keeps `requireRole('student')`. | 31a2fe2 |
| S4 shadcn in dependencies | Moved to devDependencies; it is only used through the build-time `@import "shadcn/tailwind.css"`. The lockfile was regenerated from cache: dev flags only, plus 6 bundled optional wasm entries npm added, with no version changes. `npm audit --omit=dev`: 4 moderate before (minimatch chain), 0 after. The build works. | 6c59ca3 |
| S2 login rate limit keyed to the server IP | No throttle built, as asked. The CLAUDE.md Production checklist now says to check which IP hosted Auth sees for the server-side sign-in, raise `sign_in_sign_ups` to class size, and forward the client IP or add a per-IP and per-username throttle. It also notes that a 429 already shows the distinct "Too many sign-ins" message. | a6996fe |

CLAUDE.md conventions were updated with each commit: views, the 0013 to 0015 `start_attempt` refusals, the 0016 assignment functions, the consent helper, and the checklist now says to apply every migration from 0001 onwards.

## TDD evidence (RED, then GREEN)

- **S1:** pgTAP `# Failed test 6: the student_questions view is gone ...`, then PASS after 0014.
- **C3:** pgTAP `Failed test 7: ... cannot start another exam set of the curriculum`, `caught: no exception`, then PASS after 0015. Vitest "one exam at a time per curriculum" failed with `AttemptError: in_progress` on the expired case, then passed with the lazy expiry (25/25).
- **C1/C2:** pgTAP `assignment_functions.test.sql` (20 tests) failed with `function public.reorder_curriculums(...) does not exist`, then PASS after 0016. The action tests asserting one `reorder_curriculums` / `remove_curriculum` RPC with the session's staff id failed (2), then 22/22 passed.
- **S3:** the new `src/app/(student)/exam/actions.test.ts` failed 3 tests (actions ran without consent), then 4/4 passed.

## Final full run

- `npm run lint`: clean
- `npm test`: 20 files, 233 tests passed
- `npm run db:reset` then `npm run db:test`: 6 files, 202 tests, PASS
- `npm run db:lint`: no results
- `npm run build` (after deleting .next): compiled successfully
- `npm run test:e2e`: 57 passed and 1 failed. The failure was `blocking.spec.ts` at 375: a 30 s test timeout while waiting on `next-exam`. The page snapshot shows the correct content, and the run as a whole was slow (7.2 min against 5.5 min before). Re-running that spec alone gave 4/4 passed, but the flow measured 27.6 s against the 30 s default. It now has `test.setTimeout(90_000)` (a047014), the same approach as full-flow and design, and the re-run gave 4/4 passed. The design spec's refreshed screenshots were discarded: this wave changed no visible UI, so the only differences were the timer and dates.

## Notes and concerns

- `remove_curriculum` refuses on any `in_progress` row. An expired attempt that server code has not closed yet would block it, but the action closes expired attempts in the curriculum first, as before.
- `reorder_curriculums` and `remove_curriculum` repeat the staff check in SQL (defence in depth). The action passes `profile.id` from `requireRole('staff')`, never a client value.
- The S1 drop is a breaking schema change for any outside PostgREST client that used the view. None is known; the app never used it.

## Addendum: CodeRabbit re-run (start_attempt lock)

- **Finding:** 0015 read the assignment `FOR SHARE`. A share lock does not block another share lock, so two concurrent `start_attempt` calls on different exam sets of one curriculum could both pass the `in_progress` check.
- **Fix:** `0017_start_attempt_lock_assignment.sql` replaces `start_attempt` (same signature, empty search_path, EXECUTE for service_role only). It now locks the assignment row `FOR UPDATE` before the `result_pending` and `in_progress` checks, so starts for one student and curriculum run one after another.
- **Lock order** (in the migration header and CLAUDE.md):
  - `start_attempt`, `grant_attempt`, `remove_curriculum` and `reorder_curriculums` lock the assignment, then grants, then new attempt rows.
  - `close_attempt` and `record_score` (which calls `release_attempt`) lock the existing attempt, then the assignment.
  - `start_attempt` never locks an existing attempt row, and `release_attempt` never touches grants, so the two cannot wait on each other.
- **RED:** a new vitest in `src/lib/attempts.test.ts` takes 6 students, each with grants on two exam sets of the same curriculum, and fires both `start_attempt` RPCs at once. It failed 3 out of 3 runs: "expected [null, null] to have a length of 1" (both starts succeeded). A new pgTAP check that `start_attempt` locks the assignment `FOR UPDATE` (via `pg_get_functiondef`) also failed.
- **GREEN:** after 0017, the concurrency test passed 3 out of 3 runs: exactly one start per student succeeds, the other gets `in_progress`, and each student has exactly one attempt in progress. `db:test` PASS (the sequential two-set `in_progress` test from 0015 is still there). The attempts, grants, release and exam-start vitest files: 85/85.

