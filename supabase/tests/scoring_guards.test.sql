-- Scoring guards (pgTAP). Run: npm run db:test
--   * record_score never downgrades an assignment that is already 'passed', even when the
--     scored attempt failed and it used up the whole allowance (the block applies only to 'open').
begin;
select plan(3);

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000022b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'sg-anna@students.test', '{"role":"student","username":"sg.anna"}', '{}', now(), now());
set constraints all immediate;
set constraints all deferred;

-- One attempt allowed, so a failed score would normally block.
insert into public.curriculums (id, name, max_attempts) values ('10000000-0000-0000-0000-0000000022c1', 'SG one try', 1);
insert into public.exam_sets (id, curriculum_id, name, question_count, time_limit_min, pass_mark_percent) values
  ('20000000-0000-0000-0000-0000000022e1', '10000000-0000-0000-0000-0000000022c1', 'SG set', 1, 15, 50);
insert into public.questions (id, exam_set_id, topic, difficulty, stem_de, stem_en, options, correct_option_id, status) values
  ('30000000-0000-0000-0000-000000002201', '20000000-0000-0000-0000-0000000022e1', 't', 'easy', 'Frage', 'Question',
   '[{"id":"a","de":"Ja","en":"Yes"},{"id":"b","de":"Nein","en":"No"}]'::jsonb, 'b', 'approved');
insert into public.assignments (student_id, curriculum_id, position, status) values
  ('00000000-0000-0000-0000-0000000022b1', '10000000-0000-0000-0000-0000000022c1', 1, 'open');

create temp table ids (name text primary key, id uuid);
grant all on ids to public;

set local role service_role;
insert into ids values ('a1', public.start_attempt('00000000-0000-0000-0000-0000000022b1', '20000000-0000-0000-0000-0000000022e1',
  '[{"question_id":"30000000-0000-0000-0000-000000002201","option_order":["a","b"]}]'::jsonb));
select public.close_attempt((select id from ids where name = 'a1'), false);
reset role;

-- The assignment became 'passed' meanwhile (for example a legacy pass recorded by migration).
update public.assignments set status = 'passed'
where student_id = '00000000-0000-0000-0000-0000000022b1' and curriculum_id = '10000000-0000-0000-0000-0000000022c1';

set local role service_role;
select is(
  public.record_score((select id from ids where name = 'a1'), 0, 1, false,
    (select jsonb_agg(jsonb_build_object('attempt_question_id', aq.id, 'correct_option_id', 'b', 'max_points', 1,
                                          'awarded_points', 0, 'topic', 't'))
     from public.attempt_questions aq where aq.attempt_id = (select id from ids where name = 'a1'))),
  'released', 'the failed attempt is scored and released');
reset role;

select is((select status || '/' || passed from public.attempts where id = (select id from ids where name = 'a1')),
  'released/false', 'the stored result is the failed score');
select is((select status from public.assignments
           where student_id = '00000000-0000-0000-0000-0000000022b1' and curriculum_id = '10000000-0000-0000-0000-0000000022c1'),
  'passed', 'a failed score that uses up the allowance never downgrades a passed assignment to blocked');

select * from finish();
rollback;
