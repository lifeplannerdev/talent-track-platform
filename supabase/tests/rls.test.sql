-- RLS and privacy tests for the Phase 1 schema (pgTAP).
-- Run: npm run db:test   (needs the local stack: npm run db:start)
begin;
select plan(22);

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres). Auth users are created like the staff action will
-- create them: role and username live in raw_app_meta_data, which end users
-- cannot edit; the on_auth_user_created trigger builds the profile row.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'staff1@staff.test', '{"role":"staff","username":"staff1","full_name":"Staff One"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'anna@students.test', '{"role":"student","username":"anna","full_name":"Anna","batch":"2026-A","track":"nursing"}', '{"role":"staff"}', now(), now()),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ben@students.test', '{"username":"ben","full_name":"Ben"}', '{}', now(), now());

insert into public.curriculums (id, name) values ('10000000-0000-0000-0000-000000000001', 'Life in Germany');
insert into public.exam_sets (id, curriculum_id, name, question_count, time_limit_min, pass_mark_percent, max_attempts, hold_result)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'LiG set 1', 2, 30, 60, 2, true);

insert into public.questions (id, exam_set_id, topic, difficulty, stem_de, stem_en, options, correct_option_id, points, status)
select ('30000000-0000-0000-0000-00000000000' || n)::uuid, '20000000-0000-0000-0000-000000000001', 'law', 'easy',
       'Frage ' || n, 'Question ' || n,
       '[{"id":"a","de":"Ja","en":"Yes"},{"id":"b","de":"Nein","en":"No"}]'::jsonb, 'b', 1, 'approved'
from generate_series(1, 3) n;

insert into public.assignments (student_id, curriculum_id, position)
values ('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-000000000001', 1);

-- Anna: one released attempt, one held (submitted) attempt, one in progress. Ben: one in progress.
insert into public.attempts (id, student_id, exam_set_id, status, deadline_at, submitted_at, points, max_points, passed, released_at) values
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-000000000001', 'released',  now() - interval '2 days', now() - interval '2 days', 8, 10, true,  now() - interval '1 day'),
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-000000000001', 'submitted', now() - interval '1 hour', now() - interval '1 hour', 6, 10, true,  null),
  ('40000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-000000000001', 'in_progress', now() + interval '1 hour', null, null, null, null, null),
  ('40000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000b2', '20000000-0000-0000-0000-000000000001', 'in_progress', now() + interval '1 hour', null, null, null, null, null);

insert into public.attempt_questions (id, attempt_id, question_id, position, option_order) values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 1, '{b,a}'),
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000002', 1, '{a,b}'),
  ('50000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000003', 1, '{a,b}');

-- ---------------------------------------------------------------------------
-- Profile trigger (as postgres)
-- ---------------------------------------------------------------------------
select is((select role from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'), 'staff',
  'trigger creates a staff profile from app metadata');
select is((select role from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'), 'student',
  'user metadata cannot make a student staff');
select is((select role || '/' || username from public.profiles where id = '00000000-0000-0000-0000-0000000000b2'), 'student/ben',
  'role defaults to student when app metadata has none');
select hasnt_column('public', 'student_questions', 'correct_option_id', 'student question view has no correct_option_id');

-- ---------------------------------------------------------------------------
-- Student Anna
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;

select is((select count(*)::int from public.attempts), 0, 'student cannot select any row of the attempts table');
select is((select count(*)::int from public.student_attempts), 3, 'student sees all 3 of their own attempts through the view');
select is((select count(*)::int from public.student_attempts where student_id <> '00000000-0000-0000-0000-0000000000b1'), 0,
  'student cannot see another student''s attempts');
select is((select points from public.student_attempts where id = '40000000-0000-0000-0000-000000000001'), 8,
  'points are visible once the attempt is released');
select is((select passed from public.student_attempts where id = '40000000-0000-0000-0000-000000000001'), true,
  'passed is visible once the attempt is released');
select is((select points from public.student_attempts where id = '40000000-0000-0000-0000-000000000002'), null,
  'points are hidden while the attempt is submitted but not released');
select is((select passed from public.student_attempts where id = '40000000-0000-0000-0000-000000000002'), null,
  'passed is hidden while the attempt is submitted but not released');
select is((select count(*)::int from public.questions), 0, 'student cannot read the questions table (so no correct_option_id)');
select is((select count(*)::int from public.student_questions), 2, 'student sees only the questions drawn into their own attempts');
select is((select count(*)::int from public.profiles), 1, 'student sees only their own profile');
select is_empty($$update public.profiles set role = 'staff' where id = '00000000-0000-0000-0000-0000000000b1' returning id$$,
  'student cannot update their profile (no privilege escalation)');
select lives_ok($$insert into public.answers (attempt_question_id, option_id) values ('50000000-0000-0000-0000-000000000002', 'a')$$,
  'student can save an answer in their own in-progress attempt');
select throws_ok($$insert into public.answers (attempt_question_id, option_id) values ('50000000-0000-0000-0000-000000000003', 'a')$$, '42501',
  null, 'student cannot save an answer into another student''s attempt');

reset role;

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;

select is((select count(*)::int from public.attempts), 4, 'staff can read every attempt');
select is((select count(*)::int from public.questions where correct_option_id is not null), 3, 'staff can read correct_option_id');
select is((select count(*)::int from public.profiles), 3, 'staff can read every profile');
select throws_ok($$update public.attempts set points = 99 where id = '40000000-0000-0000-0000-000000000002'$$, '42501',
  null, 'staff cannot edit auto-scored points');

reset role;

-- ---------------------------------------------------------------------------
-- Anonymous
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok($$select * from public.questions$$, '42501', null, 'anonymous users cannot read questions');

select * from finish();
rollback;
