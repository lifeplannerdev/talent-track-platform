-- Phase 2a, migration 0028: books, book_pages, chapters, the three service-role functions and the
-- private book-pages bucket (pgTAP). Run: npm run db:test
begin;
select plan(101);

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

select throws_ok($$select public.finalize_book_upload('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028ff', gen_random_uuid(), pg_temp.pages(3))$$,
  'P0001', 'no_curriculum', 'an unknown curriculum raises no_curriculum');
select throws_ok($$select public.finalize_book_upload('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', gen_random_uuid(), '[{"page":"x","path":"p","thumb":"t","width":1,"height":1}]')$$,
  'P0001', 'invalid_pages', 'a non-numeric page is a named error');
select throws_ok($$select public.finalize_book_upload('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', gen_random_uuid(), '[{"page":1,"path":"p","thumb":"t","width":99999999999,"height":1}]')$$,
  'P0001', 'invalid_pages', 'a huge width is a named error');
select throws_ok($$select public.finalize_book_upload('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', gen_random_uuid(), '[{"page":1,"path":null,"thumb":"t","width":1,"height":1}]')$$,
  'P0001', 'invalid_pages', 'a null path is a named error');
select throws_ok($$select public.finalize_book_upload('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', gen_random_uuid(), '[null]')$$,
  'P0001', 'invalid_pages', 'a null element is a named error');
select throws_ok($$select public.finalize_book_upload('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', gen_random_uuid(), '[{"page":1,"path":"p","thumb":"t","width":1,"height":1},{"page":3,"path":"p","thumb":"t","width":1,"height":1}]')$$,
  'P0001', 'invalid_pages', 'pages that are not 1..n are rejected');
select is((select count(*)::int from public.books where curriculum_id = '10000000-0000-0000-0000-0000000028c1'), 0, 'failed first uploads created no book row');

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
select throws_ok($$select public.save_chapters('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', null)$$,
  'P0001', 'invalid_chapters', 'a null chapter list is rejected');
select throws_ok($$select public.save_chapters('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', '{"title":"A","start_page":1}')$$,
  'P0001', 'invalid_chapters', 'a non-array chapter list is rejected');
select throws_ok($$select public.save_chapters('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', '[{"title":"A","start_page":"x"}]')$$,
  'P0001', 'invalid_chapters', 'a non-numeric start is a named error');
select throws_ok($$select public.save_chapters('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', '[{"title":"A","start_page":99999999999}]')$$,
  'P0001', 'invalid_chapters', 'a huge start is a named error');
select throws_ok($$select public.save_chapters('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', '[{"title":null,"start_page":1}]')$$,
  'P0001', 'invalid_chapters', 'a null title is a named error');
select throws_ok($$select public.save_chapters('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', '[{"id":"nope","title":"A","start_page":1}]')$$,
  'P0001', 'invalid_chapters', 'a malformed id is a named error');
select throws_ok($$select public.save_chapters('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', '[1]')$$,
  'P0001', 'invalid_chapters', 'a non-object element is a named error');
select is((select count(*)::int from public.chapters where curriculum_id = '10000000-0000-0000-0000-0000000028c1'), 0, 'rejections changed nothing');

-- set_book_status ------------------------------------------------------------------------
select throws_ok($$select public.set_book_status('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', 'published')$$,
  'P0001', 'no_chapters', 'publishing without chapters raises no_chapters');
select lives_ok($$select public.save_chapters('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1',
  '[{"title":"One","start_page":1},{"title":"Two","start_page":4},{"title":"Three","start_page":8}]')$$, 'valid chapters are saved');
select is((select string_agg(title || ':' || start_page, ',' order by start_page) from public.chapters where curriculum_id = '10000000-0000-0000-0000-0000000028c1'),
  'One:1,Two:4,Three:8', 'three chapters stored');
create temp table ch as select title, id from public.chapters where curriculum_id = '10000000-0000-0000-0000-0000000028c1';
grant select on ch to public;
select lives_ok($$select public.save_chapters('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', jsonb_build_array(
  jsonb_build_object('id', (select id from ch where title = 'One'), 'title', 'One', 'start_page', 1),
  jsonb_build_object('id', (select id from ch where title = 'Two'), 'title', 'Two b', 'start_page', 4),
  jsonb_build_object('id', (select id from ch where title = 'Three'), 'title', 'Three', 'start_page', 8)))$$, 'title edit saves');
select is((select count(*)::int from public.chapters c join ch on ch.id = c.id where curriculum_id = '10000000-0000-0000-0000-0000000028c1'), 3, 'ids unchanged after a title edit');
select is((select title from public.chapters where id = (select id from ch where title = 'Two')), 'Two b', 'title updated');
select lives_ok($$select public.save_chapters('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', jsonb_build_array(
  jsonb_build_object('id', (select id from ch where title = 'One'), 'title', 'One', 'start_page', 1),
  jsonb_build_object('title', 'Half', 'start_page', 2),
  jsonb_build_object('id', (select id from ch where title = 'Two'), 'title', 'Two b', 'start_page', 4),
  jsonb_build_object('id', (select id from ch where title = 'Three'), 'title', 'Three', 'start_page', 8)))$$, 'adding a marker saves');
select is((select count(*)::int from public.chapters c join ch on ch.id = c.id where curriculum_id = '10000000-0000-0000-0000-0000000028c1'), 3, 'ids unchanged after adding a marker before');
select is((select count(*)::int from public.chapters where curriculum_id = '10000000-0000-0000-0000-0000000028c1'), 4, 'four chapters now');
create temp table half as select id from public.chapters where title = 'Half' and curriculum_id = '10000000-0000-0000-0000-0000000028c1';
grant select on half to public;
select lives_ok($$select public.save_chapters('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', jsonb_build_array(
  jsonb_build_object('id', (select id from ch where title = 'One'), 'title', 'One', 'start_page', 1),
  jsonb_build_object('id', (select id from ch where title = 'Two'), 'title', 'Two b', 'start_page', 2),
  jsonb_build_object('id', (select id from half), 'title', 'Half', 'start_page', 4),
  jsonb_build_object('id', (select id from ch where title = 'Three'), 'title', 'Three', 'start_page', 8)))$$, 'swapping start pages saves');
select is((select start_page from public.chapters where id = (select id from ch where title = 'Two')), 2, 'Two moved to page 2 with the same id');
select is((select start_page from public.chapters where id = (select id from half)), 4, 'Half moved to page 4 with the same id');
select lives_ok($$select public.save_chapters('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', jsonb_build_array(
  jsonb_build_object('id', (select id from ch where title = 'One'), 'title', 'One', 'start_page', 1),
  jsonb_build_object('id', (select id from ch where title = 'Two'), 'title', 'Two b', 'start_page', 2),
  jsonb_build_object('id', (select id from ch where title = 'Three'), 'title', 'Three', 'start_page', 8)))$$, 'removing a marker saves');
select is((select count(*)::int from public.chapters c join ch on ch.id = c.id where curriculum_id = '10000000-0000-0000-0000-0000000028c1'), 3, 'only the removed chapter is gone');
select is((select count(*)::int from public.chapters where id = (select id from half)), 0, 'Half was deleted');

select lives_ok($$select public.finalize_book_upload('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c2', gen_random_uuid(), pg_temp.pages(3))$$, 'second curriculum gets a book');
select lives_ok($$select public.save_chapters('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c2', '[{"title":"Other","start_page":1}]')$$, 'second curriculum gets a chapter');
create temp table other as select id from public.chapters where curriculum_id = '10000000-0000-0000-0000-0000000028c2';
grant select on other to public;
select throws_ok($$select public.save_chapters('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', jsonb_build_array(
  jsonb_build_object('id', (select id from other), 'title', 'Stolen', 'start_page', 1)))$$,
  'P0001', 'invalid_chapters', 'a chapter id of another curriculum is rejected');
select throws_ok($$select public.save_chapters('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', jsonb_build_array(
  jsonb_build_object('id', gen_random_uuid(), 'title', 'Ghost', 'start_page', 1)))$$,
  'P0001', 'invalid_chapters', 'an unknown chapter id is rejected');
select throws_ok($$select public.save_chapters('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', jsonb_build_array(
  jsonb_build_object('id', (select id from ch where title = 'One'), 'title', 'One', 'start_page', 1),
  jsonb_build_object('id', (select id from ch where title = 'One'), 'title', 'One', 'start_page', 2)))$$,
  'P0001', 'invalid_chapters', 'a repeated id is rejected');
select is((select string_agg(title || ':' || start_page, ',' order by start_page) from public.chapters where curriculum_id = '10000000-0000-0000-0000-0000000028c1'),
  'One:1,Two b:2,Three:8', 'rejections changed nothing');
select is((select title from public.chapters where id = (select id from other)), 'Other', 'the other curriculum chapter is untouched');
select lives_ok($$select public.save_chapters('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', jsonb_build_array(
  jsonb_build_object('id', (select id from ch where title = 'One'), 'title', 'One', 'start_page', 1),
  jsonb_build_object('id', (select id from ch where title = 'Two'), 'title', 'Two', 'start_page', 4),
  jsonb_build_object('id', (select id from ch where title = 'Three'), 'title', 'Three', 'start_page', 8)))$$, 'restore One, Two, Three');
select lives_ok($$select public.save_chapters('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c2', '[]')$$, 'an empty list clears a draft book');
select is((select count(*)::int from public.chapters where curriculum_id = '10000000-0000-0000-0000-0000000028c2'), 0, 'draft book has no chapters');
select lives_ok($$select public.set_book_status('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', 'published')$$, 'publishing works with chapters');
select is((select status from public.books where curriculum_id = '10000000-0000-0000-0000-0000000028c1'), 'published', 'status is published');
select throws_ok($$select public.save_chapters('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', '[]')$$,
  'P0001', 'no_chapters', 'an empty list on a published book raises no_chapters');
select is((select count(*)::int from public.chapters where curriculum_id = '10000000-0000-0000-0000-0000000028c1'), 3, 'published book kept its chapters');
select throws_ok($$select public.set_book_status('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', 'archived')$$,
  'P0001', 'invalid_status', 'an unknown status is rejected');
select throws_ok($$select public.finalize_book_upload('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', gen_random_uuid(), pg_temp.pages(5))$$,
  'P0001', 'book_published', 'uploading over a published book raises book_published');
select is((select count(*)::int from public.book_pages where curriculum_id = '10000000-0000-0000-0000-0000000028c1') || '/' || (select count(*)::int from public.chapters where curriculum_id = '10000000-0000-0000-0000-0000000028c1'), '10/3', 'book_published left pages and chapters intact');
select lives_ok($$select public.set_book_status('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', 'draft')$$, 'unpublishing works');
select throws_ok($$select public.finalize_book_upload('00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028c1', gen_random_uuid(), '[{"page":2,"path":"p","thumb":"t","width":1,"height":1}]')$$,
  'P0001', 'invalid_pages', 'a bad re-upload is rejected');
select is((select count(*)::int from public.book_pages where curriculum_id = '10000000-0000-0000-0000-0000000028c1') || '/' || (select count(*)::int from public.chapters where curriculum_id = '10000000-0000-0000-0000-0000000028c1') || '/' || (select page_count from public.books where curriculum_id = '10000000-0000-0000-0000-0000000028c1'), '10/3/10', 'invalid_pages left pages and chapters intact');

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
select is((select count(*)::int from public.books), 2, 'trainer reads books');
select is((select count(*)::int from public.book_pages) + (select count(*)::int from public.chapters), 10, 'trainer reads pages and chapters');
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
select is((select count(*)::int from public.books where curriculum_id = '10000000-0000-0000-0000-0000000028c1') + (select count(*)::int from public.book_pages where curriculum_id = '10000000-0000-0000-0000-0000000028c1')
        + (select count(*)::int from public.chapters where curriculum_id = '10000000-0000-0000-0000-0000000028c1'), 0,
  'deleting a curriculum removes book, pages and chapters');
select is((select count(*)::int from public.book_pages where curriculum_id = '10000000-0000-0000-0000-0000000028c2'), 3, 'other curriculum untouched');

-- Bucket ----------------------------------------------------------------------------------
select is((select public from storage.buckets where id = 'book-pages'), false, 'bucket book-pages exists and is private');
select is((select file_size_limit from storage.buckets where id = 'book-pages'), 5242880::bigint, 'bucket limits images to 5 MiB');
select is((select allowed_mime_types from storage.buckets where id = 'book-pages'), array['image/webp'], 'bucket accepts only image/webp');
insert into storage.objects (bucket_id, name) values ('book-pages', 'c/u/1.webp');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000028a1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from storage.objects where bucket_id = 'book-pages'), 0, 'authenticated reads no book-pages object');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('book-pages', 'c/u/2.webp')$$, '42501', null, 'authenticated cannot upload to book-pages');
reset role;
set local role anon;
select is((select count(*)::int from storage.objects where bucket_id = 'book-pages'), 0, 'anon reads no book-pages object');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('book-pages', 'c/u/3.webp')$$, '42501', null, 'anon cannot upload to book-pages');
reset role;

select * from finish();
rollback;
