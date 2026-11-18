-- Percent first (0019, pgTAP): 90% default pass mark and the pass mark snapshot on attempts.
-- Run: npm run db:test
begin;
select plan(19);

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000019b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'pf-anna@students.test', '{"role":"student","username":"pf.anna"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000019b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'pf-ben@students.test', '{"role":"student","username":"pf.ben"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000019b3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'pf-cara@students.test', '{"role":"student","username":"pf.cara"}', '{}', now(), now());
set constraints all immediate;
set constraints all deferred;

insert into public.curriculums (id, name) values ('10000000-0000-0000-0000-0000000019c1', 'PF curriculum');

-- exam_sets.pass_mark_percent: the standard is 90 -------------------------------------------
select col_default_is('public', 'exam_sets', 'pass_mark_percent', '90', 'pass_mark_percent defaults to 90');
select col_not_null('public', 'exam_sets', 'pass_mark_percent', 'pass_mark_percent stays not null');

-- An exam set created without a pass mark gets 90.
insert into public.exam_sets (id, curriculum_id, name, question_count, time_limit_min, max_attempts, hold_result)
values ('20000000-0000-0000-0000-0000000019e1', '10000000-0000-0000-0000-0000000019c1', 'PF held', 2, 15, 2, true);
select is((select pass_mark_percent from public.exam_sets where id = '20000000-0000-0000-0000-0000000019e1'),
  90, 'a new exam set without a pass mark passes at 90%');

insert into public.questions (id, exam_set_id, topic, difficulty, stem_de, stem_en, options, correct_option_id, status)
select ('30000000-0000-0000-0000-0000000019' || lpad(n::text, 2, '0'))::uuid,
       '20000000-0000-0000-0000-0000000019e1', 't', 'easy', 'Frage ' || n, 'Question ' || n,
       '[{"id":"a","de":"Ja","en":"Yes"},{"id":"b","de":"Nein","en":"No"}]'::jsonb, 'b', 'approved'
from generate_series(1, 2) n;

insert into public.assignments (student_id, curriculum_id, position, status) values
  ('00000000-0000-0000-0000-0000000019b1', '10000000-0000-0000-0000-0000000019c1', 1, 'open'),
  ('00000000-0000-0000-0000-0000000019b2', '10000000-0000-0000-0000-0000000019c1', 1, 'open');
insert into public.attempt_grants (student_id, exam_set_id) values
  ('00000000-0000-0000-0000-0000000019b1', '20000000-0000-0000-0000-0000000019e1'),
  ('00000000-0000-0000-0000-0000000019b2', '20000000-0000-0000-0000-0000000019e1'),
  ('00000000-0000-0000-0000-0000000019b3', '20000000-0000-0000-0000-0000000019e1');

create temp table ids (name text primary key, id uuid);
grant all on ids to public;
create function pg_temp.snap(p_attempt uuid, p_awarded int[]) returns jsonb language sql as $f$
  select jsonb_agg(jsonb_build_object(
           'attempt_question_id', aq.id, 'correct_option_id', q.correct_option_id,
           'max_points', q.points, 'awarded_points', p_awarded[aq.position], 'topic', q.topic)
         order by aq.position)
  from public.attempt_questions aq join public.questions q on q.id = aq.question_id
  where aq.attempt_id = p_attempt
$f$;
grant execute on function pg_temp.snap(uuid, int[]) to public;

-- attempts.pass_mark_percent: the snapshot ------------------------------------------------
select has_column('public', 'attempts', 'pass_mark_percent', 'attempts has pass_mark_percent');

-- Function guarantees kept by the start_attempt / record_score replacements.
select ok(not has_function_privilege('authenticated', 'public.start_attempt(uuid, uuid, jsonb)', 'execute'),
  'authenticated cannot execute start_attempt');
select ok(has_function_privilege('service_role', 'public.start_attempt(uuid, uuid, jsonb)', 'execute'),
  'service_role can execute start_attempt');
select ok(not has_function_privilege('authenticated', 'public.record_score(uuid, integer, integer, boolean, jsonb)', 'execute'),
  'authenticated cannot execute record_score');
select is((select proconfig from pg_proc where oid = 'public.start_attempt(uuid, uuid, jsonb)'::regprocedure),
  array['search_path=""'], 'start_attempt keeps an empty search_path');
select is((select prosecdef from pg_proc where oid = 'public.start_attempt(uuid, uuid, jsonb)'::regprocedure),
  false, 'start_attempt stays security invoker');
select ok((select prosrc ~* 'from public\.assignments[^;]*for update' from pg_proc where oid = 'public.start_attempt(uuid, uuid, jsonb)'::regprocedure),
  'start_attempt still locks the assignment row FOR UPDATE');

set local role service_role;

select throws_ok($$select public.start_attempt('00000000-0000-0000-0000-0000000019b3', '20000000-0000-0000-0000-0000000019e1',
  '[{"question_id":"30000000-0000-0000-0000-000000001901","option_order":["a","b"]},{"question_id":"30000000-0000-0000-0000-000000001902","option_order":["a","b"]}]')$$,
  'P0001', 'not_open', 'start_attempt still refuses a student without the assignment');

insert into ids select 'a1', public.start_attempt('00000000-0000-0000-0000-0000000019b1', '20000000-0000-0000-0000-0000000019e1',
  '[{"question_id":"30000000-0000-0000-0000-000000001901","option_order":["a","b"]},{"question_id":"30000000-0000-0000-0000-000000001902","option_order":["b","a"]}]');
select is((select pass_mark_percent from public.attempts where id = (select id from ids where name = 'a1')),
  90, 'start_attempt stores the exam set pass mark at start time');

-- Staff lower the pass mark while the exam runs: the running attempt keeps 90.
reset role;
update public.exam_sets set pass_mark_percent = 50 where id = '20000000-0000-0000-0000-0000000019e1';
set local role service_role;
select is((select pass_mark_percent from public.attempts where id = (select id from ids where name = 'a1')),
  90, 'a later pass mark change does not touch a started attempt');

insert into ids select 'b1', public.start_attempt('00000000-0000-0000-0000-0000000019b2', '20000000-0000-0000-0000-0000000019e1',
  '[{"question_id":"30000000-0000-0000-0000-000000001901","option_order":["a","b"]},{"question_id":"30000000-0000-0000-0000-000000001902","option_order":["a","b"]}]');
select is((select pass_mark_percent from public.attempts where id = (select id from ids where name = 'b1')),
  50, 'an attempt started after the change gets the new pass mark');

-- record_score: the stored outcome must agree with the snapshot (points * 100 >= mark * max).
do $d$ begin
  perform public.close_attempt((select id from ids where name = 'a1'), false);
  perform public.close_attempt((select id from ids where name = 'b1'), false);
end $d$;
select throws_ok($$select public.record_score((select id from ids where name = 'a1'), 1, 2, true, pg_temp.snap((select id from ids where name = 'a1'), array[1, 0]))$$,
  'P0001', 'invalid_outcome', '1 of 2 cannot be recorded as passed against the 90% snapshot (live mark is 50)');
select is((select public.record_score((select id from ids where name = 'a1'), 1, 2, false, pg_temp.snap((select id from ids where name = 'a1'), array[1, 0]))),
  'submitted', '1 of 2 is recorded as failed against the 90% snapshot');
select is((select passed from public.attempts where id = (select id from ids where name = 'a1')),
  false, 'the stored outcome follows the snapshot, not the live exam set');
select throws_ok($$select public.record_score((select id from ids where name = 'b1'), 1, 2, false, pg_temp.snap((select id from ids where name = 'b1'), array[1, 0]))$$,
  'P0001', 'invalid_outcome', '1 of 2 cannot be recorded as failed against a 50% snapshot');

reset role;
select throws_ok($$update public.attempts set pass_mark_percent = 101 where id = (select id from ids where name = 'b1')$$,
  '23514', null, 'a pass mark snapshot above 100 is refused');

select * from finish();
rollback;
