-- reorder_curriculums and remove_curriculum (0016, pgTAP): atomic assignment changes for the
-- staff student page. Service role only. Run: npm run db:test
begin;
select plan(27);

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000016a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'af-staff@staff.test', '{"role":"staff","username":"af.staff"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000016a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'af-t1@staff.test', '{"role":"trainer","username":"af.t1"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000016a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'af-t2@staff.test', '{"role":"trainer","username":"af.t2"}', '{}', now(), now());
set constraints all immediate;
set constraints all deferred;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000016b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'af-anna@students.test', '{"role":"student","username":"af.anna","trainer_id":"00000000-0000-0000-0000-0000000016a2"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000016b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'af-ben@students.test', '{"role":"student","username":"af.ben","trainer_id":"00000000-0000-0000-0000-0000000016a3"}', '{}', now(), now());
set constraints all immediate;
set constraints all deferred;

insert into public.curriculums (id, name) values
  ('10000000-0000-0000-0000-0000000016c1', 'AF one'),
  ('10000000-0000-0000-0000-0000000016c2', 'AF two'),
  ('10000000-0000-0000-0000-0000000016c3', 'AF three'),
  ('10000000-0000-0000-0000-0000000016c4', 'AF unassigned');
insert into public.exam_sets (id, curriculum_id, name, question_count, time_limit_min, pass_mark_percent) values
  ('20000000-0000-0000-0000-0000000016e1', '10000000-0000-0000-0000-0000000016c1', 'AF set 1', 1, 15, 50),
  ('20000000-0000-0000-0000-0000000016e2', '10000000-0000-0000-0000-0000000016c2', 'AF set 2', 1, 15, 50);

insert into public.assignments (student_id, curriculum_id, position) values
  ('00000000-0000-0000-0000-0000000016b1', '10000000-0000-0000-0000-0000000016c1', 1),
  ('00000000-0000-0000-0000-0000000016b1', '10000000-0000-0000-0000-0000000016c2', 2),
  ('00000000-0000-0000-0000-0000000016b1', '10000000-0000-0000-0000-0000000016c3', 3),
  ('00000000-0000-0000-0000-0000000016b2', '10000000-0000-0000-0000-0000000016c1', 1),
  ('00000000-0000-0000-0000-0000000016b2', '10000000-0000-0000-0000-0000000016c2', 2);
-- Anna: a submitted attempt in curriculum one and extra attempts there (0021: grants are gone,
-- extras live on the assignment row). Ben: an exam in progress in curriculum two.
insert into public.attempts (student_id, exam_set_id, status, deadline_at, submitted_at) values
  ('00000000-0000-0000-0000-0000000016b1', '20000000-0000-0000-0000-0000000016e1', 'submitted', now() - interval '1 hour', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-0000000016b2', '20000000-0000-0000-0000-0000000016e2', 'in_progress', now() + interval '1 hour', null);
update public.assignments set extra_attempts = 2, allow_repeats = true
where student_id = '00000000-0000-0000-0000-0000000016b1' and curriculum_id = '10000000-0000-0000-0000-0000000016c1';

create function pg_temp.order_of(p_student uuid) returns text language sql as $f$
  select string_agg(c.name, ',' order by a.position)
  from public.assignments a join public.curriculums c on c.id = a.curriculum_id
  where a.student_id = p_student
$f$;
grant execute on all functions in schema pg_temp to public;

-- Privileges -----------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'public.reorder_curriculums(uuid, uuid, uuid[])', 'execute'), 'authenticated cannot call reorder_curriculums');
select ok(not has_function_privilege('anon', 'public.reorder_curriculums(uuid, uuid, uuid[])', 'execute'), 'anon cannot call reorder_curriculums');
select ok(has_function_privilege('service_role', 'public.reorder_curriculums(uuid, uuid, uuid[])', 'execute'), 'service_role can call reorder_curriculums');
select ok(not has_function_privilege('authenticated', 'public.remove_curriculum(uuid, uuid, uuid, boolean)', 'execute'), 'authenticated cannot call remove_curriculum');
select ok(not has_function_privilege('anon', 'public.remove_curriculum(uuid, uuid, uuid, boolean)', 'execute'), 'anon cannot call remove_curriculum');
select ok(has_function_privilege('service_role', 'public.remove_curriculum(uuid, uuid, uuid, boolean)', 'execute'), 'service_role can call remove_curriculum');

set local role service_role;

-- reorder_curriculums ------------------------------------------------------------
select lives_ok($$select public.reorder_curriculums('00000000-0000-0000-0000-0000000016a1', '00000000-0000-0000-0000-0000000016b1',
  array['10000000-0000-0000-0000-0000000016c3', '10000000-0000-0000-0000-0000000016c1', '10000000-0000-0000-0000-0000000016c2']::uuid[])$$,
  'staff reorder a student''s curriculums');
select is(pg_temp.order_of('00000000-0000-0000-0000-0000000016b1'), 'AF three,AF one,AF two', 'positions follow the given order');
select throws_ok($$select public.reorder_curriculums('00000000-0000-0000-0000-0000000016a1', '00000000-0000-0000-0000-0000000016b1',
  array['10000000-0000-0000-0000-0000000016c1', '10000000-0000-0000-0000-0000000016c2']::uuid[])$$,
  'P0001', 'order_mismatch', 'a list missing a curriculum is refused');
select throws_ok($$select public.reorder_curriculums('00000000-0000-0000-0000-0000000016a1', '00000000-0000-0000-0000-0000000016b1',
  array['10000000-0000-0000-0000-0000000016c1', '10000000-0000-0000-0000-0000000016c1', '10000000-0000-0000-0000-0000000016c2']::uuid[])$$,
  'P0001', 'order_mismatch', 'a list with a duplicate is refused');
select throws_ok($$select public.reorder_curriculums('00000000-0000-0000-0000-0000000016a1', '00000000-0000-0000-0000-0000000016b1',
  array['10000000-0000-0000-0000-0000000016c1', '10000000-0000-0000-0000-0000000016c2', '10000000-0000-0000-0000-0000000016c4']::uuid[])$$,
  'P0001', 'order_mismatch', 'a list with a curriculum the student does not have is refused');
select throws_ok($$select public.reorder_curriculums('00000000-0000-0000-0000-0000000016b2', '00000000-0000-0000-0000-0000000016b1',
  array['10000000-0000-0000-0000-0000000016c1', '10000000-0000-0000-0000-0000000016c2', '10000000-0000-0000-0000-0000000016c3']::uuid[])$$,
  'P0001', 'not_staff', 'a student id cannot reorder');
select is(pg_temp.order_of('00000000-0000-0000-0000-0000000016b1'), 'AF three,AF one,AF two', 'refusals change no position');

-- remove_curriculum ----------------------------------------------------------------
select throws_ok($$select public.remove_curriculum('00000000-0000-0000-0000-0000000016a1', '00000000-0000-0000-0000-0000000016b2', '10000000-0000-0000-0000-0000000016c2', true)$$,
  'P0001', 'in_progress', 'removal is refused while an exam in the curriculum is in progress, even confirmed');
select is(public.remove_curriculum('00000000-0000-0000-0000-0000000016a1', '00000000-0000-0000-0000-0000000016b1', '10000000-0000-0000-0000-0000000016c1', false),
  '{"ok": false, "code": "has_attempts", "attempts": 1}'::jsonb, 'with attempts, removal needs confirmation');
select is((select count(*)::int from public.assignments where student_id = '00000000-0000-0000-0000-0000000016b1'), 3, 'nothing removed without confirmation');
select is(public.remove_curriculum('00000000-0000-0000-0000-0000000016a1', '00000000-0000-0000-0000-0000000016b1', '10000000-0000-0000-0000-0000000016c1', true),
  '{"ok": true}'::jsonb, 'confirmed removal succeeds');
select is((select count(*)::int from public.assignments where student_id = '00000000-0000-0000-0000-0000000016b1'
  and curriculum_id = '10000000-0000-0000-0000-0000000016c1'), 0,
  'the assignment is gone, and with it its extra attempts and allow_repeats');
select is((select count(*)::int from public.attempts where student_id = '00000000-0000-0000-0000-0000000016b1'), 1, 'the attempt stays for the record');
select throws_ok($$select public.remove_curriculum('00000000-0000-0000-0000-0000000016a1', '00000000-0000-0000-0000-0000000016b1', '10000000-0000-0000-0000-0000000016c4', true)$$,
  'P0001', 'not_assigned', 'a curriculum that is not assigned is refused');


-- Ownership (0027): T1 (a2) owns Anna (b1), T2 (a3) owns Ben (b2). Anna now has c3 and c2; Ben c1 and c2.
select throws_ok($$select public.reorder_curriculums('00000000-0000-0000-0000-0000000016a3', '00000000-0000-0000-0000-0000000016b1',
  array['10000000-0000-0000-0000-0000000016c2', '10000000-0000-0000-0000-0000000016c3']::uuid[])$$,
  'P0001', 'not_your_student', 'a trainer cannot reorder another trainer''s student');
select lives_ok($$select public.reorder_curriculums('00000000-0000-0000-0000-0000000016a2', '00000000-0000-0000-0000-0000000016b1',
  array['10000000-0000-0000-0000-0000000016c2', '10000000-0000-0000-0000-0000000016c3']::uuid[])$$,
  'a trainer reorders their own student');
select is(pg_temp.order_of('00000000-0000-0000-0000-0000000016b1'), 'AF two,AF three', 'the trainer''s order is applied');
select throws_ok($$select public.remove_curriculum('00000000-0000-0000-0000-0000000016a2', '00000000-0000-0000-0000-0000000016b2', '10000000-0000-0000-0000-0000000016c1', true)$$,
  'P0001', 'not_your_student', 'a trainer cannot remove a curriculum from another trainer''s student');
select is(public.remove_curriculum('00000000-0000-0000-0000-0000000016a3', '00000000-0000-0000-0000-0000000016b2', '10000000-0000-0000-0000-0000000016c1', false),
  '{"ok": true}'::jsonb, 'a trainer removes a curriculum from their own student');
select throws_ok($$select public.reorder_curriculums('00000000-0000-0000-0000-0000000016a1', '00000000-0000-0000-0000-0000000016a2',
  array[]::uuid[])$$,
  'P0001', 'not_your_student', 'an admin cannot reorder a non-student id');
reset role;
update public.profiles set active = false where id = '00000000-0000-0000-0000-0000000016a3';
set local role service_role;
select throws_ok($$select public.remove_curriculum('00000000-0000-0000-0000-0000000016a3', '00000000-0000-0000-0000-0000000016b2', '10000000-0000-0000-0000-0000000016c2', true)$$,
  'P0001', 'not_staff', 'a deactivated trainer is not staff');

reset role;
select * from finish();
rollback;
