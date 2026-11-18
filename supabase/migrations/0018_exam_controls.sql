-- Exam controls: more staff settings per exam set (additive; existing rows keep their behaviour).
--
-- 1. reminder_interval_min: minutes between "N minutes left" reminders on the student exam
--    screen, counted from the start (so they fall on remaining 15, 30, ...); 0 turns reminders
--    off. Default 15. Read by server code only (getAttemptForStudent), never used for scoring.
-- 2. time_limit_min gets an upper bound of 12 hours (720 minutes), matching the app
--    (MAX_DURATION_MIN in src/lib/duration.ts). The lower bound stays 1 minute. The app allowed
--    at most 600 before, so no existing row is affected.

alter table public.exam_sets
  add column reminder_interval_min integer not null default 15
    constraint exam_sets_reminder_interval_min_check check (reminder_interval_min between 0 and 120);

alter table public.exam_sets drop constraint exam_sets_time_limit_min_check;
alter table public.exam_sets
  add constraint exam_sets_time_limit_min_check check (time_limit_min between 1 and 720);
