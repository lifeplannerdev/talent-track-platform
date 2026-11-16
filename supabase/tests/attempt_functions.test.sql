-- Attempt lifecycle functions from 0004 (pgTAP). Run: npm run db:test
begin;
select plan(25);

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000005b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'fn-anna@students.test', '{"role":"student","username":"fn.anna"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000005b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'fn-ben@students.test', '{"role":"student","username":"fn.ben"}', '{}', now(), now());
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

create temp table ids (name text primary key, id uuid);
grant all on ids to public;

-- Privileges -----------------------------------------------------------------
set local role authenticated;
select throws_ok($$select public.start_attempt('00000000-0000-0000-0000-0000000005b1', '20000000-0000-0000-0000-0000000005e1', '[]')$$,
  '42501', null, 'authenticated users cannot call start_attempt');
select throws_ok($$select public.save_answer('00000000-0000-0000-0000-0000000005b1', gen_random_uuid(), gen_random_uuid(), 'a')$$,
  '42501', null, 'authenticated users cannot call save_answer');
select throws_ok($$select public.record_score(gen_random_uuid(), 1, 1, true)$$,
  '42501', null, 'authenticated users cannot call record_score');
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
select is((select public.record_score((select id from ids where name = 'a1'), 1, 2, true)), 'submitted',
  'held set: the score is stored and the attempt stays submitted');
select is((select public.record_score((select id from ids where name = 'a1'), 2, 2, true)), null,
  'the score is written only once');

insert into public.attempt_grants (student_id, exam_set_id) values ('00000000-0000-0000-0000-0000000005b2', '20000000-0000-0000-0000-0000000005e2');
insert into ids select 'b1', public.start_attempt('00000000-0000-0000-0000-0000000005b2', '20000000-0000-0000-0000-0000000005e2',
  '[{"question_id":"30000000-0000-0000-0000-000000000507","option_order":["a","b"]},{"question_id":"30000000-0000-0000-0000-000000000508","option_order":["a","b"]}]');
select is((select count(*)::int from public.close_expired_attempts() c where c = (select id from ids where name = 'b1')), 0,
  'the sweep leaves attempts before their deadline alone');

select * from finish();
rollback;
