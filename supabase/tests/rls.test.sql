-- RLS and privacy tests for the Phase 1 schema (pgTAP).
-- Run: npm run db:test   (needs the local stack: npm run db:start)
begin;
select plan(50);

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
-- The profile trigger is deferred (see 0003) so it sees the final row; fire it now.
set constraints all immediate;
set constraints all deferred;

insert into public.curriculums (id, name) values ('10000000-0000-0000-0000-000000000001', 'RLS Life in Germany');
insert into public.exam_sets (id, curriculum_id, name, question_count, time_limit_min, pass_mark_percent)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'LiG set 1', 2, 30, 60);

insert into public.questions (id, exam_set_id, topic, difficulty, stem_de, stem_en, options, correct_option_id, points, status)
select ('30000000-0000-0000-0000-00000000000' || n)::uuid, '20000000-0000-0000-0000-000000000001', 'law', 'easy',
       'Frage ' || n, 'Question ' || n,
       '[{"id":"a","de":"Ja","en":"Yes"},{"id":"b","de":"Nein","en":"No"}]'::jsonb, 'b', 1, 'approved'
from generate_series(1, 3) n;

insert into public.curriculums (id, name) values ('10000000-0000-0000-0000-000000000002', 'RLS Pflege Ausbildung');
insert into public.exam_sets (id, curriculum_id, name, question_count, time_limit_min, pass_mark_percent)
values ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Pflege set 1', 2, 30, 60);

-- Anna's real assignment status is 'passed'; Ben's is 'blocked'.
insert into public.assignments (student_id, curriculum_id, position, status) values
  ('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-000000000001', 1, 'passed'),
  ('00000000-0000-0000-0000-0000000000b2', '10000000-0000-0000-0000-000000000001', 1, 'blocked');

-- Anna: one released attempt, one submitted attempt (a score row written but not released, which
-- record_score never leaves behind since 0020; the view must still hide it), one in progress.
-- Ben: one in progress.
insert into public.attempts (id, student_id, exam_set_id, status, deadline_at, submitted_at, points, max_points, passed, released_at) values
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-000000000001', 'released',  now() - interval '2 days', now() - interval '2 days', 8, 10, true,  now() - interval '1 day'),
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-000000000001', 'submitted', now() - interval '1 hour', now() - interval '1 hour', 6, 10, true,  null),
  ('40000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-000000000001', 'in_progress', now() + interval '1 hour', null, null, null, null, null),
  ('40000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000b2', '20000000-0000-0000-0000-000000000001', 'in_progress', now() + interval '1 hour', null, null, null, null, null),
  -- Expired in-progress attempt on the second set (one in-progress attempt per student and set, see 0004).
  ('40000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-000000000002', 'in_progress', now() - interval '1 hour', null, null, null, null, null);

insert into public.attempt_questions (id, attempt_id, question_id, position, option_order) values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 1, '{b,a}'),
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000002', 1, '{a,b}'),
  ('50000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000003', 1, '{a,b}'),
  ('50000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 1, '{a,b}'),
  ('50000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000001', 1, '{a,b}');
insert into public.answers (attempt_question_id, option_id) values ('50000000-0000-0000-0000-000000000003', 'b');

-- ---------------------------------------------------------------------------
-- Profile trigger (as postgres)
-- ---------------------------------------------------------------------------
select is((select role from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'), 'staff',
  'trigger creates a staff profile from app metadata');
select is((select role from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'), 'student',
  'user metadata cannot make a student staff');
select is((select role || '/' || username from public.profiles where id = '00000000-0000-0000-0000-0000000000b2'), 'student/ben',
  'role defaults to student when app metadata has none');
select throws_ok($t$do $d$ begin
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'nouser@students.test', '{"role":"student"}', now(), now());
  set constraints all immediate;
end $d$$t$, 'P0001', 'username is required in raw_app_meta_data',
  'profile trigger rejects a user without a username in app metadata');
-- Auth admin API flow: insert with provider-only app metadata, then set the real metadata in the same transaction.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'admin-api@students.test', '{"provider":"email","providers":["email"]}', now(), now());
update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"student","username":"Carla","full_name":"Carla"}'
  where id = '00000000-0000-0000-0000-0000000000c2';
set constraints all immediate;
set constraints all deferred;
select is((select role || '/' || username from public.profiles where id = '00000000-0000-0000-0000-0000000000c2'), 'student/carla',
  'profile is built from app metadata set after the insert (Auth admin API flow)');
-- Total profiles as seen by postgres (the dev DB may hold e2e users); staff must see exactly this many.
select set_config('test.profile_total', (select count(*)::text from public.profiles), true);
-- Same for attempts and questions: the dev DB may hold e2e exam data (Task 5 seed).
select set_config('test.attempt_total', (select count(*)::text from public.attempts), true);
select set_config('test.question_total', (select count(*)::text from public.questions), true);
-- student_questions exposed stem_en and the English option text during an exam (0014 drops it).
select hasnt_view('public', 'student_questions', 'the student_questions view is gone, so students cannot read English text of an in-progress paper');
select hasnt_column('public', 'student_attempts', 'awarded_points', 'student attempt view has no awarded_points');
-- Scoring snapshot on Anna's released attempt (as postgres; record_score writes it in the app).
update public.attempt_questions set correct_option_id = 'b', max_points = 1, awarded_points = 1, topic = 'law'
  where id = '50000000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------------------
-- Student Anna
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;

select is((select count(*)::int from public.attempts), 0, 'student cannot select any row of the attempts table');
select is((select count(*)::int from public.student_attempts), 4, 'student sees all 4 of their own attempts through the view');
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
select is((select count(*)::int from public.attempt_questions), 0, 'student cannot select attempt_questions, so not the scoring snapshot');
select is((select count(*)::int from public.attempt_questions where awarded_points is not null or correct_option_id is not null), 0,
  'student cannot read the stored key or awarded points, not even of a released attempt');
select is((select count(*)::int from public.profiles), 1, 'student sees only their own profile');
-- Since 0025 no session may UPDATE profiles at all (it used to be a silent no-op under RLS).
select throws_ok($$update public.profiles set role = 'staff' where id = '00000000-0000-0000-0000-0000000000b1'$$, '42501', null,
  'student cannot update their profile (no privilege escalation)');
-- Students have no INSERT/UPDATE privilege on answers at all (0004): every save goes through
-- server code and public.save_answer, whose ownership, deadline and option checks are tested
-- in attempt_functions.test.sql.
select throws_ok($$insert into public.answers (attempt_question_id, option_id) values ('50000000-0000-0000-0000-000000000002', 'a')$$, '42501',
  null, 'student cannot insert answers directly, not even into their own open attempt');
select throws_ok($$update public.answers set option_id = 'a' where attempt_question_id = '50000000-0000-0000-0000-000000000003'$$, '42501',
  null, 'student cannot update answers directly');
select is((select count(*)::int from public.answers where attempt_question_id = '50000000-0000-0000-0000-000000000003'), 0,
  'student cannot read another student''s answers');
select is((select count(*)::int from public.student_assignments), 1, 'student sees only their own assignment through the view');
select is((select count(*)::int from public.assignments), 0, 'student cannot select the assignments table directly');
select hasnt_table('public', 'attempt_grants', 'attempt_grants is gone (0020), so there is nothing grant-related for a student to read');
select throws_ok($$insert into public.attempts (student_id, exam_set_id, deadline_at) values ('00000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-000000000001', now() + interval '1 hour')$$, '42501',
  null, 'student cannot insert attempts');
select throws_ok($$update public.attempts set status = 'released', points = 10 where id = '40000000-0000-0000-0000-000000000003'$$, '42501',
  null, 'student cannot update attempts');
select throws_ok($$insert into public.attempt_questions (attempt_id, question_id, position, option_order) values ('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', 2, '{a,b}')$$, '42501',
  null, 'student cannot insert attempt_questions');
select is((select count(*)::int from public.curriculums), 1, 'student reads only the curriculum assigned to them');
select is((select count(*)::int from public.exam_sets), 1, 'student reads only the exam sets of assigned curriculums');
select is((select status from public.student_assignments), 'passed',
  'student_assignments shows the real status even while an attempt is submitted (no masking since 0020)');

reset role;
update public.attempts set status = 'released', released_at = now() where id = '40000000-0000-0000-0000-000000000002';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
select is((select status from public.student_assignments), 'passed',
  'real assignment status is visible once the attempt is released');

reset role;

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;

select is((select count(*)::int from public.attempts where id::text like '40000000-%'), 5, 'staff can read all 5 fixture attempts');
select is((select count(*)::int from public.attempts), current_setting('test.attempt_total')::int, 'staff can read every attempt');
select is((select count(*)::int from public.questions where correct_option_id is not null), current_setting('test.question_total')::int, 'staff can read correct_option_id on every question');
select is((select count(*)::int from public.profiles where id::text like '00000000-0000-0000-0000-0000000000%'), 4, 'staff can read every fixture profile');
select is((select count(*)::int from public.profiles), current_setting('test.profile_total')::int, 'staff can read every profile, no more and no fewer than exist');
select throws_ok($$update public.attempts set points = 99 where id = '40000000-0000-0000-0000-000000000002'$$, '42501',
  null, 'staff cannot edit auto-scored points');

select throws_ok($$insert into public.attempts (student_id, exam_set_id, deadline_at) values ('00000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-000000000001', now() + interval '1 hour')$$, '42501',
  null, 'staff cannot insert attempts');
select throws_ok($$insert into public.answers (attempt_question_id, option_id) values ('50000000-0000-0000-0000-000000000002', 'a')$$, '42501',
  null, 'staff cannot insert answers');

-- Staff cannot delete students, curriculums or exam sets: the foreign keys cascade (without RLS)
-- into attempts, answers and the scoring snapshot, so a delete would erase results (0012). Since
-- 0013 the DELETE privilege itself is gone, so the attempt fails loudly instead of matching no rows.
select throws_ok($$delete from public.curriculums where id = '10000000-0000-0000-0000-000000000001'$$, '42501', null, 'staff have no DELETE privilege on curriculums');
select throws_ok($$delete from public.exam_sets where id = '20000000-0000-0000-0000-000000000001'$$, '42501', null, 'staff have no DELETE privilege on exam_sets');
select throws_ok($$delete from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'$$, '42501', null, 'staff have no DELETE privilege on profiles');
select is((select count(*)::int from public.curriculums where id = '10000000-0000-0000-0000-000000000001'), 1, 'staff cannot delete a curriculum');
select is((select count(*)::int from public.exam_sets where id = '20000000-0000-0000-0000-000000000001'), 1, 'staff cannot delete an exam set');
select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'), 1, 'staff cannot delete a student profile');
select is((select count(*)::int from public.attempts where id::text like '40000000-%'), 5, 'no attempt is removed by a staff delete');

reset role;

-- ---------------------------------------------------------------------------
-- Anonymous
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok($$select * from public.questions$$, '42501', null, 'anonymous users cannot read questions');

select throws_ok($$select * from public.student_attempts$$, '42501', null, 'anonymous users cannot read student_attempts');
select throws_ok($$select * from public.student_assignments$$, '42501', null, 'anonymous users cannot read student_assignments');

select * from finish();
rollback;
