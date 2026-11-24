-- give_extra_attempts and remove_curriculum without grants (0021, pgTAP). Run: npm run db:test
begin;
select plan(38);

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000021a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'xa-staff@staff.test', '{"role":"staff","username":"xa.staff"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000021a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'xa-t1@staff.test', '{"role":"trainer","username":"xa.t1"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000021a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'xa-t2@staff.test', '{"role":"trainer","username":"xa.t2"}', '{}', now(), now());
set constraints all immediate;
set constraints all deferred;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000021b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'xa-anna@students.test', '{"role":"student","username":"xa.anna"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000021b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'xa-ben@students.test', '{"role":"student","username":"xa.ben"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000021b3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'xa-cara@students.test', '{"role":"student","username":"xa.cara"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000021b4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'xa-dan@students.test', '{"role":"student","username":"xa.dan"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000021b5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'xa-eve@students.test', '{"role":"student","username":"xa.eve","trainer_id":"00000000-0000-0000-0000-0000000021a2"}', '{}', now(), now());
set constraints all immediate;
set constraints all deferred;

insert into public.curriculums (id, name) values ('10000000-0000-0000-0000-0000000021c1', 'XA curriculum');
insert into public.exam_sets (id, curriculum_id, name, question_count, time_limit_min, pass_mark_percent) values
  ('20000000-0000-0000-0000-0000000021e1', '10000000-0000-0000-0000-0000000021c1', 'XA set 1', 1, 15, 50),
  ('20000000-0000-0000-0000-0000000021e2', '10000000-0000-0000-0000-0000000021c1', 'XA set 2', 1, 15, 50),
  ('20000000-0000-0000-0000-0000000021e3', '10000000-0000-0000-0000-0000000021c1', 'XA set 3', 1, 15, 50);
insert into public.questions (id, exam_set_id, topic, difficulty, stem_de, stem_en, options, correct_option_id, status)
select ('30000000-0000-0000-0000-0000000021' || lpad(n::text, 2, '0'))::uuid,
       ('20000000-0000-0000-0000-0000000021e' || n)::uuid,
       't', 'easy', 'Frage ' || n, 'Question ' || n,
       '[{"id":"a","de":"Ja","en":"Yes"},{"id":"b","de":"Nein","en":"No"}]'::jsonb, 'b', 'approved'
from generate_series(1, 3) n;

-- Anna and Cara open, Ben passed, Dan not assigned.
insert into public.assignments (student_id, curriculum_id, position, status) values
  ('00000000-0000-0000-0000-0000000021b1', '10000000-0000-0000-0000-0000000021c1', 1, 'open'),
  ('00000000-0000-0000-0000-0000000021b2', '10000000-0000-0000-0000-0000000021c1', 1, 'passed'),
  ('00000000-0000-0000-0000-0000000021b3', '10000000-0000-0000-0000-0000000021c1', 1, 'open'),
  ('00000000-0000-0000-0000-0000000021b5', '10000000-0000-0000-0000-0000000021c1', 1, 'open');

create function pg_temp.snap(p_attempt uuid, p_awarded int[]) returns jsonb language sql as $f$
  select jsonb_agg(jsonb_build_object(
           'attempt_question_id', aq.id, 'correct_option_id', q.correct_option_id,
           'max_points', q.points, 'awarded_points', p_awarded[aq.position], 'topic', q.topic)
         order by aq.position)
  from public.attempt_questions aq join public.questions q on q.id = aq.question_id
  where aq.attempt_id = p_attempt
$f$;
create function pg_temp.take(p_student uuid, p_set uuid, p_q uuid, p_pass boolean) returns uuid language plpgsql as $f$
declare v uuid;
begin
  v := public.start_attempt(p_student, p_set,
    jsonb_build_array(jsonb_build_object('question_id', p_q, 'option_order', array['a', 'b'])));
  perform public.close_attempt(v, false);
  perform public.record_score(v, case when p_pass then 1 else 0 end, 1, p_pass,
    pg_temp.snap(v, case when p_pass then array[1] else array[0] end));
  return v;
end $f$;
create function pg_temp.state(p_student uuid) returns text language sql as $f$
  select status || '/' || extra_attempts || '/' || allow_repeats
  from public.assignments where student_id = p_student and curriculum_id = '10000000-0000-0000-0000-0000000021c1'
$f$;
grant execute on all functions in schema pg_temp to public;

-- Function, privileges, hardening ------------------------------------------------------
select has_function('public', 'give_extra_attempts', array['uuid', 'uuid', 'uuid', 'integer', 'boolean'], 'give_extra_attempts exists');
select ok(not has_function_privilege('public', 'public.give_extra_attempts(uuid, uuid, uuid, integer, boolean)', 'execute'), 'PUBLIC cannot execute give_extra_attempts');
select ok(not has_function_privilege('anon', 'public.give_extra_attempts(uuid, uuid, uuid, integer, boolean)', 'execute'), 'anon cannot execute give_extra_attempts');
select ok(not has_function_privilege('authenticated', 'public.give_extra_attempts(uuid, uuid, uuid, integer, boolean)', 'execute'), 'authenticated cannot execute give_extra_attempts');
select ok(has_function_privilege('service_role', 'public.give_extra_attempts(uuid, uuid, uuid, integer, boolean)', 'execute'), 'service_role can execute give_extra_attempts');
select is((select proconfig from pg_proc where oid = 'public.give_extra_attempts(uuid, uuid, uuid, integer, boolean)'::regprocedure),
  array['search_path=""'], 'give_extra_attempts has an empty search_path');
select is((select prosecdef from pg_proc where oid = 'public.give_extra_attempts(uuid, uuid, uuid, integer, boolean)'::regprocedure),
  false, 'give_extra_attempts is security invoker');
select ok((select prosrc ~* 'from public\.assignments[^;]*for update' from pg_proc where oid = 'public.give_extra_attempts(uuid, uuid, uuid, integer, boolean)'::regprocedure),
  'give_extra_attempts locks the assignment row FOR UPDATE');

set local role service_role;

-- Anna uses both free attempts and is blocked ----------------------------------------
do $d$ begin
  perform pg_temp.take('00000000-0000-0000-0000-0000000021b1', '20000000-0000-0000-0000-0000000021e1', '30000000-0000-0000-0000-000000002101', false);
  perform pg_temp.take('00000000-0000-0000-0000-0000000021b1', '20000000-0000-0000-0000-0000000021e2', '30000000-0000-0000-0000-000000002102', false);
end $d$;
select is(pg_temp.state('00000000-0000-0000-0000-0000000021b1'), 'blocked/0/false', 'two failed attempts block Anna');

-- Refusals ------------------------------------------------------------------------------
select throws_ok($$select public.give_extra_attempts('00000000-0000-0000-0000-0000000021b3', '00000000-0000-0000-0000-0000000021b1', '10000000-0000-0000-0000-0000000021c1', 1, false)$$,
  'P0001', 'not_staff', 'a student id cannot give extra attempts');
select throws_ok($$select public.give_extra_attempts(null, '00000000-0000-0000-0000-0000000021b1', '10000000-0000-0000-0000-0000000021c1', 1, false)$$,
  'P0001', 'not_staff', 'a missing staff id cannot give extra attempts');
select throws_ok($$select public.give_extra_attempts('00000000-0000-0000-0000-0000000021a1', '00000000-0000-0000-0000-0000000021b1', '10000000-0000-0000-0000-0000000021c1', 0, false)$$,
  'P0001', 'invalid_n', 'zero extra attempts are refused');
select throws_ok($$select public.give_extra_attempts('00000000-0000-0000-0000-0000000021a1', '00000000-0000-0000-0000-0000000021b1', '10000000-0000-0000-0000-0000000021c1', 11, false)$$,
  'P0001', 'invalid_n', 'more than 10 extra attempts at once are refused');
select throws_ok($$select public.give_extra_attempts('00000000-0000-0000-0000-0000000021a1', '00000000-0000-0000-0000-0000000021b1', '10000000-0000-0000-0000-0000000021c1', null, false)$$,
  'P0001', 'invalid_n', 'a missing n is refused');
select throws_ok($$select public.give_extra_attempts('00000000-0000-0000-0000-0000000021a1', '00000000-0000-0000-0000-0000000021b4', '10000000-0000-0000-0000-0000000021c1', 1, false)$$,
  'P0001', 'not_assigned', 'a student without the assignment is refused');
select throws_ok($$select public.give_extra_attempts('00000000-0000-0000-0000-0000000021a1', '00000000-0000-0000-0000-0000000021b2', '10000000-0000-0000-0000-0000000021c1', 1, false)$$,
  'P0001', 'already_passed', 'a passed curriculum gets no extra attempts');
select is(pg_temp.state('00000000-0000-0000-0000-0000000021b1') || ' ' || pg_temp.state('00000000-0000-0000-0000-0000000021b2'),
  'blocked/0/false passed/0/false', 'refusals change nothing');

-- Extra attempt after the block ------------------------------------------------------------
select lives_ok($$select public.give_extra_attempts('00000000-0000-0000-0000-0000000021a1', '00000000-0000-0000-0000-0000000021b1', '10000000-0000-0000-0000-0000000021c1', 1, false)$$,
  'staff give one extra attempt');
select is(pg_temp.state('00000000-0000-0000-0000-0000000021b1'), 'open/1/false',
  'the extra attempt is counted and unblocks; allow_repeats stays off');
select lives_ok($$select pg_temp.take('00000000-0000-0000-0000-0000000021b1', '20000000-0000-0000-0000-0000000021e3', '30000000-0000-0000-0000-000000002103', false)$$,
  'the extra attempt can be used on the unused exam set');
select is(pg_temp.state('00000000-0000-0000-0000-0000000021b1'), 'blocked/1/false',
  'failing it (3 used, allowance 2 + 1) blocks again');

-- Allow repeats -------------------------------------------------------------------------------
select lives_ok($$select public.give_extra_attempts('00000000-0000-0000-0000-0000000021a1', '00000000-0000-0000-0000-0000000021b1', '10000000-0000-0000-0000-0000000021c1', 2, true)$$,
  'staff give two more attempts and allow repeats');
select is(pg_temp.state('00000000-0000-0000-0000-0000000021b1'), 'open/3/true', 'extra attempts add up, repeats allowed, unblocked');
select lives_ok($$select public.give_extra_attempts('00000000-0000-0000-0000-0000000021a1', '00000000-0000-0000-0000-0000000021b1', '10000000-0000-0000-0000-0000000021c1', 1, false)$$,
  'giving more without allow_repeats');
select is(pg_temp.state('00000000-0000-0000-0000-0000000021b1'), 'open/4/true', 'does not switch repeats off again');
select lives_ok($$select pg_temp.take('00000000-0000-0000-0000-0000000021b1', '20000000-0000-0000-0000-0000000021e1', '30000000-0000-0000-0000-000000002101', true)$$,
  'with allow_repeats a used exam set is given again');
select is(pg_temp.state('00000000-0000-0000-0000-0000000021b1'), 'passed/4/true', 'a pass after extra attempts sets passed');
select throws_ok($$select public.give_extra_attempts('00000000-0000-0000-0000-0000000021a1', '00000000-0000-0000-0000-0000000021b1', '10000000-0000-0000-0000-0000000021c1', 1, false)$$,
  'P0001', 'already_passed', 'after the pass no extra attempts');

-- Any time: an open student with attempts left ---------------------------------------------
select lives_ok($$select public.give_extra_attempts('00000000-0000-0000-0000-0000000021a1', '00000000-0000-0000-0000-0000000021b3', '10000000-0000-0000-0000-0000000021c1', 10, false)$$,
  'staff can give extra attempts at any time, up to 10 at once');
select is(pg_temp.state('00000000-0000-0000-0000-0000000021b3'), 'open/10/false', 'an open assignment stays open with the extras');

-- remove_curriculum no longer knows about grants ------------------------------------------------
select ok((select prosrc !~* 'attempt_grants' from pg_proc where oid = 'public.remove_curriculum(uuid, uuid, uuid, boolean)'::regprocedure),
  'remove_curriculum no longer touches attempt_grants');
select is(public.remove_curriculum('00000000-0000-0000-0000-0000000021a1', '00000000-0000-0000-0000-0000000021b3', '10000000-0000-0000-0000-0000000021c1', false),
  '{"ok": true}'::jsonb, 'remove_curriculum still removes an assignment without attempts');


-- Ownership (0027) ------------------------------------------------------------------------------
select throws_ok($$select public.give_extra_attempts('00000000-0000-0000-0000-0000000021a3', '00000000-0000-0000-0000-0000000021b5', '10000000-0000-0000-0000-0000000021c1', 1, false)$$,
  'P0001', 'not_your_student', 'a trainer cannot give extra attempts to another trainer''s student');
select throws_ok($$select public.give_extra_attempts('00000000-0000-0000-0000-0000000021a1', '00000000-0000-0000-0000-0000000021a2', '10000000-0000-0000-0000-0000000021c1', 1, false)$$,
  'P0001', 'not_your_student', 'an admin cannot give extra attempts to a non-student id');
select is(pg_temp.state('00000000-0000-0000-0000-0000000021b5'), 'open/0/false', 'refused ownership calls change nothing');
select lives_ok($$select public.give_extra_attempts('00000000-0000-0000-0000-0000000021a2', '00000000-0000-0000-0000-0000000021b5', '10000000-0000-0000-0000-0000000021c1', 1, false)$$,
  'a trainer gives extra attempts to their own student');
select is(pg_temp.state('00000000-0000-0000-0000-0000000021b5'), 'open/1/false', 'the trainer''s extra attempt is counted');
reset role;
update public.profiles set active = false where id = '00000000-0000-0000-0000-0000000021a2';
set local role service_role;
select throws_ok($$select public.give_extra_attempts('00000000-0000-0000-0000-0000000021a2', '00000000-0000-0000-0000-0000000021b5', '10000000-0000-0000-0000-0000000021c1', 1, false)$$,
  'P0001', 'not_staff', 'a deactivated trainer is not staff');

reset role;
select * from finish();
rollback;
