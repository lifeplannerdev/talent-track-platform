-- Staff session write limits, part 2 (0025): profiles are written only by the Auth trigger and
-- the service role (consent), so authenticated has no INSERT or UPDATE on profiles (a staff token
-- could otherwise make a student staff). curriculums and questions UPDATE are column-level for
-- exactly the columns the app edits.
begin;
select plan(15);

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000025a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'pw.staff@staff.test', '{"role":"staff","username":"pw.staff","full_name":"Pw Staff"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000025b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'pw.student@students.test', '{"role":"student","username":"pw.student","full_name":"Pw Student"}', '{}', now(), now());
set constraints all immediate;
set constraints all deferred;

insert into public.curriculums (id, name) values ('10000000-0000-0000-0000-0000000025c1', 'Pw Curriculum');
insert into public.exam_sets (id, curriculum_id, name, question_count, time_limit_min) values
  ('20000000-0000-0000-0000-0000000025e1', '10000000-0000-0000-0000-0000000025c1', 'Pw set', 1, 10),
  ('20000000-0000-0000-0000-0000000025e2', '10000000-0000-0000-0000-0000000025c1', 'Pw set 2', 1, 10);
insert into public.questions (id, exam_set_id, topic, difficulty, stem_de, stem_en, options, correct_option_id, points, status)
values ('30000000-0000-0000-0000-0000000025f1', '20000000-0000-0000-0000-0000000025e1', 't', 'easy', 'Frage?', 'Question?',
        '[{"id":"a","de":"Ja","en":"Yes"},{"id":"b","de":"Nein","en":"No"}]'::jsonb, 'b', 1, 'draft');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000025a1","role":"authenticated"}', true);
set local role authenticated;

select throws_ok(
  $$update public.profiles set role = 'staff' where id = '00000000-0000-0000-0000-0000000025b1'$$,
  '42501', null, 'staff cannot make a student staff');
select throws_ok(
  $$update public.profiles set full_name = 'Renamed' where id = '00000000-0000-0000-0000-0000000025b1'$$,
  '42501', null, 'staff cannot edit profiles through the session at all');
select throws_ok(
  $$insert into public.profiles (id, role, username, full_name) values (gen_random_uuid(), 'staff', 'pw.fake', 'Fake')$$,
  '42501', null, 'staff cannot insert a profile (the Auth trigger does)');
select is(
  (select count(*)::int from public.profiles where id in ('00000000-0000-0000-0000-0000000025a1', '00000000-0000-0000-0000-0000000025b1')),
  2, 'staff can still read profiles');

select lives_ok(
  $$update public.curriculums set name = 'Pw Curriculum renamed', max_attempts = 3 where id = '10000000-0000-0000-0000-0000000025c1'$$,
  'staff can still rename a curriculum and set its attempts per student');
select throws_ok(
  $$update public.curriculums set created_at = now() - interval '1 year' where id = '10000000-0000-0000-0000-0000000025c1'$$,
  '42501', null, 'staff cannot rewrite a curriculum created_at');
select throws_ok(
  $$update public.curriculums set id = gen_random_uuid() where id = '10000000-0000-0000-0000-0000000025c1'$$,
  '42501', null, 'staff cannot change a curriculum id');
select lives_ok(
  $$insert into public.curriculums (name) values ('Pw New Curriculum')$$,
  'staff can still create a curriculum');

select lives_ok(
  $$update public.questions set topic = 'u', difficulty = 'hard', stem_de = 'Neu?', stem_en = 'New?',
      options = '[{"id":"a","de":"Ja","en":"Yes"},{"id":"b","de":"Nein","en":"No"}]'::jsonb, correct_option_id = 'a',
      points = 2, status = 'approved'
    where id = '30000000-0000-0000-0000-0000000025f1'$$,
  'staff can still edit, approve and draft a question');
select throws_ok(
  $$update public.questions set exam_set_id = '20000000-0000-0000-0000-0000000025e2' where id = '30000000-0000-0000-0000-0000000025f1'$$,
  '42501', null, 'staff cannot move a question to another exam set');
select throws_ok(
  $$update public.questions set created_at = now() where id = '30000000-0000-0000-0000-0000000025f1'$$,
  '42501', null, 'staff cannot rewrite a question created_at');
select lives_ok(
  $$insert into public.questions (exam_set_id, topic, difficulty, stem_de, stem_en, options, correct_option_id, points, status)
    values ('20000000-0000-0000-0000-0000000025e2', 't', 'easy', 'Zwei?', 'Two?',
            '[{"id":"a","de":"Ja","en":"Yes"},{"id":"b","de":"Nein","en":"No"}]'::jsonb, 'b', 1, 'approved')$$,
  'staff can still add questions (manual form and CSV import)');
reset role;

select is(
  (select role from public.profiles where id = '00000000-0000-0000-0000-0000000025b1'),
  'student', 'the student is still a student');
select ok(
  not exists (select 1 from pg_policies where tablename = 'profiles' and policyname in ('profiles_staff_insert', 'profiles_staff_update')),
  'the staff insert and update policies on profiles are gone');
select ok(
  not has_table_privilege('anon', 'public.profiles', 'select'),
  'anon still has no access to profiles');

select * from finish();
rollback;
