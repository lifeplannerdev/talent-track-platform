# Percent first and the 90% pass mark

Branch `percent-first` (off `exam-controls`, which already has the `ui-polish` work). Nothing pushed or deployed. No remote service touched.

Owner request: "ALSO MAKE SURE WE MAINLY FOCUS ON PERCENTAGE. SHOW PERCENTAGE AND PASSING PERCENTAGE IS 90%"

## Skills and tools used

- `superpowers:test-driven-development`: RED then GREEN for the helpers, the SQL, the scoring snapshot and the readers (evidence below).
- `frontend-design`, `ui-ux-pro-max` (chart domain search: a bullet bar with a target marker for a single result against a threshold, which is what `ScoreBar` already is), `impeccable` (context loaded with `impeccable context`, craft floor read before the UI edits), `shadcn` (existing `Badge`, `Table`, `Card`; no new components needed), `web-design-guidelines` (final review, guidelines fetched fresh).
- Context7 was not needed. No new library APIs were used (only existing pgTAP functions, Supabase JS and Next patterns already in the repo).

## Schema changes (migration `0019_percent_first.sql`)

1. `exam_sets.pass_mark_percent` defaults to **90**. Before this it had no default. It stays NOT NULL and staff can still set 0 to 100.
2. New column `attempts.pass_mark_percent integer` with a check (0 to 100). This is the **pass mark snapshot**: `start_attempt` copies it from the exam set when the attempt starts.
3. `start_attempt` was replaced with the 0017 body plus the snapshot. Every guarantee is kept: the assignment row is locked FOR UPDATE (the lock order assignment -> grants -> new attempt rows is unchanged and documented in the header), `not_open`, `result_pending`, `in_progress` on another exam set of the curriculum, the unique in-progress index (`unique_violation` -> `in_progress`), the draw and unseen-question checks, the grant FOR UPDATE, database `now()`, security invoker, empty search_path, and EXECUTE for `service_role` only. All revokes and grants are stated explicitly.
4. `record_score` was replaced with the 0007 body plus one outcome check: `passed` must equal `points * 100 >= pass_mark * max_points`, using the snapshot (falling back to the exam set only for a legacy attempt with a null snapshot). Otherwise it raises `invalid_outcome`. A stored outcome can therefore never disagree with the pass mark shown next to it.
5. Backfill: unscored attempts get the exam set's current pass mark, which is the one they would have been scored with anyway. Scored attempts get it only when it agrees with their stored `passed`. Otherwise the snapshot stays NULL, and the reports then leave the pass mark out instead of showing a wrong one.

## Decision on existing exam sets

The migration also sets exam sets still at **60** (the old form default) to **90**. **This runs after the snapshot backfill.** That makes it safe:

- Released and held attempts keep their stored `points` and `passed`; nothing writes them. Their snapshot is the old 60, so the reports stay consistent.
- Attempts in progress keep their 60 snapshot and are scored against it.
- Only attempts started after the migration use 90.

Exam sets with any other pass mark keep it. Caveat: a staff member who deliberately chose 60 is moved to 90 too, because a deliberate 60 cannot be told apart from the old default. No hosted database exists yet, so today this only affects local data. Staff can set any exam set back in the form.

## App changes

- `src/lib/percent.ts` holds three pure helpers, tested in `percent.test.ts`:
  - `DEFAULT_PASS_MARK_PERCENT = 90`.
  - `meetsPassMark`: exact integer comparison.
  - `formatPercent`: whole numbers as "92%", otherwise one decimal ("66.7%"). It never rounds up onto a whole number, so 89.95% shows "89.9%" and 1999/2000 shows "99.9%", not "100%".
  - `percentValue`: the exact share, for bar widths.
- `scoreAttempt` decides pass or fail with `meetsPassMark`. `finalizeAttempt` scores against the attempt's snapshot.
- `getStudentResult` returns `percentLabel` and the snapshot pass mark. The snapshot is read with the service role only after the owner and released re-check, together with the topic totals. `getAttemptReview` returns `percentLabel` and the snapshot.
- Removed: `consistentPassMark` (and its tests) and `percentOf`.
- Student score report (`/results/[id]`, screen and A4 print):
  - "Prozent / Percent" over the large percentage (48 px, 56 px from 640 px).
  - The points line under it, in both languages: "2 von 3 Punkten / 2 of 3 points".
  - The Bestanden / Passed badge.
  - The bar with its tick at the pass mark, and "Bestehensgrenze / Pass mark 90%".
  - Topic table columns: Thema / Topic, Prozent / Percent, Punkte / Points, bar. On phones the points move under the percentage so the table fits without scrolling.
- Awaiting-review copy now reads "Your percentage and result appear here ... as soon as your trainer releases it." It contains no numbers.
- `/exam/start`:
  - "Your results" rows show the percentage large, "2 / 3 points" muted, and Passed / Not passed.
  - The ready card shows a Pass mark fact (`pass-mark`) and a rule line: "You pass with 90% of the points or more."
  - The pass mark is shown only in the ready state. Once an attempt exists its own snapshot applies, and pages before release show no percentages at all.
- Staff:
  - `ResultScore` (used on the results list, review list and student detail) shows the percentage first, then "2 / 3" muted, then Pass / Fail.
  - The evaluation view shows "Percent" with the large percentage, "2 of 3 points" under it, the snapshot pass mark, and topic rows in the order percent, points, bar.
  - The release dialog summary reads "66.7% (2 of 3 points)".
  - Dashboard: "Last score 0% (0 / 2)". The Blocked page shows the percentage over the points.
- Exam set form:
  - A new exam set defaults to 90.
  - Pass mark help text: "The standard is 90%. Students pass with this share of the points or more (0 to 100)." No other hint or nagging.
  - The edit warning now says that exams already started keep their pass mark.
- Fixtures:
  - `e2e/seed.ts` leaves the pass mark out unless a test sets it, so the database default of 90 is exercised. The held scenario sets 60 explicitly so that 2 of 3 is still a pass.
  - The demo seed (scratchpad `demo-seed.mjs`) now uses 90. Demo data was recreated: `Demo Prüfung` at 90, and the demo staff and student logins exist.
- Docs: `CLAUDE.md` has a new section, "Percent first and the 90% pass mark (0019)". `DESIGN.md` has a "Percent first" rule, an updated score report section and an exam start card entry. Screenshots in `docs/design-review/` are refreshed.

## RED / GREEN evidence

| Step | RED | GREEN |
|---|---|---|
| `percent.test.ts` (12 tests) | module `./percent` missing, suite failed to load | 12 passed |
| `scoring.test.ts`, 90% cases (9/10 and 18/20 pass; 17/19, 224/250 and 1799/2000 fail) | none: these passed on the old code too | Passing at once is expected: the old `ratio >= mark / 100` was already exact, because both sides are correctly rounded doubles of the same rational. Switched to `meetsPassMark` for clarity. |
| `supabase/tests/percent_first.test.sql` (19 tests) | `Column public.exam_sets.pass_mark_percent has no default`; insert without a pass mark violated NOT NULL | all 19 ok (234 pgTAP tests in total) |
| `attempts.test.ts`: "scores against the pass mark snapshot taken at start" | `Could not record score: invalid_outcome`: scoring used the live pass mark (changed to 0 mid-exam) and the new DB check refused it | 28 passed |
| `release.test.ts`: "reports keep the pass mark snapshot when staff change the exam set's pass mark later" (and `percentLabel` "57.1%") | old reader returned no `percentLabel` and hid the pass mark (null) after the change | 26 passed |
| `exam-start.test.ts`: `examSet.passMarkPercent` | `passMarkPercent` missing | 7 passed |

## Verification

- `npm run lint`: clean. `npx tsc --noEmit`: clean.
- `npm test`: 25 files, **291 passed**.
- `npm run db:reset` then `npm run db:test`: 8 files, **234 passed**. `npm run db:lint`: "No schema errors found".
- `npm run build`: succeeded.
- `npm run test:e2e`: **64 passed** (5.6 min). After the phone fix to the topic table, `design.spec` and `results.spec` were re-run: 8 passed. Axe found 0 serious or critical issues and there is no horizontal overflow at 375 px (both enforced by `design.spec`).
- Screenshots checked by eye at 375 px and desktop: report, print, start results list, start card (pass mark), staff evaluation, staff results.

## Concerns and follow-ups

- The 60 -> 90 move of existing exam sets (see the decision above) also catches a 60 that was chosen on purpose. Before production, confirm with the owner, or re-check the values after `supabase db push`.
- Percentages use a decimal point ("66.7%") on the bilingual report too, where German would write "66,7 %". This keeps one format across the app, in line with the "UI chrome in English" rule. Switch to `Intl.NumberFormat` per language if the owner wants German formatting on the report.
- Staff still see the "Pass" / "Fail" badge wording, while students see "Passed" / "Not passed" (unchanged from before).
- `attempts.pass_mark_percent` is nullable only for legacy scored rows whose outcome disagreed with the exam set at migration time. All new attempts get a value from `start_attempt`.
