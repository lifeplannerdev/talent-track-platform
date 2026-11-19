-- Immediate marks and per-curriculum attempts (0020, pgTAP). Run: npm run db:test
--   * the attempt limit lives on the curriculum (max_attempts, default 2) plus the student's
--     assignment (extra_attempts); no grants, no hold, no release step;
--   * start_attempt needs no grant and refuses not_open / blocked / passed / in_progress /
--     scoring_pending / no_attempts_left / exam_set_used;
--   * record_score scores and releases in one call and decides passed / blocked per curriculum;
--   * student_assignments no longer masks the status.
begin;
select plan(53);

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000020b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'im-anna@students.test', '{"role":"student","username":"im.anna"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000020b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'im-ben@students.test', '{"role":"student","username":"im.ben"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000020b3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'im-cara@students.test', '{"role":"student","username":"im.cara"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000020b4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'im-dora@students.test', '{"role":"student","username":"im.dora"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000020b5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'im-eve@students.test', '{"role":"student","username":"im.eve"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000020b6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'im-frank@students.test', '{"role":"student","username":"im.frank"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000020b7', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'im-gina@students.test', '{"role":"student","username":"im.gina"}', '{}', now(), now());
set constraints all immediate;
set constraints all deferred;

-- C1 has three exam sets (two questions each, one per paper); C2 has one exam set with one question.
insert into public.curriculums (id, name) values
  ('10000000-0000-0000-0000-0000000020c1', 'IM main'),
  ('10000000-0000-0000-0000-0000000020c2', 'IM single');
insert into public.exam_sets (id, curriculum_id, name, question_count, time_limit_min, pass_mark_percent) values
  ('20000000-0000-0000-0000-0000000020e1', '10000000-0000-0000-0000-0000000020c1', 'IM set 1', 1, 15, 50),
  ('20000000-0000-0000-0000-0000000020e2', '10000000-0000-0000-0000-0000000020c1', 'IM set 2', 1, 15, 50),
  ('20000000-0000-0000-0000-0000000020e3', '10000000-0000-0000-0000-0000000020c1', 'IM set 3', 1, 15, 50),
  ('20000000-0000-0000-0000-0000000020e4', '10000000-0000-0000-0000-0000000020c2', 'IM single set', 1, 15, 50);
insert into public.questions (id, exam_set_id, topic, difficulty, stem_de, stem_en, options, correct_option_id, status)
select ('30000000-0000-0000-0000-0000000020' || lpad(n::text, 2, '0'))::uuid,
       case when n <= 2 then '20000000-0000-0000-0000-0000000020e1'
            when n <= 4 then '20000000-0000-0000-0000-0000000020e2'
            when n <= 6 then '20000000-0000-0000-0000-0000000020e3'
            else '20000000-0000-0000-0000-0000000020e4' end::uuid,
       't', 'easy', 'Frage ' || n, 'Question ' || n,
       '[{"id":"a","de":"Ja","en":"Yes"},{"id":"b","de":"Nein","en":"No"}]'::jsonb, 'b', 'approved'
from generate_series(1, 7) n;

-- Anna: C1 and C2 open. Ben: C1 open with two failed attempts already used (legacy state).
-- Cara: C1 passed. Dora: C1 blocked with a submitted attempt. Eve: nothing assigned.
-- Frank: C2 open. Gina: C1 open with a submitted, not yet scored attempt.
insert into public.assignments (student_id, curriculum_id, position, status) values
  ('00000000-0000-0000-0000-0000000020b1', '10000000-0000-0000-0000-0000000020c1', 1, 'open'),
  ('00000000-0000-0000-0000-0000000020b1', '10000000-0000-0000-0000-0000000020c2', 2, 'open'),
  ('00000000-0000-0000-0000-0000000020b2', '10000000-0000-0000-0000-0000000020c1', 1, 'open'),
  ('00000000-0000-0000-0000-0000000020b3', '10000000-0000-0000-0000-0000000020c1', 1, 'passed'),
  ('00000000-0000-0000-0000-0000000020b4', '10000000-0000-0000-0000-0000000020c1', 1, 'blocked'),
  ('00000000-0000-0000-0000-0000000020b6', '10000000-0000-0000-0000-0000000020c2', 1, 'open'),
  ('00000000-0000-0000-0000-0000000020b7', '10000000-0000-0000-0000-0000000020c1', 1, 'open');
insert into public.attempts (student_id, exam_set_id, status, deadline_at, submitted_at, points, max_points, passed, released_at) values
  ('00000000-0000-0000-0000-0000000020b2', '20000000-0000-0000-0000-0000000020e1', 'released', now() - interval '2 days', now() - interval '2 days', 0, 1, false, now() - interval '2 days'),
  ('00000000-0000-0000-0000-0000000020b2', '20000000-0000-0000-0000-0000000020e2', 'released', now() - interval '1 day', now() - interval '1 day', 0, 1, false, now() - interval '1 day'),
  ('00000000-0000-0000-0000-0000000020b4', '20000000-0000-0000-0000-0000000020e1', 'submitted', now() - interval '1 hour', now() - interval '1 hour', null, null, null, null),
  ('00000000-0000-0000-0000-0000000020b7', '20000000-0000-0000-0000-0000000020e1', 'submitted', now() - interval '1 hour', now() - interval '1 hour', null, null, null, null);

create temp table ids (name text primary key, id uuid);
grant all on ids to public;

create function pg_temp.draw(p_q uuid) returns jsonb language sql as $f$
  select jsonb_build_array(jsonb_build_object('question_id', p_q, 'option_order', array['a', 'b']))
$f$;
create function pg_temp.snap(p_attempt uuid, p_awarded int[]) returns jsonb language sql as $f$
  select jsonb_agg(jsonb_build_object(
           'attempt_question_id', aq.id, 'correct_option_id', q.correct_option_id,
           'max_points', q.points, 'awarded_points', p_awarded[aq.position], 'topic', q.topic)
         order by aq.position)
  from public.attempt_questions aq join public.questions q on q.id = aq.question_id
  where aq.attempt_id = p_attempt
$f$;
-- Starts a one-question attempt, submits it and scores it (1/1 pass or 0/1 fail).
create function pg_temp.take(p_student uuid, p_set uuid, p_q uuid, p_pass boolean) returns uuid language plpgsql as $f$
declare v uuid;
begin
  v := public.start_attempt(p_student, p_set, pg_temp.draw(p_q));
  perform public.close_attempt(v, false);
  perform public.record_score(v, case when p_pass then 1 else 0 end, 1, p_pass,
    pg_temp.snap(v, case when p_pass then array[1] else array[0] end));
  return v;
end $f$;
create function pg_temp.status(p_student uuid, p_curriculum uuid) returns text language sql as $f$
  select status from public.assignments where student_id = p_student and curriculum_id = p_curriculum
$f$;
grant execute on all functions in schema pg_temp to public;

-- Schema ---------------------------------------------------------------------------
select col_default_is('public', 'curriculums', 'max_attempts', '2', 'curriculums.max_attempts defaults to 2');
select col_not_null('public', 'curriculums', 'max_attempts', 'curriculums.max_attempts is not null');
select throws_ok($$update public.curriculums set max_attempts = 21 where id = '10000000-0000-0000-0000-0000000020c1'$$,
  '23514', null, 'more than 20 attempts per curriculum is refused');
select throws_ok($$update public.curriculums set max_attempts = 0 where id = '10000000-0000-0000-0000-0000000020c1'$$,
  '23514', null, 'zero attempts per curriculum is refused');
select hasnt_column('public', 'exam_sets', 'hold_result', 'exam sets no longer hold results');
select hasnt_column('public', 'exam_sets', 'max_attempts', 'the attempt limit is no longer on the exam set');
select col_default_is('public', 'assignments', 'extra_attempts', '0', 'assignments.extra_attempts defaults to 0');
select col_not_null('public', 'assignments', 'extra_attempts', 'assignments.extra_attempts is not null');
select throws_ok($$update public.assignments set extra_attempts = -1 where student_id = '00000000-0000-0000-0000-0000000020b1'$$,
  '23514', null, 'negative extra attempts are refused');
select col_default_is('public', 'assignments', 'allow_repeats', 'false', 'assignments.allow_repeats defaults to false');
select col_not_null('public', 'assignments', 'allow_repeats', 'assignments.allow_repeats is not null');
select hasnt_table('public', 'attempt_grants', 'the attempt_grants table is gone');
select hasnt_function('public', 'release_attempt', array['uuid', 'uuid'], 'release_attempt is gone (record_score releases)');
select hasnt_function('public', 'grant_attempt', array['uuid', 'uuid', 'uuid'], 'grant_attempt is gone (replaced by give_extra_attempts)');

-- Function privileges and hardening ------------------------------------------------
select ok(not has_function_privilege('public', 'public.start_attempt(uuid, uuid, jsonb)', 'execute'), 'PUBLIC cannot execute start_attempt');
select ok(not has_function_privilege('public', 'public.record_score(uuid, integer, integer, boolean, jsonb)', 'execute'), 'PUBLIC cannot execute record_score');
select ok(not has_function_privilege('anon', 'public.start_attempt(uuid, uuid, jsonb)', 'execute'), 'anon cannot execute start_attempt');
select ok(not has_function_privilege('anon', 'public.record_score(uuid, integer, integer, boolean, jsonb)', 'execute'), 'anon cannot execute record_score');
select ok(not has_function_privilege('authenticated', 'public.start_attempt(uuid, uuid, jsonb)', 'execute'), 'authenticated cannot execute start_attempt');
select ok(not has_function_privilege('authenticated', 'public.record_score(uuid, integer, integer, boolean, jsonb)', 'execute'), 'authenticated cannot execute record_score');
select ok(has_function_privilege('service_role', 'public.start_attempt(uuid, uuid, jsonb)', 'execute'), 'service_role can execute start_attempt');
select ok(has_function_privilege('service_role', 'public.record_score(uuid, integer, integer, boolean, jsonb)', 'execute'), 'service_role can execute record_score');
select is((select proconfig from pg_proc where oid = 'public.record_score(uuid, integer, integer, boolean, jsonb)'::regprocedure),
  array['search_path=""'], 'record_score keeps an empty search_path');
select is((select prosecdef from pg_proc where oid = 'public.record_score(uuid, integer, integer, boolean, jsonb)'::regprocedure),
  false, 'record_score stays security invoker');
select ok((select prosrc ~* 'from public\.assignments[^;]*for update' from pg_proc where oid = 'public.record_score(uuid, integer, integer, boolean, jsonb)'::regprocedure),
  'record_score locks the assignment row FOR UPDATE (after the attempt row) before deciding passed / blocked');

set local role service_role;

-- Anna: two free attempts on two different exam sets, then blocked -------------------
insert into ids select 'a1', pg_temp.take('00000000-0000-0000-0000-0000000020b1', '20000000-0000-0000-0000-0000000020e1',
  '30000000-0000-0000-0000-000000002001', false);
select is((select status || '/' || points from public.attempts where id = (select id from ids where name = 'a1')),
  'released/0', 'without any grant the first attempt starts, and a failed score is released at once with its points');
select ok((select released_at is not null and released_by is null from public.attempts where id = (select id from ids where name = 'a1')),
  'the immediate release sets released_at and records no staff member');
select is(pg_temp.status('00000000-0000-0000-0000-0000000020b1', '10000000-0000-0000-0000-0000000020c1'), 'open',
  'a failed first attempt (1 of 2 used) leaves the assignment open');
select throws_ok($$select public.start_attempt('00000000-0000-0000-0000-0000000020b1', '20000000-0000-0000-0000-0000000020e1',
  pg_temp.draw('30000000-0000-0000-0000-000000002002'))$$,
  'P0001', 'exam_set_used', 'the same exam set is never given twice in a curriculum');

insert into ids select 'a2', public.start_attempt('00000000-0000-0000-0000-0000000020b1', '20000000-0000-0000-0000-0000000020e2',
  pg_temp.draw('30000000-0000-0000-0000-000000002003'));
select is((select status from public.attempts where id = (select id from ids where name = 'a2')), 'in_progress',
  'the second attempt starts on a different exam set without any grant');
select throws_ok($$select public.start_attempt('00000000-0000-0000-0000-0000000020b1', '20000000-0000-0000-0000-0000000020e3',
  pg_temp.draw('30000000-0000-0000-0000-000000002005'))$$,
  'P0001', 'in_progress', 'no start on another exam set while an attempt in the curriculum is in progress');
select throws_ok($$select public.start_attempt('00000000-0000-0000-0000-0000000020b1', '20000000-0000-0000-0000-0000000020e2',
  pg_temp.draw('30000000-0000-0000-0000-000000002004'))$$,
  'P0001', 'in_progress', 'no second start on the exam set in progress');
select is((select count(*)::int from public.attempts where student_id = '00000000-0000-0000-0000-0000000020b1'), 2,
  'the refused starts create no attempt');

do $d$ begin perform public.close_attempt((select id from ids where name = 'a2'), false); end $d$;
select is(public.record_score((select id from ids where name = 'a2'), 0, 1, false, pg_temp.snap((select id from ids where name = 'a2'), array[0])),
  'released', 'record_score releases the second attempt in the same call');
select is((select status || '/' || points || '/' || passed from public.attempts where id = (select id from ids where name = 'a2')),
  'released/0/false', 'the failed second attempt is released with its points');
select is(pg_temp.status('00000000-0000-0000-0000-0000000020b1', '10000000-0000-0000-0000-0000000020c1'), 'blocked',
  'failing the last allowed attempt (2 of 2 used) blocks the assignment in the same transaction');
select throws_ok($$select public.start_attempt('00000000-0000-0000-0000-0000000020b1', '20000000-0000-0000-0000-0000000020e3',
  pg_temp.draw('30000000-0000-0000-0000-000000002005'))$$,
  'P0001', 'blocked', 'a blocked student cannot start');
select lives_ok($$insert into ids select 'a3', public.start_attempt('00000000-0000-0000-0000-0000000020b1', '20000000-0000-0000-0000-0000000020e4',
  pg_temp.draw('30000000-0000-0000-0000-000000002007'))$$,
  'curriculums are independent: the block in one does not stop a start in another');

-- Refusals ------------------------------------------------------------------------
select throws_ok($$select public.start_attempt('00000000-0000-0000-0000-0000000020b2', '20000000-0000-0000-0000-0000000020e3',
  pg_temp.draw('30000000-0000-0000-0000-000000002005'))$$,
  'P0001', 'no_attempts_left', 'attempts used on any exam set of the curriculum count against max_attempts + extra_attempts');
select throws_ok($$select public.start_attempt('00000000-0000-0000-0000-0000000020b3', '20000000-0000-0000-0000-0000000020e1',
  pg_temp.draw('30000000-0000-0000-0000-000000002001'))$$,
  'P0001', 'passed', 'a student who passed the curriculum cannot start');
select throws_ok($$select public.start_attempt('00000000-0000-0000-0000-0000000020b4', '20000000-0000-0000-0000-0000000020e2',
  pg_temp.draw('30000000-0000-0000-0000-000000002003'))$$,
  'P0001', 'blocked', 'a blocked student cannot start, whatever else is pending');
select throws_ok($$select public.start_attempt('00000000-0000-0000-0000-0000000020b5', '20000000-0000-0000-0000-0000000020e1',
  pg_temp.draw('30000000-0000-0000-0000-000000002001'))$$,
  'P0001', 'not_open', 'a student without the assignment cannot start');
select throws_ok($$select public.start_attempt('00000000-0000-0000-0000-0000000020b7', '20000000-0000-0000-0000-0000000020e2',
  pg_temp.draw('30000000-0000-0000-0000-000000002003'))$$,
  'P0001', 'scoring_pending', 'no start while a submitted attempt of the curriculum is not scored yet');
select is((select count(*)::int from public.attempts where student_id in (
    '00000000-0000-0000-0000-0000000020b2', '00000000-0000-0000-0000-0000000020b3', '00000000-0000-0000-0000-0000000020b4',
    '00000000-0000-0000-0000-0000000020b5', '00000000-0000-0000-0000-0000000020b7')), 4,
  'the refusals create no attempt');

-- Frank: a curriculum with a single exam set; allow_repeats reuses it -----------------
insert into ids select 'f1', pg_temp.take('00000000-0000-0000-0000-0000000020b6', '20000000-0000-0000-0000-0000000020e4',
  '30000000-0000-0000-0000-000000002007', false);
select throws_ok($$select public.start_attempt('00000000-0000-0000-0000-0000000020b6', '20000000-0000-0000-0000-0000000020e4',
  pg_temp.draw('30000000-0000-0000-0000-000000002007'))$$,
  'P0001', 'exam_set_used', 'with every exam set used and no allow_repeats the start is refused');
reset role;
update public.assignments set allow_repeats = true
where student_id = '00000000-0000-0000-0000-0000000020b6' and curriculum_id = '10000000-0000-0000-0000-0000000020c2';
set local role service_role;
select lives_ok($$insert into ids select 'f2', pg_temp.take('00000000-0000-0000-0000-0000000020b6', '20000000-0000-0000-0000-0000000020e4',
  '30000000-0000-0000-0000-000000002007', true)$$,
  'with allow_repeats the exam set (and, when the pool is short, a seen question) may be given again');
select is((select status || '/' || passed from public.attempts where id = (select id from ids where name = 'f2')), 'released/true',
  'the passing attempt is released at once');
select is(pg_temp.status('00000000-0000-0000-0000-0000000020b6', '10000000-0000-0000-0000-0000000020c2'), 'passed',
  'a pass sets the assignment passed in the same transaction');
select throws_ok($$select public.start_attempt('00000000-0000-0000-0000-0000000020b6', '20000000-0000-0000-0000-0000000020e4',
  pg_temp.draw('30000000-0000-0000-0000-000000002007'))$$,
  'P0001', 'passed', 'after the pass no further start');

-- Student views ----------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000020b4","role":"authenticated"}', true);
set local role authenticated;
select is((select status from public.student_assignments where curriculum_id = '10000000-0000-0000-0000-0000000020c1'), 'blocked',
  'student_assignments shows the real status, no masking while an attempt is submitted');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000020b1","role":"authenticated"}', true);
set local role authenticated;
select is((select points || '/' || max_points || '/' || passed from public.student_attempts where id = (select id from ids where name = 'a1')),
  '0/1/false', 'student_attempts shows the points of a released attempt');
select is((select coalesce(points::text, 'null') || '/' || coalesce(passed::text, 'null') from public.student_attempts where id = (select id from ids where name = 'a3')),
  'null/null', 'student_attempts shows nothing for an attempt in progress');
select is((select status from public.student_assignments where curriculum_id = '10000000-0000-0000-0000-0000000020c1'), 'blocked',
  'the student sees the block at once');

reset role;
select * from finish();
rollback;
