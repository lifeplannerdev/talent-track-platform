-- Fix wave 2 (0024): the allowance is read after the assignment lock (start_attempt,
-- record_score), a NULL draw is refused, and extra attempts lift a block only when the new
-- allowance exceeds the attempts already used.
begin;
select plan(16);

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000024a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ar.staff@staff.test', '{"role":"staff","username":"ar.staff","full_name":"Ar Staff"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000024b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ar.one@students.test', '{"role":"student","username":"ar.one","full_name":"Ar One"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000024b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ar.two@students.test', '{"role":"student","username":"ar.two","full_name":"Ar Two"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000024b3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ar.three@students.test', '{"role":"student","username":"ar.three","full_name":"Ar Three"}', '{}', now(), now());
set constraints all immediate;
set constraints all deferred;

-- One curriculum, 2 attempts per student, six exam sets of one approved question each.
insert into public.curriculums (id, name, max_attempts) values ('10000000-0000-0000-0000-0000000024c1', 'Ar Curriculum', 2);
insert into public.exam_sets (id, curriculum_id, name, question_count, time_limit_min, pass_mark_percent)
select ('20000000-0000-0000-0000-00000000240' || n)::uuid, '10000000-0000-0000-0000-0000000024c1', 'Ar set ' || n, 1, 10, 100
from generate_series(1, 6) n;
insert into public.questions (id, exam_set_id, topic, difficulty, stem_de, stem_en, options, correct_option_id, points, status)
select ('30000000-0000-0000-0000-00000000240' || n)::uuid, ('20000000-0000-0000-0000-00000000240' || n)::uuid, 't', 'easy',
       'Frage ' || n, 'Question ' || n, '[{"id":"a","de":"Ja","en":"Yes"},{"id":"b","de":"Nein","en":"No"}]'::jsonb, 'b', 1, 'approved'
from generate_series(1, 6) n;

insert into public.assignments (student_id, curriculum_id, position, status) values
  ('00000000-0000-0000-0000-0000000024b1', '10000000-0000-0000-0000-0000000024c1', 1, 'open'),
  ('00000000-0000-0000-0000-0000000024b2', '10000000-0000-0000-0000-0000000024c1', 1, 'open'),
  ('00000000-0000-0000-0000-0000000024b3', '10000000-0000-0000-0000-0000000024c1', 1, 'blocked');

-- ar.one: one failed attempt used (1 of 2).
insert into public.attempts (student_id, exam_set_id, status, deadline_at, submitted_at, points, max_points, passed, released_at)
values ('00000000-0000-0000-0000-0000000024b1', '20000000-0000-0000-0000-000000002401', 'released', now(), now(), 0, 1, false, now());
-- ar.three: five failed attempts used under an old, larger allowance; the limit is now 2.
insert into public.attempts (student_id, exam_set_id, status, deadline_at, submitted_at, points, max_points, passed, released_at)
select '00000000-0000-0000-0000-0000000024b3', ('20000000-0000-0000-0000-00000000240' || n)::uuid, 'released', now(), now(), 0, 1, false, now()
from generate_series(1, 5) n;

-- S3: a NULL draw is invalid ------------------------------------------------------------------
select throws_ok(
  $$select public.start_attempt('00000000-0000-0000-0000-0000000024b2', '20000000-0000-0000-0000-000000002402', null)$$,
  'P0001', 'invalid_draw', 'start_attempt refuses a NULL draw');
select throws_ok(
  $$select public.start_attempt('00000000-0000-0000-0000-0000000024b2', '20000000-0000-0000-0000-000000002402', '{"question_id":"x"}'::jsonb)$$,
  'P0001', 'invalid_draw', 'start_attempt refuses a draw that is not an array');
select is(
  (select count(*)::int from public.attempts where student_id = '00000000-0000-0000-0000-0000000024b2'),
  0, 'no attempt was created for an invalid draw');

-- S1: start_attempt reads max_attempts after locking the assignment --------------------------
select ok(
  pg_get_functiondef('public.start_attempt(uuid, uuid, jsonb)'::regprocedure)
    !~* 'join\s+public\.curriculums',
  'start_attempt does not read the curriculum limit in the exam-set lookup before the lock');
select ok(
  pg_get_functiondef('public.start_attempt(uuid, uuid, jsonb)'::regprocedure)
    ~* 'for\s+update[\s\S]*select\s+max_attempts\s+into\s+v_max_attempts\s+from\s+public\.curriculums',
  'start_attempt reads max_attempts in its own statement after the assignment FOR UPDATE');
-- Staff lower the limit to 1 before the call: ar.one (1 used) has no attempt left.
update public.curriculums set max_attempts = 1 where id = '10000000-0000-0000-0000-0000000024c1';
select throws_ok(
  $$select public.start_attempt('00000000-0000-0000-0000-0000000024b1', '20000000-0000-0000-0000-000000002402',
      '[{"question_id":"30000000-0000-0000-0000-000000002402","option_order":["a","b"]}]'::jsonb)$$,
  'P0001', 'no_attempts_left', 'a lowered limit is respected by start_attempt');
update public.curriculums set max_attempts = 2 where id = '10000000-0000-0000-0000-0000000024c1';
select lives_ok(
  $$select public.start_attempt('00000000-0000-0000-0000-0000000024b1', '20000000-0000-0000-0000-000000002402',
      '[{"question_id":"30000000-0000-0000-0000-000000002402","option_order":["a","b"]}]'::jsonb)$$,
  'with the limit back at 2 the second attempt starts');

-- S2: record_score reads the allowance after locking the assignment ---------------------------
select ok(
  pg_get_functiondef('public.record_score(uuid, integer, integer, boolean, jsonb)'::regprocedure)
    !~* 'join\s+public\.curriculums\s+c\s+on\s+c\.id\s*=\s*asg\.curriculum_id',
  'record_score does not join the curriculum into the assignment lock');
select ok(
  pg_get_functiondef('public.record_score(uuid, integer, integer, boolean, jsonb)'::regprocedure)
    ~* 'from\s+public\.assignments[\s\S]*for\s+update[\s\S]*select\s+max_attempts\s+into\s+v_max_attempts\s+from\s+public\.curriculums',
  'record_score reads max_attempts in its own statement after locking the assignment');
-- Close and fail ar.one's second attempt: 2 of 2 used, so it blocks.
select public.close_attempt(
  (select id from public.attempts where student_id = '00000000-0000-0000-0000-0000000024b1' and status = 'in_progress'), false);
select is(
  public.record_score(
    (select id from public.attempts where student_id = '00000000-0000-0000-0000-0000000024b1' and status = 'submitted'),
    0, 1, false,
    (select jsonb_agg(jsonb_build_object('attempt_question_id', aq.id, 'correct_option_id', 'b', 'max_points', 1,
                                         'awarded_points', 0, 'topic', 't'))
     from public.attempt_questions aq join public.attempts a on a.id = aq.attempt_id
     where a.student_id = '00000000-0000-0000-0000-0000000024b1' and a.status = 'submitted')),
  'released', 'the failed second attempt is released');
select is(
  (select status from public.assignments where student_id = '00000000-0000-0000-0000-0000000024b1'),
  'blocked', 'the last allowed failed attempt blocks');

-- S4: extra attempts lift a block only when the allowance then exceeds attempts used ----------
select lives_ok(
  $$select public.give_extra_attempts('00000000-0000-0000-0000-0000000024a1', '00000000-0000-0000-0000-0000000024b3',
      '10000000-0000-0000-0000-0000000024c1', 1, false)$$,
  'giving 1 extra attempt to a student with 5 used of 2 works');
select is(
  (select status || ':' || extra_attempts from public.assignments where student_id = '00000000-0000-0000-0000-0000000024b3'),
  'blocked:1', '2 + 1 = 3 does not exceed 5 used: still blocked, the extra attempt is kept');
select lives_ok(
  $$select public.give_extra_attempts('00000000-0000-0000-0000-0000000024a1', '00000000-0000-0000-0000-0000000024b3',
      '10000000-0000-0000-0000-0000000024c1', 3, false)$$,
  'giving 3 more works');
select is(
  (select status || ':' || extra_attempts from public.assignments where student_id = '00000000-0000-0000-0000-0000000024b3'),
  'open:4', '2 + 4 = 6 exceeds 5 used: the block is lifted');
select ok(
  not has_function_privilege('authenticated', 'public.give_extra_attempts(uuid, uuid, uuid, integer, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.start_attempt(uuid, uuid, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.record_score(uuid, integer, integer, boolean, jsonb)', 'execute')
  and has_function_privilege('service_role', 'public.give_extra_attempts(uuid, uuid, uuid, integer, boolean)', 'execute')
  and has_function_privilege('service_role', 'public.start_attempt(uuid, uuid, jsonb)', 'execute')
  and has_function_privilege('service_role', 'public.record_score(uuid, integer, integer, boolean, jsonb)', 'execute'),
  'the three functions stay service role only');

select * from finish();
rollback;
