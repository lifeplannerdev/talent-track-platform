-- v2 Phase 1, migration 0026: roles (admin, trainer, student), trainer scope and student_details (pgTAP).
-- Run: npm run db:test   (needs the local stack: npm run db:start)
begin;
select plan(73);

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres). Ids: a1 admin, a2 trainer T1, a3 trainer T2, a4 legacy 'staff' metadata,
-- b1 student of T1, b2 student of T2, b3 unassigned student, b4 student with a bad trainer_id,
-- b5 student whose trainer_id points at a student.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000026a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'admin26@staff.test', '{"role":"admin","username":"adm26","full_name":"Admin 26"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000026a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'trainer1@staff.test', '{"role":"trainer","username":"trn26a","full_name":"Trainer A"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000026a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'trainer2@staff.test', '{"role":"trainer","username":"trn26b","full_name":"Trainer B"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000026a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'legacy@staff.test', '{"role":"staff","username":"legacy26","full_name":"Legacy Staff"}', '{}', now(), now());
set constraints all immediate;
set constraints all deferred;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000026b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'stu1@students.test', '{"role":"student","username":"stu26a","full_name":"Student A","trainer_id":"00000000-0000-0000-0000-0000000026a2"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000026b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'stu2@students.test', '{"role":"student","username":"stu26b","full_name":"Student B","trainer_id":"00000000-0000-0000-0000-0000000026a3"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000026b3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'stu3@students.test', '{"role":"student","username":"stu26c","full_name":"Student C"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000026b4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'stu4@students.test', '{"role":"student","username":"stu26d","full_name":"Student D","trainer_id":"not-a-uuid"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000026b5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'stu5@students.test', '{"role":"student","username":"stu26e","full_name":"Student E","trainer_id":"00000000-0000-0000-0000-0000000026b1"}', '{}', now(), now());
set constraints all immediate;
set constraints all deferred;

insert into public.curriculums (id, name) values ('10000000-0000-0000-0000-000000002601', 'Scope curriculum');
insert into public.curriculums (id, name) values ('10000000-0000-0000-0000-000000002602', 'Scope curriculum 2');
insert into public.exam_sets (id, curriculum_id, name, question_count, time_limit_min, pass_mark_percent)
values ('20000000-0000-0000-0000-000000002601', '10000000-0000-0000-0000-000000002601', 'Scope set', 1, 30, 90);
insert into public.questions (id, exam_set_id, topic, difficulty, stem_de, stem_en, options, correct_option_id, points, status)
values ('30000000-0000-0000-0000-000000002601', '20000000-0000-0000-0000-000000002601', 'law', 'easy', 'Frage', 'Question',
        '[{"id":"a","de":"Ja","en":"Yes"},{"id":"b","de":"Nein","en":"No"}]'::jsonb, 'b', 1, 'approved');

insert into public.assignments (student_id, curriculum_id, position) values
  ('00000000-0000-0000-0000-0000000026b1', '10000000-0000-0000-0000-000000002601', 1),
  ('00000000-0000-0000-0000-0000000026b2', '10000000-0000-0000-0000-000000002601', 1),
  ('00000000-0000-0000-0000-0000000026b3', '10000000-0000-0000-0000-000000002601', 1);
insert into public.attempts (id, student_id, exam_set_id, status, deadline_at) values
  ('40000000-0000-0000-0000-000000002601', '00000000-0000-0000-0000-0000000026b1', '20000000-0000-0000-0000-000000002601', 'in_progress', now() + interval '1 hour'),
  ('40000000-0000-0000-0000-000000002602', '00000000-0000-0000-0000-0000000026b2', '20000000-0000-0000-0000-000000002601', 'in_progress', now() + interval '1 hour'),
  ('40000000-0000-0000-0000-000000002603', '00000000-0000-0000-0000-0000000026b3', '20000000-0000-0000-0000-000000002601', 'in_progress', now() + interval '1 hour');
insert into public.attempt_questions (id, attempt_id, question_id, position, option_order) values
  ('50000000-0000-0000-0000-000000002601', '40000000-0000-0000-0000-000000002601', '30000000-0000-0000-0000-000000002601', 1, '{a,b}'),
  ('50000000-0000-0000-0000-000000002602', '40000000-0000-0000-0000-000000002602', '30000000-0000-0000-0000-000000002601', 1, '{a,b}'),
  ('50000000-0000-0000-0000-000000002603', '40000000-0000-0000-0000-000000002603', '30000000-0000-0000-0000-000000002601', 1, '{a,b}');
insert into public.answers (attempt_question_id, option_id) values
  ('50000000-0000-0000-0000-000000002601', 'a'),
  ('50000000-0000-0000-0000-000000002602', 'a'),
  ('50000000-0000-0000-0000-000000002603', 'a');

insert into public.student_details (student_id, contact_email, passport_number, german_level) values
  ('00000000-0000-0000-0000-0000000026b1', 'a@example.test', 'P1111111', 'A2'),
  ('00000000-0000-0000-0000-0000000026b2', 'b@example.test', 'P2222222', 'B1'),
  ('00000000-0000-0000-0000-0000000026b3', 'c@example.test', 'P3333333', null);

-- ---------------------------------------------------------------------------
-- Schema and trigger (as postgres)
-- ---------------------------------------------------------------------------
select is((select trainer_id from public.profiles where id = '00000000-0000-0000-0000-0000000026b1'),
  '00000000-0000-0000-0000-0000000026a2'::uuid, 'trigger reads trainer_id from app metadata');
select is((select trainer_id from public.profiles where id = '00000000-0000-0000-0000-0000000026b4'),
  null, 'an invalid trainer_id in app metadata stays null');
select is((select trainer_id from public.profiles where id = '00000000-0000-0000-0000-0000000026b5'),
  null, 'a trainer_id that is not a staff profile stays null');
select is((select trainer_id from public.profiles where id = '00000000-0000-0000-0000-0000000026b3'),
  null, 'trainer_id defaults to null');
select is((select role from public.profiles where id = '00000000-0000-0000-0000-0000000026a2'), 'trainer',
  'trigger creates a trainer profile');
select is((select role from public.profiles where id = '00000000-0000-0000-0000-0000000026a4'), 'admin',
  'legacy app metadata role staff becomes admin');
select is((select active from public.profiles where id = '00000000-0000-0000-0000-0000000026b1'), true,
  'profiles.active defaults to true');
select throws_ok(
  $$insert into public.profiles (id, role, username) values (gen_random_uuid(), 'staff', 'bad.role')$$,
  '23514', null, 'the old staff role is no longer allowed');
select throws_ok(
  $$insert into public.student_details (student_id, contact_email, german_level) values ('00000000-0000-0000-0000-0000000026b4', 'd@example.test', 'D9')$$,
  '23514', null, 'german_level must be A0 to C1');
select throws_ok(
  $$insert into public.student_details (student_id, contact_email, status) values ('00000000-0000-0000-0000-0000000026b4', 'd@example.test', 'gone')$$,
  '23514', null, 'status must be active, on_hold, completed or dropped');
select throws_ok(
  $$insert into public.student_details (student_id, contact_email) values ('00000000-0000-0000-0000-0000000026b4', null)$$,
  '23502', null, 'contact_email is required');
select is((select status from public.student_details where student_id = '00000000-0000-0000-0000-0000000026b1'), 'active',
  'status defaults to active');

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000026a1","role":"authenticated"}', true);
set local role authenticated;

select ok((select private.is_staff()) and (select private.is_admin()), 'admin is staff and admin');
select is((select count(*)::int from public.profiles where id::text like '00000000-0000-0000-0000-0000000026b%'), 5,
  'admin reads all student profiles');
select is((select count(*)::int from public.student_details where student_id::text like '00000000-0000-0000-0000-0000000026b%'), 3,
  'admin reads all student details');
select is((select count(*)::int from public.attempts where id::text like '40000000-0000-0000-0000-00000000260%'), 3,
  'admin reads all attempts');
select lives_ok(
  $$insert into public.curriculums (id, name) values ('10000000-0000-0000-0000-000000002699', 'Admin made')$$,
  'admin can insert a curriculum');
select lives_ok(
  $$update public.questions set points = 2 where id = '30000000-0000-0000-0000-000000002601'$$,
  'admin can update a question');
select lives_ok(
  $$insert into public.student_details (student_id, contact_email) values ('00000000-0000-0000-0000-0000000026b4', 'd@example.test')$$,
  'admin can insert student details');
reset role;

-- ---------------------------------------------------------------------------
-- Trainer T1 (students: b1)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000026a2","role":"authenticated"}', true);
set local role authenticated;

select ok((select private.is_staff()) and not (select private.is_admin()), 'trainer is staff but not admin');
select ok((select private.manages_student('00000000-0000-0000-0000-0000000026b1'))
  and not (select private.manages_student('00000000-0000-0000-0000-0000000026b2'))
  and not (select private.manages_student('00000000-0000-0000-0000-0000000026b3')),
  'manages_student is true only for the trainer''s own student');
select is((select array_agg(username order by username)::text from public.profiles where role = 'student'), '{stu26a}',
  'trainer reads only their own students in profiles');
select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-0000000026a3'), 0,
  'trainer cannot read another trainer''s profile');
select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-0000000026a2'), 1,
  'trainer reads their own profile');
select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-0000000026b3'), 0,
  'trainer cannot read an unassigned student');
select is((select array_agg(student_id::text) from public.assignments), array['00000000-0000-0000-0000-0000000026b1'],
  'trainer reads only their student''s assignments');
select is((select array_agg(student_id::text) from public.attempts), array['00000000-0000-0000-0000-0000000026b1'],
  'trainer reads only their student''s attempts');
select is((select count(*)::int from public.attempt_questions), 1, 'trainer reads only their student''s attempt questions');
select is((select count(*)::int from public.answers), 1, 'trainer reads only their student''s answers');
select is((select array_agg(student_id::text) from public.student_details), array['00000000-0000-0000-0000-0000000026b1'],
  'trainer reads only their student''s details');
select is((select count(*)::int from public.curriculums where id = '10000000-0000-0000-0000-000000002601'), 1,
  'trainer reads curriculums');
select is((select count(*)::int from public.questions where id = '30000000-0000-0000-0000-000000002601'), 1,
  'trainer reads questions');
select lives_ok(
  $$insert into public.assignments (student_id, curriculum_id, position) values ('00000000-0000-0000-0000-0000000026b1', '10000000-0000-0000-0000-000000002602', 2)$$,
  'trainer can assign a curriculum to their own student');
select throws_ok(
  $$insert into public.assignments (student_id, curriculum_id, position) values ('00000000-0000-0000-0000-0000000026b2', '10000000-0000-0000-0000-000000002602', 2)$$,
  '42501', null, 'trainer cannot assign a curriculum to another trainer''s student');
select throws_ok(
  $$insert into public.curriculums (name) values ('Trainer made')$$, '42501', null, 'trainer cannot insert a curriculum');
select lives_ok($$update public.curriculums set name = 'Trainer renamed' where id = '10000000-0000-0000-0000-000000002601'$$,
  'trainer cannot update a curriculum (no row matches)');
select throws_ok(
  $$insert into public.exam_sets (curriculum_id, name, question_count, time_limit_min, pass_mark_percent) values ('10000000-0000-0000-0000-000000002601', 'T set', 1, 10, 90)$$,
  '42501', null, 'trainer cannot insert an exam set');
select lives_ok($$update public.exam_sets set name = 'Trainer set' where id = '20000000-0000-0000-0000-000000002601'$$,
  'trainer cannot update an exam set (no row matches)');
select throws_ok(
  $$insert into public.questions (exam_set_id, topic, difficulty, stem_de, stem_en, options, correct_option_id, points, status) values ('20000000-0000-0000-0000-000000002601', 'law', 'easy', 'x', 'x', '[{"id":"a","de":"x","en":"x"},{"id":"b","de":"y","en":"y"}]'::jsonb, 'a', 1, 'draft')$$,
  '42501', null, 'trainer cannot insert a question');
select lives_ok($$update public.questions set points = 5 where id = '30000000-0000-0000-0000-000000002601'$$,
  'trainer cannot update a question (no row matches)');
select lives_ok(
  $$update public.student_details set phone = '+91 1' where student_id = '00000000-0000-0000-0000-0000000026b1'$$,
  'trainer can update their student''s details');
select lives_ok($$update public.student_details set phone = '+91 2' where student_id = '00000000-0000-0000-0000-0000000026b2'$$,
  'trainer cannot update another trainer''s student details (no row matches)');
select throws_ok(
  $$insert into public.student_details (student_id, contact_email) values ('00000000-0000-0000-0000-0000000026b5', 'e@example.test')$$,
  '42501', null, 'trainer cannot add details for a student they do not manage');
select throws_ok(
  $$update public.profiles set trainer_id = '00000000-0000-0000-0000-0000000026a2' where id = '00000000-0000-0000-0000-0000000026b3'$$,
  '42501', null, 'trainer cannot assign students to themselves');
reset role;

select is(
  (select c.name || '|' || e.name || '|' || q.points || '|' || coalesce(d.phone, '-')
   from public.curriculums c, public.exam_sets e, public.questions q, public.student_details d
   where c.id = '10000000-0000-0000-0000-000000002601' and e.id = '20000000-0000-0000-0000-000000002601'
     and q.id = '30000000-0000-0000-0000-000000002601' and d.student_id = '00000000-0000-0000-0000-0000000026b2'),
  'Scope curriculum|Scope set|2|-', 'the trainer''s refused updates changed nothing');

-- ---------------------------------------------------------------------------
-- Student b1 and anon
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000026b1","role":"authenticated"}', true);
set local role authenticated;

select is((select count(*)::int from public.student_details), 0, 'student reads no student_details row');
select ok(not (select private.is_staff()) and not (select private.is_admin()), 'student is neither staff nor admin');
select throws_ok(
  $$update public.profiles set trainer_id = null where id = '00000000-0000-0000-0000-0000000026b1'$$,
  '42501', null, 'student cannot update trainer_id');
select throws_ok(
  $$update public.profiles set active = false where id = '00000000-0000-0000-0000-0000000026b1'$$,
  '42501', null, 'student cannot update active');
reset role;

set local role anon;
select throws_ok($$select count(*) from public.student_details$$, '42501', null, 'anon cannot read student_details');
select throws_ok($$select count(*) from public.profiles$$, '42501', null, 'anon cannot read profiles');
reset role;

-- ---------------------------------------------------------------------------
-- 0027 hardening: manages_student only for real students, student_details column limits,
-- staff_manages_student, deactivated staff, trainer limits
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000026a1","role":"authenticated"}', true);
set local role authenticated;
select ok(not (select private.manages_student('00000000-0000-0000-0000-0000000026a2')),
  'admin does not manage a staff profile (manages_student is false for a non-student id)');
select throws_ok(
  $$insert into public.student_details (student_id, contact_email) values ('00000000-0000-0000-0000-0000000026a2', 'trainer@example.test')$$,
  '42501', null, 'admin cannot attach student details to a staff profile');
select throws_ok(
  $$update public.student_details set student_id = '00000000-0000-0000-0000-0000000026b5' where student_id = '00000000-0000-0000-0000-0000000026b1'$$,
  '42501', null, 'student_details.student_id cannot be changed');
select throws_ok(
  $$update public.student_details set created_at = now() - interval '1 year' where student_id = '00000000-0000-0000-0000-0000000026b1'$$,
  '42501', null, 'student_details.created_at cannot be changed');
select throws_ok(
  $$update public.student_details set updated_at = now() - interval '1 year' where student_id = '00000000-0000-0000-0000-0000000026b1'$$,
  '42501', null, 'student_details.updated_at cannot be changed');
select lives_ok(
  $$update public.student_details set phone = '+91 3', notes = 'n', status = 'on_hold' where student_id = '00000000-0000-0000-0000-0000000026b1'$$,
  'the editable student_details columns can still be updated');
reset role;

select ok((select private.staff_manages_student('00000000-0000-0000-0000-0000000026a2', '00000000-0000-0000-0000-0000000026b1')),
  'staff_manages_student: a trainer manages their own student');
select ok(not (select private.staff_manages_student('00000000-0000-0000-0000-0000000026a2', '00000000-0000-0000-0000-0000000026b2')),
  'staff_manages_student: a trainer does not manage another trainer''s student');
select ok((select private.staff_manages_student('00000000-0000-0000-0000-0000000026a1', '00000000-0000-0000-0000-0000000026b3')),
  'staff_manages_student: an admin manages any student');
select ok(not (select private.staff_manages_student('00000000-0000-0000-0000-0000000026a1', '00000000-0000-0000-0000-0000000026a2')),
  'staff_manages_student: an admin does not manage a staff profile');
select ok(not (select private.staff_manages_student('00000000-0000-0000-0000-0000000026b1', '00000000-0000-0000-0000-0000000026b1')),
  'staff_manages_student: a student manages nobody');
select ok(not has_function_privilege('authenticated', 'private.staff_manages_student(uuid, uuid)', 'execute'),
  'authenticated cannot execute staff_manages_student');
select ok(not has_function_privilege('anon', 'private.staff_manages_student(uuid, uuid)', 'execute'),
  'anon cannot execute staff_manages_student');
select ok(has_function_privilege('service_role', 'private.staff_manages_student(uuid, uuid)', 'execute')
  and has_schema_privilege('service_role', 'private', 'usage'),
  'service_role can execute staff_manages_student');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000026a2","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.profiles where id in ('00000000-0000-0000-0000-0000000026a1', '00000000-0000-0000-0000-0000000026a4')), 0,
  'trainer cannot read admin profiles');
select throws_ok(
  $$update public.assignments set status = 'passed' where student_id = '00000000-0000-0000-0000-0000000026b1'$$,
  '42501', null, 'trainer cannot update assignments');
reset role;

-- Deactivated staff lose access (profiles.active = false)
update public.profiles set active = false
where id in ('00000000-0000-0000-0000-0000000026a3', '00000000-0000-0000-0000-0000000026a4');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000026a3","role":"authenticated"}', true);
set local role authenticated;
select ok(not (select private.is_staff()), 'a deactivated trainer is not staff');
select ok(not (select private.manages_student('00000000-0000-0000-0000-0000000026b2')),
  'a deactivated trainer manages no student');
select is((select count(*)::int from public.profiles where role = 'student')
  + (select count(*)::int from public.student_details)
  + (select count(*)::int from public.attempts)
  + (select count(*)::int from public.assignments), 0,
  'a deactivated trainer reads no student data');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000026a4","role":"authenticated"}', true);
set local role authenticated;
select ok(not (select private.is_staff()) and not (select private.is_admin()), 'a deactivated admin is neither staff nor admin');
select is((select count(*)::int from public.profiles where role = 'student')
  + (select count(*)::int from public.student_details)
  + (select count(*)::int from public.attempts)
  + (select count(*)::int from public.assignments), 0,
  'a deactivated admin reads no student data');
select is((select count(*)::int from public.questions), 0, 'a deactivated admin reads no questions');
reset role;

select * from finish();
rollback;
