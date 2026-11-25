-- Phase 2a, migration 0028: books, book_pages, chapters, the three service-role functions and the
-- private book-pages bucket (pgTAP). Run: npm run db:test
begin;
select plan(54);

-- Fixtures: a1 admin, a2 inactive admin, a3 trainer, b1 student.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000028a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bk-admin@staff.test', '{"role":"admin","username":"bk.admin"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000028a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bk-admin2@staff.test', '{"role":"admin","username":"bk.admin2"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000028a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bk-trainer@staff.test', '{"role":"trainer","username":"bk.trainer"}', '{}', now(), now());
set constraints all immediate;
set constraints all deferred;
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000028b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bk-stu@students.test', '{"role":"student","username":"bk.stu"}', '{}', now(), now());
set constraints all immediate;
set constraints all deferred;
update public.profiles set active = false where id = '00000000-0000-0000-0000-0000000028a2';

insert into public.curriculums (id, name) values
  ('10000000-0000-0000-0000-0000000028c1', 'BK curriculum 1'),
  ('10000000-0000-0000-0000-0000000028c2', 'BK curriculum 2'),
  ('10000000-0000-0000-0000-0000000028c3', 'BK curriculum 3');

create function pg_temp.pages(p_n int) returns jsonb language sql as $f$
  select jsonb_agg(jsonb_build_object('page', n, 'path', 'c/u/' || n || '.webp', 'thumb', 'c/u/t' || n || '.webp',
                                      'width', 800, 'height', 1100) order by n)
  from generate_series(1, p_n) n
$f$;
grant execute on all functions in schema pg_temp to public;

-- Structure, privileges ------------------------------------------------------------------
select has_table('public', 'books', 'books exists');
select has_table('public', 'book_pages', 'book_pages exists');
select has_table('public', 'chapters', 'chapters exists');
select ok((select relrowsecurity from pg_class where oid = 'public.books'::regclass)
      and (select relrowsecurity from pg_class where oid = 'public.book_pages'::regclass)
      and (select relrowsecurity from pg_class where oid = 'public.chapters'::regclass), 'RLS on all three tables');

select ok(not has_function_privilege('public', 'public.finalize_book_upload(uuid, uuid, uuid, jsonb)', 'execute'), 'PUBLIC cannot execute finalize_book_upload');
select ok(not has_function_privilege('anon', 'public.finalize_book_upload(uuid, uuid, uuid, jsonb)', 'execute')
      and not has_function_privilege('authenticated', 'public.finalize_book_upload(uuid, uuid, uuid, jsonb)', 'execute'), 'anon and authenticated cannot execute finalize_book_upload');
select ok(has_function_privilege('service_role', 'public.finalize_book_upload(uuid, uuid, uuid, jsonb)', 'execute'), 'service_role can execute finalize_book_upload');
select ok(not has_function_privilege('anon', 'public.save_chapters(uuid, uuid, jsonb)', 'execute')
      and not has_function_privilege('authenticated', 'public.save_chapters(uuid, uuid, jsonb)', 'execute')
      and not has_function_privilege('public', 'public.save_chapters(uuid, uuid, jsonb)', 'execute'), 'only service_role executes save_chapters (1)');
select ok(has_function_privilege('service_role', 'public.save_chapters(uuid, uuid, jsonb)', 'execute'), 'service_role can execute save_chapters');
select ok(not has_function_privilege('anon', 'public.set_book_status(uuid, uuid, text)', 'execute')
      and not has_function_privilege('authenticated', 'public.set_book_status(uuid, uuid, text)', 'execute')
      and not has_function_privilege('public', 'public.set_book_status(uuid, uuid, text)', 'execute'), 'only service_role executes set_book_status (1)');
select ok(has_function_privilege('service_role', 'public.set_book_status(uuid, uuid, text)', 'execute'), 'service_role can execute set_book_status');
select is((select proconfig from pg_proc where oid = 'public.finalize_book_upload(uuid, uuid, uuid, jsonb)'::regprocedure),
          array['search_path=""'], 'finalize_book_upload has an empty search_path');

-- Admin check ----------------------------------------------------------------------------
select throws_ok($$select public.finalize_book_upload('00000000-0000-0000-0000-0000000028a3', '10000000-0000-0000-0000-0000000028c1', gen_random_uuid(), pg_temp.pages(3))$$,
  'P0001', 'not_admin', 'a trainer cannot finalize an upload');
select throws_ok($$select public.finalize_book_upload('00000000-0000-0000-0000-0000000028a2', '10000000-0000-0000-0000-0000000028c1', gen_random_uuid(), pg_temp.pages(3))$$,
  'P0001', 'not_admin', 'an inactive admin cannot finalize an upload');
select throws_ok($$select public.finalize_book_upload('00000000-0000-0000-0000-0000000028b1', '10000000-0000-0000-0000-0000000028c1', gen_random_uuid(), pg_temp.pages(3))$$,
  'P0001', 'not_admin', 'a student cannot finalize an upload');
select throws_ok($$select public.finalize_book_upload(gen_random_uuid(), '10000000-0000-0000-0000-0000000028c1', gen_random_uuid(), pg_temp.pages(3))$$,
  'P0001', 'not_admin', 'an unknown id cannot finalize an upload');
select throws_ok($$select public.save_chapters('00000000-0000-0000-0000-0000000028a3', '10000000-0000-0000-0000-0000000028c1', '[{"title":"A","start_page":1}]')$$,
  'P0001', 'not_admin', 'a trainer cannot save chapters');
select throws_ok($$select public.save_chapters('00000000-0000-0000-0000-0000000028a2', '10000000-0000-0000-0000-0000000028c1', '[{"title":"A","start_page":1}]')$$,
  'P0001', 'not_admin', 'an inactive admin cannot save chapters');
select throws_ok($$select public.set_book_status('00000000-0000-0000-0000-0000000028a3', '10000000-0000-0000-0000-0000000028c1', 'published')$$,
  'P0001', 'not_admin', 'a trainer cannot set the status');
select throws_ok($$select public.set_book_status('00000000-0000-0000-0000-0000000028a2', '10000000-0000-0000-0000-0000000028c1', 'published')$$,
  'P0001', 'not_admin', 'an inactive admin cannot set the status');

-- finalize_book_upload -------------------------------------------------------------------
select throws_ok($$select public.save_chapters('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', '[{"title":"A","start_page":1}]')$$,
  'P0001', 'no_book', 'save_chapters without a book raises no_book');
select throws_ok($$select public.set_book_status('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', 'published')$$,
  'P0001', 'no_book', 'set_book_status without a book raises no_book');
select throws_ok($$select public.finalize_book_upload('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', gen_random_uuid(), '[]'::jsonb)$$,
  'P0001', 'no_pages', 'no pages raises no_pages');
select throws_ok($$select public.finalize_book_upload('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', gen_random_uuid(), pg_temp.pages(401))$$,
  'P0001', 'too_many_pages', 'more than 400 pages raises too_many_pages');

select lives_ok($$select public.finalize_book_upload('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', '60000000-0000-0000-0000-000000000001', pg_temp.pages(10))$$,
  'first upload creates the book row');
select is((select status || '/' || page_count || '/' || upload_id from public.books where curriculum_id = '10000000-0000-0000-0000-0000000028c1'),
  'draft/10/60000000-0000-0000-0000-000000000001', 'book is draft with 10 pages and the upload id');
select is((select count(*)::int from public.book_pages where curriculum_id = '10000000-0000-0000-0000-0000000028c1'), 10, '10 page rows');

-- save_chapters --------------------------------------------------------------------------
select throws_ok($$select public.save_chapters('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', '[{"title":"A","start_page":2}]')$$,
  'P0001', 'invalid_chapters', 'first start 2 is rejected');
select throws_ok($$select public.save_chapters('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', '[{"title":"A","start_page":1},{"title":"B","start_page":1}]')$$,
  'P0001', 'invalid_chapters', 'a duplicate start is rejected');
select throws_ok($$select public.save_chapters('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', '[{"title":"A","start_page":1},{"title":"B","start_page":11}]')$$,
  'P0001', 'invalid_chapters', 'a start above page_count is rejected');
select throws_ok($$select public.save_chapters('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', '[{"title":"A","start_page":1},{"title":"B","start_page":5},{"title":"C","start_page":3}]')$$,
  'P0001', 'invalid_chapters', 'decreasing starts are rejected');
select throws_ok($$select public.save_chapters('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', '[{"title":"  ","start_page":1}]')$$,
  'P0001', 'invalid_chapters', 'an empty title is rejected');
select throws_ok($$select public.save_chapters('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', '[]')$$,
  'P0001', 'invalid_chapters', 'an empty chapter list is rejected');
select is((select count(*)::int from public.chapters where curriculum_id = '10000000-0000-0000-0000-0000000028c1'), 0, 'rejections changed nothing');

-- set_book_status ------------------------------------------------------------------------
select throws_ok($$select public.set_book_status('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', 'published')$$,
  'P0001', 'no_chapters', 'publishing without chapters raises no_chapters');
select lives_ok($$select public.save_chapters('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1',
  '[{"title":"One","start_page":1},{"title":"Two","start_page":4},{"title":"Three","start_page":8}]')$$, 'valid chapters are saved');
select is((select string_agg(title || ':' || start_page, ',' order by start_page) from public.chapters where curriculum_id = '10000000-0000-0000-0000-0000000028c1'),
  'One:1,Two:4,Three:8', 'three chapters stored');
select lives_ok($$select public.set_book_status('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', 'published')$$, 'publishing works with chapters');
select is((select status from public.books where curriculum_id = '10000000-0000-0000-0000-0000000028c1'), 'published', 'status is published');
select throws_ok($$select public.finalize_book_upload('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', gen_random_uuid(), pg_temp.pages(5))$$,
  'P0001', 'book_published', 'uploading over a published book raises book_published');
select lives_ok($$select public.set_book_status('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', 'draft')$$, 'unpublishing works');

-- Second upload with fewer pages ----------------------------------------------------------
select lives_ok($$select public.finalize_book_upload('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', '60000000-0000-0000-0000-000000000002', pg_temp.pages(5))$$,
  're-upload with 5 pages works');
select is((select string_agg(start_page::text, ',' order by start_page) from public.chapters where curriculum_id = '10000000-0000-0000-0000-0000000028c1'),
  '1,4', 'chapters beyond the new page count are deleted, the others stay');
select is((select page_count || '/' || status || '/' || (select count(*) from public.book_pages where curriculum_id = '10000000-0000-0000-0000-0000000028c1')
           from public.books where curriculum_id = '10000000-0000-0000-0000-0000000028c1'), '5/draft/5', 'pages replaced, still draft');

-- Direct access ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000028a3","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.books), 1, 'trainer reads books');
select is((select count(*)::int from public.book_pages) + (select count(*)::int from public.chapters), 7, 'trainer reads pages and chapters');
select throws_ok($$insert into public.books (curriculum_id) values ('10000000-0000-0000-0000-0000000028c2')$$, '42501', null, 'staff cannot insert books');
select throws_ok($$update public.chapters set title = 'x'$$, '42501', null, 'staff cannot update chapters');
select throws_ok($$delete from public.book_pages$$, '42501', null, 'staff cannot delete book_pages');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000028b1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.books) + (select count(*)::int from public.book_pages) + (select count(*)::int from public.chapters), 0, 'student reads nothing');
reset role;
set local role anon;
select throws_ok($$select count(*) from public.books$$, '42501', null, 'anon has no privilege on books');
reset role;

-- Cascade ---------------------------------------------------------------------------------
delete from public.curriculums where id = '10000000-0000-0000-0000-0000000028c1';
select is((select count(*)::int from public.books) + (select count(*)::int from public.book_pages) + (select count(*)::int from public.chapters), 0,
  'deleting a curriculum removes book, pages and chapters');

-- Bucket ----------------------------------------------------------------------------------
select is((select public from storage.buckets where id = 'book-pages'), false, 'bucket book-pages exists and is private');
select is((select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects'
           and (roles && array['anon', 'authenticated', 'public']::name[])
           and (coalesce(qual, '') like '%book-pages%' or coalesce(with_check, '') like '%book-pages%' or (qual is null and with_check is null)
                or coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true')), 0,
  'no storage.objects policy opens book-pages to anon or authenticated');

select * from finish();
rollback;
