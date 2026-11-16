-- Attempt lifecycle functions from 0004 (pgTAP). Run: npm run db:test
begin;
select plan(57);

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000005b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'fn-anna@students.test', '{"role":"student","username":"fn.anna"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000005b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'fn-ben@students.test', '{"role":"student","username":"fn.ben"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'fn-staff@staff.test', '{"role":"staff","username":"fn.staff"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'fn-staff2@staff.test', '{"role":"staff","username":"fn.staff2"}', '{}', now(), now());
set constraints all immediate;
set constraints all deferred;

insert into public.curriculums (id, name) values ('10000000-0000-0000-0000-0000000005c1', 'Fn curriculum');
insert into public.exam_sets (id, curriculum_id, name, question_count, time_limit_min, pass_mark_percent, hold_result) values
  ('20000000-0000-0000-0000-0000000005e1', '10000000-0000-0000-0000-0000000005c1', 'Held', 2, 15, 50, true),
  ('20000000-0000-0000-0000-0000000005e2', '10000000-0000-0000-0000-0000000005c1', 'Open', 2, 15, 50, false);
insert into public.questions (id, exam_set_id, topic, difficulty, stem_de, stem_en, options, correct_option_id, status)
select ('30000000-0000-0000-0000-0000000005' || lpad(n::text, 2, '0'))::uuid,
       case when n <= 6 then '20000000-0000-0000-0000-0000000005e1' else '20000000-0000-0000-0000-0000000005e2' end::uuid,
       't', 'easy', 'Frage ' || n, 'Question ' || n,
       '[{"id":"a","de":"Ja","en":"Yes"},{"id":"b","de":"Nein","en":"No"}]'::jsonb, 'b',
       case when n = 6 then 'draft' else 'approved' end
from generate_series(1, 8) n;

insert into public.assignments (student_id, curriculum_id, position, status) values
  ('00000000-0000-0000-0000-0000000005b1', '10000000-0000-0000-0000-0000000005c1', 1, 'open'),
  ('00000000-0000-0000-0000-0000000005b2', '10000000-0000-0000-0000-0000000005c1', 1, 'open');

create temp table ids (name text primary key, id uuid);
grant all on ids to public;

-- Scoring snapshot as server code builds it: the live key, points and topic of every question
-- of the attempt in paper order, with the given awarded points per position.
create function pg_temp.snap(p_attempt uuid, p_awarded int[]) returns jsonb language sql as $f$
  select jsonb_agg(jsonb_build_object(
           'attempt_question_id', aq.id, 'correct_option_id', q.correct_option_id,
           'max_points', q.points, 'awarded_points', p_awarded[aq.position], 'topic', q.topic)
         order by aq.position)
  from public.attempt_questions aq join public.questions q on q.id = aq.question_id
  where aq.attempt_id = p_attempt
$f$;
grant execute on function pg_temp.snap(uuid, int[]) to public;

-- Privileges -----------------------------------------------------------------
set local role authenticated;
select throws_ok($$select public.start_attempt('00000000-0000-0000-0000-0000000005b1', '20000000-0000-0000-0000-0000000005e1', '[]')$$,
  '42501', null, 'authenticated users cannot call start_attempt');
select throws_ok($$select public.save_answer('00000000-0000-0000-0000-0000000005b1', gen_random_uuid(), gen_random_uuid(), 'a')$$,
  '42501', null, 'authenticated users cannot call save_answer');
select hasnt_function('public', 'record_score', array['uuid', 'integer', 'integer', 'boolean'], 'record_score without a snapshot is gone');
select throws_ok($$select public.record_score(gen_random_uuid(), 1, 1, true, '[]')$$,
  '42501', null, 'authenticated users cannot call record_score');
select throws_ok($$select public.release_attempt(gen_random_uuid(), null)$$,
  '42501', null, 'authenticated users cannot call release_attempt');
select throws_ok($$select public.release_attempt(gen_random_uuid(), '00000000-0000-0000-0000-0000000005a1')$$,
  '42501', null, 'authenticated users cannot call release_attempt, not even naming a staff id');
reset role;
set local role anon;
select throws_ok($$select public.close_expired_attempts()$$, '42501', null, 'anon cannot call close_expired_attempts');
reset role;
set local role service_role;

-- start_attempt ----------------------------------------------------------------
select throws_ok($$select public.start_attempt('00000000-0000-0000-0000-0000000005b1', '20000000-0000-0000-0000-0000000005e1',
  '[{"question_id":"30000000-0000-0000-0000-000000000501","option_order":["b","a"]},{"question_id":"30000000-0000-0000-0000-000000000502","option_order":["a","b"]}]')$$,
  'P0001', 'no_grant', 'start_attempt without an unused grant fails');

insert into public.attempt_grants (student_id, exam_set_id) values
  ('00000000-0000-0000-0000-0000000005b1', '20000000-0000-0000-0000-0000000005e1'),
  ('00000000-0000-0000-0000-0000000005b1', '20000000-0000-0000-0000-0000000005e1');

select throws_ok($$select public.start_attempt('00000000-0000-0000-0000-0000000005b1', '20000000-0000-0000-0000-0000000005e1',
  '[{"question_id":"30000000-0000-0000-0000-000000000501","option_order":["b","a"]}]')$$,
  'P0001', 'invalid_draw', 'a draw with the wrong question count is rejected');
select throws_ok($$select public.start_attempt('00000000-0000-0000-0000-0000000005b1', '20000000-0000-0000-0000-0000000005e1',
  '[{"question_id":"30000000-0000-0000-0000-000000000501","option_order":["b","a"]},{"question_id":"30000000-0000-0000-0000-000000000507","option_order":["a","b"]}]')$$,
  'P0001', 'invalid_draw', 'a draw with a question from another exam set is rejected');
select throws_ok($$select public.start_attempt('00000000-0000-0000-0000-0000000005b1', '20000000-0000-0000-0000-0000000005e1',
  '[{"question_id":"30000000-0000-0000-0000-000000000501","option_order":["b","a"]},{"question_id":"30000000-0000-0000-0000-000000000506","option_order":["a","b"]}]')$$,
  'P0001', 'invalid_draw', 'a draw with a draft question is rejected');

insert into ids select 'a1', public.start_attempt('00000000-0000-0000-0000-0000000005b1', '20000000-0000-0000-0000-0000000005e1',
  '[{"question_id":"30000000-0000-0000-0000-000000000501","option_order":["b","a"]},{"question_id":"30000000-0000-0000-0000-000000000502","option_order":["a","b"]}]');

select is((select deadline_at - started_at from public.attempts where id = (select id from ids where name = 'a1')),
  interval '15 minutes', 'deadline is started_at plus the time limit');
select is((select count(*)::int from public.attempt_grants where used_attempt_id = (select id from ids where name = 'a1')), 1,
  'exactly one grant is claimed');
select is((select array_agg(option_order::text order by position) from public.attempt_questions where attempt_id = (select id from ids where name = 'a1')),
  array['{b,a}', '{a,b}'], 'draw is stored in paper order with its option order');
select throws_ok($$select public.start_attempt('00000000-0000-0000-0000-0000000005b1', '20000000-0000-0000-0000-0000000005e1',
  '[{"question_id":"30000000-0000-0000-0000-000000000503","option_order":["b","a"]},{"question_id":"30000000-0000-0000-0000-000000000502","option_order":["a","b"]}]')$$,
  'P0001', 'question_already_seen', 'a question the student was already given is rejected');
select throws_ok($$select public.start_attempt('00000000-0000-0000-0000-0000000005b1', '20000000-0000-0000-0000-0000000005e1',
  '[{"question_id":"30000000-0000-0000-0000-000000000503","option_order":["b","a"]},{"question_id":"30000000-0000-0000-0000-000000000504","option_order":["a","b"]}]')$$,
  'P0001', 'in_progress', 'a second in-progress attempt for the same set is impossible');
select is((select count(*)::int from public.attempt_grants where student_id = '00000000-0000-0000-0000-0000000005b1' and used_attempt_id is null), 1,
  'the failed start claimed no grant');

-- save_answer -----------------------------------------------------------------
insert into ids select 'q1', id from public.attempt_questions where attempt_id = (select id from ids where name = 'a1') and position = 1;
select lives_ok($$select public.save_answer('00000000-0000-0000-0000-0000000005b1', (select id from ids where name = 'a1'), (select id from ids where name = 'q1'), 'b')$$,
  'the owner saves an answer');
select throws_ok($$select public.save_answer('00000000-0000-0000-0000-0000000005b1', (select id from ids where name = 'a1'), (select id from ids where name = 'q1'), 'x')$$,
  'P0001', 'invalid_option', 'an option id not shown for the question is rejected');
select throws_ok($$select public.save_answer('00000000-0000-0000-0000-0000000005b2', (select id from ids where name = 'a1'), (select id from ids where name = 'q1'), 'a')$$,
  'P0001', 'not_found', 'another student cannot save into the attempt');
update public.attempts set started_at = now() - interval '1 hour', deadline_at = now() - interval '1 minute'
  where id = (select id from ids where name = 'a1');
select throws_ok($$select public.save_answer('00000000-0000-0000-0000-0000000005b1', (select id from ids where name = 'a1'), (select id from ids where name = 'q1'), 'a')$$,
  'P0001', 'deadline_passed', 'saving after the deadline is rejected');

-- close / expire ----------------------------------------------------------------
select is((select public.close_attempt((select id from ids where name = 'a1'), true)), true, 'lazy expiry closes an expired attempt');
select is((select submitted_at = deadline_at from public.attempts where id = (select id from ids where name = 'a1')), true,
  'an expired attempt is submitted at its deadline');
select is((select public.close_attempt((select id from ids where name = 'a1'), false)), false, 'closing twice changes nothing');
select throws_ok($$select public.save_answer('00000000-0000-0000-0000-0000000005b1', (select id from ids where name = 'a1'), (select id from ids where name = 'q1'), 'a')$$,
  'P0001', 'closed', 'saving into a submitted attempt is rejected');

-- record_score ----------------------------------------------------------------
select throws_ok($$select public.record_score((select id from ids where name = 'a1'), 2, 2, true, pg_temp.snap((select id from ids where name = 'a1'), array[1, 0]))$$,
  'P0001', 'invalid_snapshot', 'a snapshot whose awarded points do not add up to the total is rejected');
select throws_ok($$select public.record_score((select id from ids where name = 'a1'), 1, 2, true,
    (select jsonb_agg(e) from jsonb_array_elements(pg_temp.snap((select id from ids where name = 'a1'), array[1, 0])) e where (e ->> 'awarded_points')::int = 1))$$,
  'P0001', 'invalid_snapshot', 'a snapshot that misses a question of the attempt is rejected');
select throws_ok($$select public.record_score((select id from ids where name = 'a1'), 3, 3, true,
    pg_temp.snap((select id from ids where name = 'a1'), array[1, 0]) || jsonb_build_array(jsonb_build_object('attempt_question_id', (select id from public.attempt_questions where attempt_id <> (select id from ids where name = 'a1') limit 1), 'correct_option_id', 'b', 'max_points', 1, 'awarded_points', 1, 'topic', 't')))$$,
  'P0001', 'invalid_snapshot', 'a snapshot with a question of another attempt is rejected');
select throws_ok($$select public.record_score((select id from ids where name = 'a1'), 3, 2, true, pg_temp.snap((select id from ids where name = 'a1'), array[2, 1]))$$,
  'P0001', 'invalid_snapshot', 'awarded points above a question''s points are rejected');
select is((select points from public.attempts where id = (select id from ids where name = 'a1')), null, 'rejected snapshots store no score');
select is((select public.record_score((select id from ids where name = 'a1'), 1, 2, true, pg_temp.snap((select id from ids where name = 'a1'), array[1, 0]))), 'submitted',
  'held set: the score is stored and the attempt stays submitted');
select is((select public.record_score((select id from ids where name = 'a1'), 2, 2, true, pg_temp.snap((select id from ids where name = 'a1'), array[1, 1]))), null,
  'the score is written only once');
select is((select sum(awarded_points)::int || '/' || sum(max_points)::int from public.attempt_questions where attempt_id = (select id from ids where name = 'a1')),
  (select points || '/' || max_points from public.attempts where id = (select id from ids where name = 'a1')),
  'the per-question snapshot adds up to the stored total');
select is((select array_agg(correct_option_id || ':' || awarded_points || ':' || topic order by position) from public.attempt_questions where attempt_id = (select id from ids where name = 'a1')),
  array['b:1:t', 'b:0:t'], 'the key, awarded points and topic are stored per question and not overwritten by a second call');
update public.questions set correct_option_id = 'a', points = 9, topic = 'edited' where id = '30000000-0000-0000-0000-000000000501';
select is((select correct_option_id || ':' || max_points || ':' || topic from public.attempt_questions where attempt_id = (select id from ids where name = 'a1') and position = 1),
  'b:1:t', 'a later edit of the question does not change the snapshot');
update public.questions set correct_option_id = 'b', points = 1, topic = 't' where id = '30000000-0000-0000-0000-000000000501';

insert into public.attempt_grants (student_id, exam_set_id) values ('00000000-0000-0000-0000-0000000005b2', '20000000-0000-0000-0000-0000000005e2');
insert into ids select 'b1', public.start_attempt('00000000-0000-0000-0000-0000000005b2', '20000000-0000-0000-0000-0000000005e2',
  '[{"question_id":"30000000-0000-0000-0000-000000000507","option_order":["a","b"]},{"question_id":"30000000-0000-0000-0000-000000000508","option_order":["a","b"]}]');
select is((select count(*)::int from public.close_expired_attempts() c where c = (select id from ids where name = 'b1')), 0,
  'the sweep leaves attempts before their deadline alone');

-- release_attempt -------------------------------------------------------------
select has_column('public', 'attempts', 'released_by', 'attempts record who released them');
select hasnt_function('public', 'release_attempt', array['uuid'], 'the one-argument release_attempt is gone');
select is((select public.release_attempt((select id from ids where name = 'b1'), '00000000-0000-0000-0000-0000000005a1')), false,
  'an in-progress attempt cannot be released');
select is((select status from public.assignments where student_id = '00000000-0000-0000-0000-0000000005b1'), 'open',
  'a scored held attempt leaves the assignment untouched before release');
select is((select status || '/' || coalesce(released_at::text, 'null') from public.attempts where id = (select id from ids where name = 'a1')),
  'submitted/null', 'a scored held attempt stays submitted until release');
select throws_ok($$select public.release_attempt((select id from ids where name = 'a1'), '00000000-0000-0000-0000-0000000005b2')$$,
  'P0001', 'not_staff', 'only a staff id can be recorded as the releaser');
select is((select status from public.attempts where id = (select id from ids where name = 'a1')), 'submitted',
  'a rejected releaser releases nothing');
select is((select public.release_attempt((select id from ids where name = 'a1'), '00000000-0000-0000-0000-0000000005a1')), true, 'a scored submitted attempt is released');
select is((select released_by from public.attempts where id = (select id from ids where name = 'a1')), '00000000-0000-0000-0000-0000000005a1'::uuid,
  'the releasing staff member is recorded');
select is((select status from public.attempts where id = (select id from ids where name = 'a1')), 'released', 'status is released');
select is((select status from public.assignments where student_id = '00000000-0000-0000-0000-0000000005b1'), 'passed',
  'releasing a passed attempt marks the assignment passed');
select is((select public.release_attempt((select id from ids where name = 'a1'), '00000000-0000-0000-0000-0000000005a2')), false, 'releasing twice is a no-op');
select is((select released_by from public.attempts where id = (select id from ids where name = 'a1')), '00000000-0000-0000-0000-0000000005a1'::uuid,
  'a second release does not overwrite who released it');

-- Atomicity: if the assignment update fails, the score and the release roll back together.
do $d$ begin perform public.close_attempt((select id from ids where name = 'b1'), false); end $d$;
reset role;
create function pg_temp.block_assignments() returns trigger language plpgsql as $f$
begin raise exception 'assignment update blocked'; end $f$;
create trigger block_assignments before update on public.assignments for each row execute function pg_temp.block_assignments();
set local role service_role;
select throws_ok($$select public.record_score((select id from ids where name = 'b1'), 2, 2, true, pg_temp.snap((select id from ids where name = 'b1'), array[1, 1]))$$,
  'P0001', 'assignment update blocked', 'non-held: a failing assignment update aborts the release');
select is((select status || '/' || coalesce(points::text, 'null') || '/' || coalesce(released_at::text, 'null') from public.attempts where id = (select id from ids where name = 'b1')),
  'submitted/null/null', 'nothing of the score or release was committed');
select is((select count(*)::int from public.attempt_questions where attempt_id = (select id from ids where name = 'b1') and awarded_points is not null), 0,
  'nor any of the per-question snapshot');
reset role;
drop trigger block_assignments on public.assignments;
set local role service_role;
select is((select public.record_score((select id from ids where name = 'b1'), 2, 2, true, pg_temp.snap((select id from ids where name = 'b1'), array[1, 1]))), 'released',
  'non-held: record_score releases in the same call');
select is((select released_by from public.attempts where id = (select id from ids where name = 'b1')), null,
  'an automatic release records no staff member');
select is((select status from public.assignments where student_id = '00000000-0000-0000-0000-0000000005b2'), 'passed',
  'non-held pass: the assignment is passed together with the release');

-- A failed attempt is released but leaves the assignment open.
update public.assignments set status = 'open' where student_id = '00000000-0000-0000-0000-0000000005b2';
insert into public.attempt_grants (student_id, exam_set_id) values ('00000000-0000-0000-0000-0000000005b2', '20000000-0000-0000-0000-0000000005e1');
insert into ids select 'b2', public.start_attempt('00000000-0000-0000-0000-0000000005b2', '20000000-0000-0000-0000-0000000005e1',
  '[{"question_id":"30000000-0000-0000-0000-000000000501","option_order":["a","b"]},{"question_id":"30000000-0000-0000-0000-000000000502","option_order":["a","b"]}]');
do $d$ begin perform public.close_attempt((select id from ids where name = 'b2'), false); end $d$;
do $d$ begin perform public.record_score((select id from ids where name = 'b2'), 0, 2, false, pg_temp.snap((select id from ids where name = 'b2'), array[0, 0])); end $d$;
select is((select public.release_attempt((select id from ids where name = 'b2'), '00000000-0000-0000-0000-0000000005a2')), true, 'a failed held attempt is released');
select is((select status from public.assignments where student_id = '00000000-0000-0000-0000-0000000005b2'), 'open',
  'a failed release leaves the assignment open');

select * from finish();
rollback;
