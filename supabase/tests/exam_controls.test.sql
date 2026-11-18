-- Exam controls (0018, pgTAP): reminder interval per exam set and duration bounds.
-- Run: npm run db:test
begin;
select plan(12);

insert into public.curriculums (id, name) values ('10000000-0000-0000-0000-0000000018c1', 'EC curriculum');

-- Column exists, is NOT NULL and defaults to 15 minutes.
select has_column('public', 'exam_sets', 'reminder_interval_min', 'exam_sets has reminder_interval_min');
select col_not_null('public', 'exam_sets', 'reminder_interval_min', 'reminder_interval_min is not null');
select col_default_is('public', 'exam_sets', 'reminder_interval_min', '15', 'reminder_interval_min defaults to 15');

-- An insert without the column (existing callers) gets the default: today's behaviour plus reminders.
insert into public.exam_sets (id, curriculum_id, name, question_count, time_limit_min, pass_mark_percent)
values ('20000000-0000-0000-0000-0000000018e1', '10000000-0000-0000-0000-0000000018c1', 'EC default', 1, 30, 50);
select is(
  (select reminder_interval_min from public.exam_sets where id = '20000000-0000-0000-0000-0000000018e1'),
  15, 'existing inserts get a 15 minute reminder interval');

-- Reminder interval: 0 (off) and 1..120 allowed, everything else refused.
select lives_ok(
  $$update public.exam_sets set reminder_interval_min = 0 where id = '20000000-0000-0000-0000-0000000018e1'$$,
  'reminder interval 0 (off) is allowed');
select lives_ok(
  $$update public.exam_sets set reminder_interval_min = 120 where id = '20000000-0000-0000-0000-0000000018e1'$$,
  'reminder interval 120 is allowed');
select throws_ok(
  $$update public.exam_sets set reminder_interval_min = 121 where id = '20000000-0000-0000-0000-0000000018e1'$$,
  '23514', null, 'reminder interval above 120 is refused');
select throws_ok(
  $$update public.exam_sets set reminder_interval_min = -1 where id = '20000000-0000-0000-0000-0000000018e1'$$,
  '23514', null, 'negative reminder interval is refused');

-- Duration: 1 minute to 12 hours (720 minutes).
select lives_ok(
  $$update public.exam_sets set time_limit_min = 480 where id = '20000000-0000-0000-0000-0000000018e1'$$,
  'an 8 hour exam is allowed');
select lives_ok(
  $$update public.exam_sets set time_limit_min = 720 where id = '20000000-0000-0000-0000-0000000018e1'$$,
  'a 12 hour exam is allowed');
select throws_ok(
  $$update public.exam_sets set time_limit_min = 721 where id = '20000000-0000-0000-0000-0000000018e1'$$,
  '23514', null, 'an exam longer than 12 hours is refused');
select throws_ok(
  $$update public.exam_sets set time_limit_min = 0 where id = '20000000-0000-0000-0000-0000000018e1'$$,
  '23514', null, 'a zero minute exam is refused');

select * from finish();
rollback;
