-- Blocking in release_attempt and staff grants via grant_attempt (0008, pgTAP). Run: npm run db:test
begin;
select plan(55);

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000007b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bg-anna@students.test', '{"role":"student","username":"bg.anna"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000007b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bg-ben@students.test', '{"role":"student","username":"bg.ben"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000007b3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bg-cara@students.test', '{"role":"student","username":"bg.cara"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000007b4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bg-dev@students.test', '{"role":"student","username":"bg.dev"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000007b5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bg-eve@students.test', '{"role":"student","username":"bg.eve"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bg-staff@staff.test', '{"role":"staff","username":"bg.staff"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000007a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bg-staff2@staff.test', '{"role":"staff","username":"bg.staff2"}', '{}', now(), now());
set constraints all immediate;
set constraints all deferred;

insert into public.curriculums (id, name) values
  ('10000000-0000-0000-0000-0000000007c1', 'BG held'),
  ('10000000-0000-0000-0000-0000000007c2', 'BG open'),
  ('10000000-0000-0000-0000-0000000007c3', 'BG mix'),
  ('10000000-0000-0000-0000-0000000007c5', 'BG multi');
insert into public.exam_sets (id, curriculum_id, name, question_count, time_limit_min, pass_mark_percent, max_attempts, hold_result, topic_mix) values
  ('20000000-0000-0000-0000-0000000007e1', '10000000-0000-0000-0000-0000000007c1', 'Held', 2, 15, 50, 2, true, '{}'),
  ('20000000-0000-0000-0000-0000000007e2', '10000000-0000-0000-0000-0000000007c2', 'Open', 2, 15, 50, 1, false, '{}'),
  ('20000000-0000-0000-0000-0000000007e3', '10000000-0000-0000-0000-0000000007c3', 'Mix', 2, 15, 50, 1, true, '{"x": 1, "y": 1}'),
  ('20000000-0000-0000-0000-0000000007e5', '10000000-0000-0000-0000-0000000007c5', 'Multi A', 2, 15, 50, 1, true, '{}'),
  ('20000000-0000-0000-0000-0000000007e6', '10000000-0000-0000-0000-0000000007c5', 'Multi B', 2, 15, 50, 1, true, '{}');
-- Held: q01-q05 approved, q06 draft. Open: q07-q10. Mix: q11-q13 all topic x (no y at all).
-- Multi A: q14-q15. Multi B: q16-q17.
insert into public.questions (id, exam_set_id, topic, difficulty, stem_de, stem_en, options, correct_option_id, status)
select ('30000000-0000-0000-0000-0000000007' || lpad(n::text, 2, '0'))::uuid,
       case when n <= 6 then '20000000-0000-0000-0000-0000000007e1'
            when n <= 10 then '20000000-0000-0000-0000-0000000007e2'
            when n <= 13 then '20000000-0000-0000-0000-0000000007e3'
            when n <= 15 then '20000000-0000-0000-0000-0000000007e5'
            else '20000000-0000-0000-0000-0000000007e6' end::uuid,
       case when n between 11 and 13 then 'x' else 't' end, 'easy', 'Frage ' || n, 'Question ' || n,
       '[{"id":"a","de":"Ja","en":"Yes"},{"id":"b","de":"Nein","en":"No"}]'::jsonb, 'b',
       case when n = 6 then 'draft' else 'approved' end
from generate_series(1, 17) n;

insert into public.assignments (student_id, curriculum_id, position, status) values
  ('00000000-0000-0000-0000-0000000007b1', '10000000-0000-0000-0000-0000000007c1', 1, 'open'),
  ('00000000-0000-0000-0000-0000000007b2', '10000000-0000-0000-0000-0000000007c1', 1, 'open'),
  ('00000000-0000-0000-0000-0000000007b3', '10000000-0000-0000-0000-0000000007c2', 1, 'open'),
  ('00000000-0000-0000-0000-0000000007b4', '10000000-0000-0000-0000-0000000007c3', 1, 'open'),
  ('00000000-0000-0000-0000-0000000007b5', '10000000-0000-0000-0000-0000000007c5', 1, 'open');

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
-- Starts an attempt on two given questions, submits it and scores it (2/2 pass or 0/2 fail).
create function pg_temp.take(p_student uuid, p_set uuid, p_qa uuid, p_qb uuid, p_pass boolean) returns uuid language plpgsql as $f$
declare v uuid;
begin
  v := public.start_attempt(p_student, p_set, jsonb_build_array(
    jsonb_build_object('question_id', p_qa, 'option_order', array['a', 'b']),
    jsonb_build_object('question_id', p_qb, 'option_order', array['b', 'a'])));
  perform public.close_attempt(v, false);
  perform public.record_score(v, case when p_pass then 2 else 0 end, 2, p_pass,
    pg_temp.snap(v, case when p_pass then array[1, 1] else array[0, 0] end));
  return v;
end $f$;
create function pg_temp.status(p_student uuid, p_curriculum uuid) returns text language sql as $f$
  select status from public.assignments where student_id = p_student and curriculum_id = p_curriculum
$f$;
create function pg_temp.grants(p_student uuid) returns int language sql as $f$
  select count(*)::int from public.attempt_grants where student_id = p_student
$f$;
grant execute on all functions in schema pg_temp to public;

-- Privileges -----------------------------------------------------------------
select has_function('public', 'grant_attempt', array['uuid', 'uuid', 'uuid'], 'grant_attempt exists');
select has_function('public', 'release_attempt', array['uuid', 'uuid'], 'release_attempt keeps its two-argument signature');
set local role authenticated;
select throws_ok($$select public.grant_attempt('00000000-0000-0000-0000-0000000007b1', '20000000-0000-0000-0000-0000000007e1', '00000000-0000-0000-0000-0000000007a1')$$,
  '42501', null, 'authenticated users cannot call grant_attempt, not even naming a staff id');
reset role;
set local role anon;
select throws_ok($$select public.grant_attempt('00000000-0000-0000-0000-0000000007b1', '20000000-0000-0000-0000-0000000007e1', '00000000-0000-0000-0000-0000000007a1')$$,
  '42501', null, 'anon cannot call grant_attempt');
reset role;
set local role service_role;

-- grant_attempt refusals ---------------------------------------------------------
select throws_ok($$select public.grant_attempt('00000000-0000-0000-0000-0000000007b1', '20000000-0000-0000-0000-0000000007e1', '00000000-0000-0000-0000-0000000007b2')$$,
  'P0001', 'not_staff', 'a student id cannot grant');
select throws_ok($$select public.grant_attempt('00000000-0000-0000-0000-0000000007b5', '20000000-0000-0000-0000-0000000007e1', '00000000-0000-0000-0000-0000000007a1')$$,
  'P0001', 'not_assigned', 'a student without an assignment to the curriculum cannot be granted the exam set');
select throws_ok($$select public.grant_attempt('00000000-0000-0000-0000-0000000007b1', gen_random_uuid(), '00000000-0000-0000-0000-0000000007a1')$$,
  'P0001', 'exam_set_not_found', 'an unknown exam set is refused');
select is(pg_temp.grants('00000000-0000-0000-0000-0000000007b1') + pg_temp.grants('00000000-0000-0000-0000-0000000007b5'), 0,
  'refusals write no grant');

-- First attempt, failed with an attempt left: stays open ---------------------------
select is(public.grant_attempt('00000000-0000-0000-0000-0000000007b1', '20000000-0000-0000-0000-0000000007e1', '00000000-0000-0000-0000-0000000007a1'),
  '{"ok": true}'::jsonb, 'staff give a first attempt');
select is((select granted_by from public.attempt_grants where student_id = '00000000-0000-0000-0000-0000000007b1'),
  '00000000-0000-0000-0000-0000000007a1'::uuid, 'the grant records the staff member');
select throws_ok($$select public.grant_attempt('00000000-0000-0000-0000-0000000007b1', '20000000-0000-0000-0000-0000000007e1', '00000000-0000-0000-0000-0000000007a2')$$,
  'P0001', 'grant_exists', 'grants do not stack');
select is(pg_temp.grants('00000000-0000-0000-0000-0000000007b1'), 1, 'still exactly one grant');

insert into ids select 'a1', public.start_attempt('00000000-0000-0000-0000-0000000007b1', '20000000-0000-0000-0000-0000000007e1',
  '[{"question_id":"30000000-0000-0000-0000-000000000701","option_order":["a","b"]},{"question_id":"30000000-0000-0000-0000-000000000702","option_order":["a","b"]}]');
select throws_ok($$select public.grant_attempt('00000000-0000-0000-0000-0000000007b1', '20000000-0000-0000-0000-0000000007e1', '00000000-0000-0000-0000-0000000007a1')$$,
  'P0001', 'in_progress', 'no grant while an attempt is in progress');
do $d$ begin
  perform public.close_attempt((select id from ids where name = 'a1'), false);
  perform public.record_score((select id from ids where name = 'a1'), 0, 2, false, pg_temp.snap((select id from ids where name = 'a1'), array[0, 0]));
end $d$;
select is(public.release_attempt((select id from ids where name = 'a1'), '00000000-0000-0000-0000-0000000007a1'), true, 'first failed attempt released');
select is(pg_temp.status('00000000-0000-0000-0000-0000000007b1', '10000000-0000-0000-0000-0000000007c1'), 'open',
  'failing with an attempt left (1 of 2 used) leaves the assignment open');

-- Second attempt, failed: the last allowed one blocks, but only at release ---------
select is(public.grant_attempt('00000000-0000-0000-0000-0000000007b1', '20000000-0000-0000-0000-0000000007e1', '00000000-0000-0000-0000-0000000007a1'),
  '{"ok": true}'::jsonb, 'staff grant the second attempt');
select throws_ok($$select pg_temp.take('00000000-0000-0000-0000-0000000007b1', '20000000-0000-0000-0000-0000000007e1',
    '30000000-0000-0000-0000-000000000701', '30000000-0000-0000-0000-000000000703', false)$$,
  'P0001', 'question_already_seen', 'the granted attempt cannot reuse a seen question');
insert into ids select 'a2', pg_temp.take('00000000-0000-0000-0000-0000000007b1', '20000000-0000-0000-0000-0000000007e1',
  '30000000-0000-0000-0000-000000000703', '30000000-0000-0000-0000-000000000704', false);
select is(pg_temp.status('00000000-0000-0000-0000-0000000007b1', '10000000-0000-0000-0000-0000000007c1'), 'open',
  'a held failed last attempt does not block before release');
select throws_ok($$select public.grant_attempt('00000000-0000-0000-0000-0000000007b1', '20000000-0000-0000-0000-0000000007e1', '00000000-0000-0000-0000-0000000007a1')$$,
  'P0001', 'result_pending', 'no grant while a result in the curriculum is held');
select is((select count(*)::int from public.attempt_grants where student_id = '00000000-0000-0000-0000-0000000007b1' and used_attempt_id is null), 0,
  'the refused grant writes nothing');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007b1","role":"authenticated"}', true);
set local role authenticated;
select is((select status from public.student_assignments where curriculum_id = '10000000-0000-0000-0000-0000000007c1'), 'open',
  'the student sees open while the attempt is held');
reset role;
set local role service_role;
select is(public.release_attempt((select id from ids where name = 'a2'), '00000000-0000-0000-0000-0000000007a1'), true, 'last failed attempt released');
select is(pg_temp.status('00000000-0000-0000-0000-0000000007b1', '10000000-0000-0000-0000-0000000007c1'), 'blocked',
  'failing the last allowed attempt (2 of 2 used) blocks the assignment');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007b1","role":"authenticated"}', true);
set local role authenticated;
select is((select status from public.student_assignments where curriculum_id = '10000000-0000-0000-0000-0000000007c1'), 'blocked',
  'after release the student sees blocked');
reset role;
set local role service_role;
select is(public.release_attempt((select id from ids where name = 'a2'), '00000000-0000-0000-0000-0000000007a2'), false, 'a second release is a no-op');
select is((select released_by from public.attempts where id = (select id from ids where name = 'a2')), '00000000-0000-0000-0000-0000000007a1'::uuid,
  'and keeps the first releaser');
select is(pg_temp.status('00000000-0000-0000-0000-0000000007b1', '10000000-0000-0000-0000-0000000007c1'), 'blocked',
  'and leaves the block as it is');

-- Shortfall: 4 of 5 approved questions seen (the draft does not count), 2 needed ---
select is(public.grant_attempt('00000000-0000-0000-0000-0000000007b1', '20000000-0000-0000-0000-0000000007e1', '00000000-0000-0000-0000-0000000007a1'),
  '{"ok": false, "needed": 2, "unseen_available": 1}'::jsonb, 'too few unseen questions returns the shortfall');
select is(pg_temp.grants('00000000-0000-0000-0000-0000000007b1'), 2, 'the shortfall writes no grant');
select is(pg_temp.status('00000000-0000-0000-0000-0000000007b1', '10000000-0000-0000-0000-0000000007c1'), 'blocked',
  'and does not unblock');

-- Override after a block: grant and unblock together -------------------------------
reset role;
update public.questions set status = 'approved' where id = '30000000-0000-0000-0000-000000000706';
set local role service_role;
select is(public.grant_attempt('00000000-0000-0000-0000-0000000007b1', '20000000-0000-0000-0000-0000000007e1', '00000000-0000-0000-0000-0000000007a2'),
  '{"ok": true}'::jsonb, 'with enough unseen questions staff grant another attempt after the block');
select is(pg_temp.status('00000000-0000-0000-0000-0000000007b1', '10000000-0000-0000-0000-0000000007c1'), 'open',
  'the grant unblocks the assignment');
select is((select count(*)::int from public.attempt_grants where student_id = '00000000-0000-0000-0000-0000000007b1' and used_attempt_id is null), 1,
  'one unused grant');
insert into ids select 'a3', pg_temp.take('00000000-0000-0000-0000-0000000007b1', '20000000-0000-0000-0000-0000000007e1',
  '30000000-0000-0000-0000-000000000705', '30000000-0000-0000-0000-000000000706', false);
select is(public.release_attempt((select id from ids where name = 'a3'), '00000000-0000-0000-0000-0000000007a1'), true, 'override attempt released');
select is(pg_temp.status('00000000-0000-0000-0000-0000000007b1', '10000000-0000-0000-0000-0000000007c1'), 'blocked',
  'failing the override attempt (3 used, max 2) blocks again');

-- Pass ---------------------------------------------------------------------------
select is(public.grant_attempt('00000000-0000-0000-0000-0000000007b2', '20000000-0000-0000-0000-0000000007e1', '00000000-0000-0000-0000-0000000007a1'),
  '{"ok": true}'::jsonb, 'Ben gets a first attempt');
insert into ids select 'b1', pg_temp.take('00000000-0000-0000-0000-0000000007b2', '20000000-0000-0000-0000-0000000007e1',
  '30000000-0000-0000-0000-000000000701', '30000000-0000-0000-0000-000000000702', true);
select is(public.release_attempt((select id from ids where name = 'b1'), '00000000-0000-0000-0000-0000000007a1'), true, 'passed attempt released');
select is(pg_temp.status('00000000-0000-0000-0000-0000000007b2', '10000000-0000-0000-0000-0000000007c1'), 'passed',
  'a pass marks the assignment passed');
select throws_ok($$select public.grant_attempt('00000000-0000-0000-0000-0000000007b2', '20000000-0000-0000-0000-0000000007e1', '00000000-0000-0000-0000-0000000007a1')$$,
  'P0001', 'assignment_passed', 'no attempts for a passed curriculum');

-- Non-held set: the automatic release in record_score blocks on the last attempt ---
select is(public.grant_attempt('00000000-0000-0000-0000-0000000007b3', '20000000-0000-0000-0000-0000000007e2', '00000000-0000-0000-0000-0000000007a1'),
  '{"ok": true}'::jsonb, 'Cara gets her only attempt');
insert into ids select 'c1', pg_temp.take('00000000-0000-0000-0000-0000000007b3', '20000000-0000-0000-0000-0000000007e2',
  '30000000-0000-0000-0000-000000000707', '30000000-0000-0000-0000-000000000708', false);
select is((select status from public.attempts where id = (select id from ids where name = 'c1')), 'released', 'non-held: released at once');
select is(pg_temp.status('00000000-0000-0000-0000-0000000007b3', '10000000-0000-0000-0000-0000000007c2'), 'blocked',
  'non-held: failing the only allowed attempt blocks in the same call');

-- Recovery: a blocked assignment with an unused grant (legacy or racing state) ----------
insert into public.attempt_grants (student_id, exam_set_id) values ('00000000-0000-0000-0000-0000000007b3', '20000000-0000-0000-0000-0000000007e2');
select is(public.grant_attempt('00000000-0000-0000-0000-0000000007b3', '20000000-0000-0000-0000-0000000007e2', '00000000-0000-0000-0000-0000000007a1'),
  '{"ok": true}'::jsonb, 'granting to a blocked student who already holds an unused grant succeeds');
select is(pg_temp.status('00000000-0000-0000-0000-0000000007b3', '10000000-0000-0000-0000-0000000007c2'), 'open',
  'and lifts the block');
select is((select count(*)::int from public.attempt_grants where student_id = '00000000-0000-0000-0000-0000000007b3' and used_attempt_id is null), 1,
  'without stacking a second grant');

-- Multi-set curriculum: an attempt in progress or held on one set blocks grants on every set --
select is(public.grant_attempt('00000000-0000-0000-0000-0000000007b5', '20000000-0000-0000-0000-0000000007e5', '00000000-0000-0000-0000-0000000007a1'),
  '{"ok": true}'::jsonb, 'Eve gets an attempt on Multi A');
insert into ids select 'e1', public.start_attempt('00000000-0000-0000-0000-0000000007b5', '20000000-0000-0000-0000-0000000007e5',
  '[{"question_id":"30000000-0000-0000-0000-000000000714","option_order":["a","b"]},{"question_id":"30000000-0000-0000-0000-000000000715","option_order":["a","b"]}]');
select throws_ok($$select public.grant_attempt('00000000-0000-0000-0000-0000000007b5', '20000000-0000-0000-0000-0000000007e6', '00000000-0000-0000-0000-0000000007a1')$$,
  'P0001', 'in_progress', 'no grant on Multi B while Multi A is in progress');
do $d$ begin
  perform public.close_attempt((select id from ids where name = 'e1'), false);
  perform public.record_score((select id from ids where name = 'e1'), 0, 2, false, pg_temp.snap((select id from ids where name = 'e1'), array[0, 0]));
end $d$;
select throws_ok($$select public.grant_attempt('00000000-0000-0000-0000-0000000007b5', '20000000-0000-0000-0000-0000000007e6', '00000000-0000-0000-0000-0000000007a1')$$,
  'P0001', 'result_pending', 'no grant on Multi B while the Multi A result is held');
select is(pg_temp.grants('00000000-0000-0000-0000-0000000007b5'), 1, 'only the used Multi A grant exists');
select is(public.release_attempt((select id from ids where name = 'e1'), '00000000-0000-0000-0000-0000000007a1'), true, 'Multi A released as a fail');
select is(pg_temp.status('00000000-0000-0000-0000-0000000007b5', '10000000-0000-0000-0000-0000000007c5'), 'blocked',
  'the curriculum is blocked with no unused grant left behind');
select is(public.grant_attempt('00000000-0000-0000-0000-0000000007b5', '20000000-0000-0000-0000-0000000007e6', '00000000-0000-0000-0000-0000000007a1'),
  '{"ok": true}'::jsonb, 'after release staff can grant Multi B');
select is(pg_temp.status('00000000-0000-0000-0000-0000000007b5', '10000000-0000-0000-0000-0000000007c5'), 'open',
  'which lifts the block');

-- Topic mix: unseen questions must cover every topic of the mix ----------------------
select is(public.grant_attempt('00000000-0000-0000-0000-0000000007b4', '20000000-0000-0000-0000-0000000007e3', '00000000-0000-0000-0000-0000000007a1'),
  '{"ok": false, "needed": 2, "unseen_available": 1}'::jsonb, 'a topic mix the unseen pool cannot fill returns the usable count');
select is(pg_temp.grants('00000000-0000-0000-0000-0000000007b4'), 0, 'and writes no grant');

select * from finish();
rollback;
