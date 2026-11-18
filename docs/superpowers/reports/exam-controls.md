# Exam controls and time reminders (branch `exam-controls`, off `ui-polish`)

Owner request: "we want complete control like how many hours, how many question etc. also add a
reminder popup, make sure it never destroys any data and closable and every 15 minutes, how much
minutes left".

## Skills and tools used

superpowers:test-driven-development (RED then GREEN for every layer), frontend-design,
ui-ux-pro-max (toast/live-region and form grouping guidance), shadcn (project context: no `Field`
or toast installed, so the form keeps the existing Label + Input pattern and the reminder is built
from tokens and `Button`), impeccable (context + craft floor: removed a 2 px coloured left border
and a label-above-text from the preview), web-design-guidelines (final review; fixed missing
`autoComplete="off"` on number inputs; Title Case deliberately not applied, DESIGN.md mandates
sentence case). Context7 was not needed: the only library API used beyond the existing code is
Playwright `page.clock`, already used in the conventional way.

## Audit: what staff could set before

`exam_sets`: `question_count` (>0), `time_limit_min` (>0, no upper bound in DB, app max 600),
`pass_mark_percent` (0..100), `max_attempts` (>=1), `hold_result`, `topic_mix`. Form at
`/staff/curriculums/[id]` with a single "Time limit (minutes)" field. Questions and options are
always shuffled by `drawPaper`; there was no reminder.

## Schema change (migration `0018_exam_controls.sql`, additive)

- `exam_sets.reminder_interval_min integer not null default 15`, check `between 0 and 120`
  (0 = reminders off). Existing rows get 15.
- `exam_sets_time_limit_min_check` replaced by `between 1 and 720` (1 min to 12 h). The app never
  allowed more than 600, so no existing row is affected.
- No RLS or function changes; existing table grants cover the column.

## What staff can now control per exam set

Questions per paper (1..500), time limit as hours + minutes (1 min to 12 h, stored as minutes),
pass mark, maximum attempts, time reminder interval (0 or 1..120 min), hold results, topic mix.
The form shows a live line, e.g. "Students will get: 30 questions, 2 h 30 min, pass at 60%,
2 attempts, result held for review, reminder every 15 min"; each exam set card on the curriculum
page shows the same summary (`examSetSummary`). The warning that edits affect in-progress attempts
stays. Durations are shown as "2 h 30 min" on the staff cards and curriculum list, the student
start card and the exam bar (from 640 px). The results report shows no duration (it never did).

Question count end to end: form -> `validateExamSetFields` -> `saveExamSet` -> `startAttempt` draws
`question_count` (`drawPaper`) -> `start_attempt` refuses any draw whose length differs
(`invalid_draw`) -> pool warning vs 3 x question_count unchanged. New integration test proves that
editing count/duration leaves the running attempt's paper and deadline alone and the next attempt
uses the new values (2 questions, 150 min).

## Reminder behaviour

- Marks: every multiple of the interval below the full duration (`deadline - started_at`), plus
  5 and 1 minutes when the exam is longer, deduplicated. A 30 min exam with 15: 15, 5, 1. A 10 min
  exam: 5, 1. Interval 0: none at all.
- `reminderDue(remainingMs, totalMs, intervalMin, alreadyShown)` returns the latest crossed,
  unshown mark, only within 60 s of crossing it (so a reload or a clock jump never shows a stale
  "30 minutes left" at 27 minutes).
- Computed inside the existing server-anchored countdown tick; shown marks are kept in a ref and
  `sessionStorage` (try/catch), never in answers state.
- Banner inside the sticky exam bar: does not cover the question, options or the bottom bar,
  never takes focus, polite `role="status"`, 44 px "Close reminder" button, Escape closes when
  focused, hides after 20 s, a new one replaces the old. Urgent tint from 5 minutes. Fade-in is
  motion-safe only.

## RED / GREEN evidence

- Unit (vitest): new `duration.test.ts`, `reminders.test.ts`, additions to
  `exam-set-fields.test.ts`. RED: "Cannot find module './duration'", "Cannot find module
  './reminders'", 6 failing assertions (reminder interval, 12 h bound, `examSetSummary is not a
  function`). GREEN: 42/42.
- pgTAP `supabase/tests/exam_controls.test.sql` (12 tests). RED: `column "reminder_interval_min"
  does not exist`, Failed 12/12. GREEN after 0018: all 215 pgTAP tests pass.
- Integration: `content.test.ts` (saves 480 min + reminder 30, edit to 150 min + reminder 0) and
  `attempts.test.ts` (startedAt/reminderIntervalMin) RED: `expected NaN to be 1200000`, object
  mismatch; GREEN after wiring. Added the "edits apply to new attempts only" confirmation test.
- e2e `e2e/exam-controls.spec.ts` RED with the UI changes stashed: 2 failed (summary not found,
  "15 minutes left." not found); the "reminders off" case passed trivially. GREEN: 6/6 (both
  viewports). It covers: staff editing hours/minutes/reminder and the student start card showing
  "2 h 30 min"; the reminder at 15 min, choosing an option and moving on while it shows, focus not
  taken, no overlap with the question, axe clean, no horizontal overflow, Escape and button close,
  saved answers intact in the DB, the 5-minute reminder, submit still works; interval 0 shows none.
- `staff.spec.ts` and `full-flow.spec.ts` updated for the Hours/Minutes inputs; `design.spec.ts`
  now captures `05-exam-reminder-*` and `18-staff-exam-set-settings-*` (axe clean).

## Verification

`npm run lint` clean; `npm test` 24 files, 275 tests passed; `npm run db:reset`; `npm run db:test`
215 passed; `npm run db:lint` no schema errors; `npm run build` ok; `npm run test:e2e`: see below.
Screenshots checked at 375 px and desktop.

Full `npm run test:e2e` (both projects): 63 passed, 1 failed, and the failure was not an assertion:
Windows refused the write of `docs/design-review/09-exam-start-results-desktop.png` (`UNKNOWN:
unknown error, open`, file lock). The rerun of `e2e/design.spec.ts` passed 4/4 and refreshed every
screenshot. Demo data re-created afterwards (demo seed script copied, run, deleted).

## Not built (suggestions)

- Shuffle toggles: questions and options are always shuffled today (`drawPaper`); toggles would be
  cheap but nobody asked to turn shuffling off (YAGNI).
- An "available from / until" window, per-student time extensions (accessibility), showing the
  actual attempt duration on the report, and a staff-chosen reminder text.
- A reminder sound or vibration (deliberately left out: exam halls).

## Concerns

- The banner pushes the page down by about 52 px when it appears (chosen over an overlay that
  would cover the question on a 375 px phone). A tap landing exactly as it appears could hit the
  option below; any such choice is reversible and saved like any other.
- The reminder interval is read live, so a staff edit during an exam changes the remaining
  reminders of running attempts (display only; paper, deadline and scoring are unaffected).
- If `sessionStorage` is unavailable, a reload within 60 s of a mark can show that reminder once
  more.
- The DB upper bound on `time_limit_min` is new: production must apply 0018 (in order) like the
  other migrations.
