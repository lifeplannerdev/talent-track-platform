-- Staff session write limits (0023): staff create assignments only with (student_id,
-- curriculum_id, position); status, extra attempts, repeats, order and removal change only through
-- the service-role functions. Exam sets cannot be moved to another curriculum by a staff session.
-- reorder_curriculums locks the student's assignment rows in id order.
begin;
select plan(17);

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000023a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'swl.staff@staff.test', '{"role":"staff","username":"swl.staff","full_name":"Swl Staff"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000023b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'swl.student@students.test', '{"role":"student","username":"swl.student","full_name":"Swl Student"}', '{}', now(), now());
set constraints all immediate;
set constraints all deferred;

insert into public.curriculums (id, name) values
  ('10000000-0000-0000-0000-0000000023c1', 'Swl One'),
  ('10000000-0000-0000-0000-0000000023c2', 'Swl Two'),
  ('10000000-0000-0000-0000-0000000023c3', 'Swl Three');
insert into public.exam_sets (id, curriculum_id, name, question_count, time_limit_min) values
  ('20000000-0000-0000-0000-0000000023e1', '10000000-0000-0000-0000-0000000023c1', 'Swl set', 1, 10);
insert into public.assignments (student_id, curriculum_id, position, status) values
  ('00000000-0000-0000-0000-0000000023b1', '10000000-0000-0000-0000-0000000023c1', 1, 'blocked'),
  ('00000000-0000-0000-0000-0000000023b1', '10000000-0000-0000-0000-0000000023c2', 2, 'open');

-- Staff session -------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000023a1","role":"authenticated"}', true);
set local role authenticated;

select throws_ok(
  $$update public.assignments set extra_attempts = 5 where student_id = '00000000-0000-0000-0000-0000000023b1'$$,
  '42501', null, 'staff cannot set extra_attempts directly (give_extra_attempts does)');
select throws_ok(
  $$update public.assignments set status = 'open' where student_id = '00000000-0000-0000-0000-0000000023b1'$$,
  '42501', null, 'staff cannot change an assignment status directly');
select throws_ok(
  $$update public.assignments set allow_repeats = true where student_id = '00000000-0000-0000-0000-0000000023b1'$$,
  '42501', null, 'staff cannot switch on repeats directly');
select throws_ok(
  $$update public.assignments set position = 9 where student_id = '00000000-0000-0000-0000-0000000023b1'$$,
  '42501', null, 'staff cannot reorder directly (reorder_curriculums does)');
select throws_ok(
  $$delete from public.assignments where student_id = '00000000-0000-0000-0000-0000000023b1'$$,
  '42501', null, 'staff cannot delete an assignment directly (remove_curriculum does)');
select throws_ok(
  $$insert into public.assignments (student_id, curriculum_id, position, status, extra_attempts)
    values ('00000000-0000-0000-0000-0000000023b1', '10000000-0000-0000-0000-0000000023c3', 3, 'passed', 4)$$,
  '42501', null, 'staff cannot insert an assignment with a status or extra attempts');
select lives_ok(
  $$insert into public.assignments (student_id, curriculum_id, position)
    values ('00000000-0000-0000-0000-0000000023b1', '10000000-0000-0000-0000-0000000023c3', 3)$$,
  'staff can still assign a curriculum (student, curriculum, position)');
select is(
  (select count(*)::int from public.assignments where student_id = '00000000-0000-0000-0000-0000000023b1'),
  3, 'staff can still read assignments');
select throws_ok(
  $$update public.exam_sets set curriculum_id = '10000000-0000-0000-0000-0000000023c2' where id = '20000000-0000-0000-0000-0000000023e1'$$,
  '42501', null, 'staff cannot move an exam set to another curriculum');
select lives_ok(
  $$update public.exam_sets set name = 'Swl set renamed', question_count = 2, time_limit_min = 15, pass_mark_percent = 80,
      topic_mix = '{}'::jsonb, reminder_interval_min = 10
    where id = '20000000-0000-0000-0000-0000000023e1'$$,
  'staff can still edit the exam set settings');
select is(
  (select name from public.exam_sets where id = '20000000-0000-0000-0000-0000000023e1'),
  'Swl set renamed', 'the settings edit was applied');
reset role;

-- Stored rows unchanged by the refused statements.
select is(
  (select status || ':' || extra_attempts || ':' || allow_repeats || ':' || position from public.assignments
   where student_id = '00000000-0000-0000-0000-0000000023b1' and curriculum_id = '10000000-0000-0000-0000-0000000023c1'),
  'blocked:0:false:1', 'the refused updates changed nothing');

-- reorder_curriculums: id-ordered lock, same hardening, same behaviour -------
select ok(
  pg_get_functiondef('public.reorder_curriculums(uuid, uuid, uuid[])'::regprocedure) ~* 'order\s+by\s+id\s+for\s+update',
  'reorder_curriculums locks the assignment rows in id order');
select ok(
  not has_function_privilege('authenticated', 'public.reorder_curriculums(uuid, uuid, uuid[])', 'execute')
  and not has_function_privilege('anon', 'public.reorder_curriculums(uuid, uuid, uuid[])', 'execute')
  and has_function_privilege('service_role', 'public.reorder_curriculums(uuid, uuid, uuid[])', 'execute'),
  'reorder_curriculums stays service role only');
select is(
  (select array_to_string(p.proconfig, ',') from pg_proc p where p.oid = 'public.reorder_curriculums(uuid, uuid, uuid[])'::regprocedure),
  'search_path=""', 'reorder_curriculums keeps an empty search_path');
select lives_ok(
  $$select public.reorder_curriculums('00000000-0000-0000-0000-0000000023a1', '00000000-0000-0000-0000-0000000023b1',
      array['10000000-0000-0000-0000-0000000023c3', '10000000-0000-0000-0000-0000000023c1', '10000000-0000-0000-0000-0000000023c2']::uuid[])$$,
  'reorder_curriculums still reorders');
select is(
  (select array_agg(curriculum_id order by position)::text from public.assignments where student_id = '00000000-0000-0000-0000-0000000023b1'),
  '{10000000-0000-0000-0000-0000000023c3,10000000-0000-0000-0000-0000000023c1,10000000-0000-0000-0000-0000000023c2}',
  'positions follow the given order');

select * from finish();
rollback;
