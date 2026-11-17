-- Final review hardening (0013, pgTAP). Run: npm run db:test
--   * functions created later are not executable by PUBLIC (so not by anon or authenticated);
--   * start_attempt refuses unless the student's assignment for the curriculum is 'open', and
--     refuses while a held (submitted, unreleased) result exists anywhere in the curriculum.
begin;
select plan(12);

-- Default privileges -----------------------------------------------------------
create function public.zz_probe_0013() returns integer language sql as 'select 1';
create function private.zz_probe_0013() returns integer language sql as 'select 1';
select ok(not has_function_privilege('anon', 'public.zz_probe_0013()', 'execute'), 'a new public function is not executable by anon');
select ok(not has_function_privilege('authenticated', 'public.zz_probe_0013()', 'execute'), 'a new public function is not executable by authenticated');
select ok(not has_function_privilege('authenticated', 'private.zz_probe_0013()', 'execute'), 'a new function in another schema is not executable by authenticated');

-- start_attempt serialises starts per student and curriculum: the assignment row is locked FOR
-- UPDATE (0017). FOR SHARE (0013/0015) let two concurrent starts on different exam sets both pass
-- the in_progress check; the concurrent case is tested in src/lib/attempts.test.ts.
select ok(
  pg_get_functiondef('public.start_attempt(uuid, uuid, jsonb)'::regprocedure)
    ~ 'from public\.assignments\s+where student_id = p_student_id and curriculum_id = v_curriculum_id\s+for update',
  'start_attempt locks the student''s assignment row FOR UPDATE');

-- Fixtures -------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000013b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'fr-anna@students.test', '{"role":"student","username":"fr.anna"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000013b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'fr-ben@students.test', '{"role":"student","username":"fr.ben"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000013b3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'fr-cara@students.test', '{"role":"student","username":"fr.cara"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000013b4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'fr-dora@students.test', '{"role":"student","username":"fr.dora"}', '{}', now(), now());
set constraints all immediate;
set constraints all deferred;

insert into public.curriculums (id, name) values ('10000000-0000-0000-0000-0000000013c1', 'FR curriculum');
insert into public.exam_sets (id, curriculum_id, name, question_count, time_limit_min, pass_mark_percent, max_attempts, hold_result) values
  ('20000000-0000-0000-0000-0000000013e1', '10000000-0000-0000-0000-0000000013c1', 'FR held', 1, 15, 50, 2, true),
  ('20000000-0000-0000-0000-0000000013e2', '10000000-0000-0000-0000-0000000013c1', 'FR second', 1, 15, 50, 2, true);
insert into public.questions (id, exam_set_id, topic, difficulty, stem_de, stem_en, options, correct_option_id, status) values
  ('30000000-0000-0000-0000-0000000013f1', '20000000-0000-0000-0000-0000000013e1', 't', 'easy', 'Frage 1', 'Question 1',
   '[{"id":"a","de":"Ja","en":"Yes"},{"id":"b","de":"Nein","en":"No"}]', 'a', 'approved'),
  ('30000000-0000-0000-0000-0000000013f2', '20000000-0000-0000-0000-0000000013e2', 't', 'easy', 'Frage 2', 'Question 2',
   '[{"id":"a","de":"Ja","en":"Yes"},{"id":"b","de":"Nein","en":"No"}]', 'a', 'approved');

-- Anna: blocked, but holds a grant (state left by a race or older code).
-- Ben: not assigned, but holds a grant.
-- Cara: open, held result on set 1 and a grant on set 2.
insert into public.assignments (student_id, curriculum_id, position, status) values
  ('00000000-0000-0000-0000-0000000013b1', '10000000-0000-0000-0000-0000000013c1', 1, 'blocked'),
  ('00000000-0000-0000-0000-0000000013b3', '10000000-0000-0000-0000-0000000013c1', 1, 'open'),
  ('00000000-0000-0000-0000-0000000013b4', '10000000-0000-0000-0000-0000000013c1', 1, 'open');
insert into public.attempt_grants (student_id, exam_set_id) values
  ('00000000-0000-0000-0000-0000000013b1', '20000000-0000-0000-0000-0000000013e2'),
  ('00000000-0000-0000-0000-0000000013b2', '20000000-0000-0000-0000-0000000013e2'),
  ('00000000-0000-0000-0000-0000000013b3', '20000000-0000-0000-0000-0000000013e2'),
  ('00000000-0000-0000-0000-0000000013b4', '20000000-0000-0000-0000-0000000013e2');
insert into public.attempts (student_id, exam_set_id, status, deadline_at, submitted_at, points, max_points, passed) values
  ('00000000-0000-0000-0000-0000000013b3', '20000000-0000-0000-0000-0000000013e1', 'submitted', now() - interval '1 hour', now() - interval '1 hour', 0, 1, false),
  -- Dora: an exam in progress on set 1 and a grant on set 2 (CodeRabbit C3).
  ('00000000-0000-0000-0000-0000000013b4', '20000000-0000-0000-0000-0000000013e1', 'in_progress', now() + interval '1 hour', null, null, null, null);

create function pg_temp.draw() returns jsonb language sql as $f$
  select '[{"question_id":"30000000-0000-0000-0000-0000000013f2","option_order":["a","b"]}]'::jsonb
$f$;
grant execute on all functions in schema pg_temp to public;

set local role service_role;

-- start_attempt: assignment must be open --------------------------------------
select throws_ok($$select public.start_attempt('00000000-0000-0000-0000-0000000013b1', '20000000-0000-0000-0000-0000000013e2', pg_temp.draw())$$,
  'P0001', 'not_open', 'a blocked student cannot start, even holding a grant');
select throws_ok($$select public.start_attempt('00000000-0000-0000-0000-0000000013b2', '20000000-0000-0000-0000-0000000013e2', pg_temp.draw())$$,
  'P0001', 'not_open', 'a student without an assignment cannot start, even holding a grant');

-- start_attempt: no start while a result in the curriculum is held --------------
select throws_ok($$select public.start_attempt('00000000-0000-0000-0000-0000000013b3', '20000000-0000-0000-0000-0000000013e2', pg_temp.draw())$$,
  'P0001', 'result_pending', 'a student with a held result cannot start another exam set of the curriculum');
select throws_ok($$select public.start_attempt('00000000-0000-0000-0000-0000000013b4', '20000000-0000-0000-0000-0000000013e2', pg_temp.draw())$$,
  'P0001', 'in_progress', 'a student with an exam in progress cannot start another exam set of the curriculum');
select is((select count(*)::int from public.attempts where student_id = '00000000-0000-0000-0000-0000000013b4'), 1,
  'the in-progress refusal creates no attempt');
select is((select count(*)::int from public.attempts where student_id::text like '00000000-0000-0000-0000-0000000013b%' and status = 'in_progress' and student_id <> '00000000-0000-0000-0000-0000000013b4'), 0,
  'the refusals create no attempt');

-- Once the held result is released (failed, attempts left), the grant can be used.
reset role;
update public.attempts set status = 'released', released_at = now()
where student_id = '00000000-0000-0000-0000-0000000013b3';
set local role service_role;
select lives_ok($$select public.start_attempt('00000000-0000-0000-0000-0000000013b3', '20000000-0000-0000-0000-0000000013e2', pg_temp.draw())$$,
  'after release the student can start with the grant');
select is((select count(*)::int from public.attempts where student_id = '00000000-0000-0000-0000-0000000013b3' and status = 'in_progress'), 1,
  'one attempt in progress');

reset role;
select * from finish();
rollback;
