-- Phase 2a: curriculum books (page images, chapters) and the private page-image bucket.
-- Spec: docs/superpowers/specs/2026-11-25-phase2-curriculum-reader-design.md.
--
-- books: one per curriculum (draft or published), book_pages: one row per page image (paths in the
-- private bucket book-pages), chapters: titled start pages. Staff read through RLS; nobody writes
-- through a session (privileges revoked): the three service-role functions below do every write and
-- check that p_admin is an active admin. Each locks the books row first (FOR UPDATE).
-- The bucket has no policies on storage.objects: all access goes through the service role.

create table public.books (
  curriculum_id uuid primary key references public.curriculums (id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'published')),
  page_count integer not null default 0 check (page_count >= 0),
  upload_id uuid,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.book_pages (
  curriculum_id uuid not null references public.books (curriculum_id) on delete cascade,
  page_number integer not null check (page_number >= 1),
  path text not null,
  thumb_path text not null,
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  primary key (curriculum_id, page_number)
);

create table public.chapters (
  id uuid primary key default gen_random_uuid(),
  curriculum_id uuid not null references public.books (curriculum_id) on delete cascade,
  title text not null check (length(btrim(title)) > 0),
  start_page integer not null check (start_page >= 1),
  unique (curriculum_id, start_page)
);

alter table public.books enable row level security;
alter table public.book_pages enable row level security;
alter table public.chapters enable row level security;

revoke all on public.books, public.book_pages, public.chapters from anon, authenticated;
grant select on public.books, public.book_pages, public.chapters to authenticated;

create policy books_staff_select on public.books
  for select to authenticated using ((select private.is_staff()));
create policy book_pages_staff_select on public.book_pages
  for select to authenticated using ((select private.is_staff()));
create policy chapters_staff_select on public.chapters
  for select to authenticated using ((select private.is_staff()));

-- ---------------------------------------------------------------------------
-- Functions (service role only)
-- ---------------------------------------------------------------------------
create function public.finalize_book_upload(p_admin uuid, p_curriculum uuid, p_upload uuid, p_pages jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
  v_status text;
begin
  if p_admin is null
     or not exists (select 1 from public.profiles where id = p_admin and role = 'admin' and active) then
    raise exception 'not_admin';
  end if;
  if p_pages is null or jsonb_typeof(p_pages) <> 'array' or jsonb_array_length(p_pages) = 0 then
    raise exception 'no_pages';
  end if;
  v_count := jsonb_array_length(p_pages);
  if v_count > 400 then
    raise exception 'too_many_pages';
  end if;
  -- Pages must be exactly 1..n.
  if (select count(distinct (e ->> 'page')::integer) from jsonb_array_elements(p_pages) e
      where (e ->> 'page')::integer between 1 and v_count) <> v_count then
    raise exception 'invalid_pages';
  end if;

  -- First upload: create the row (no-op when it exists), then lock it.
  insert into public.books (curriculum_id) values (p_curriculum) on conflict (curriculum_id) do nothing;
  select status into v_status from public.books where curriculum_id = p_curriculum for update;
  if v_status = 'published' then
    raise exception 'book_published';
  end if;

  delete from public.book_pages where curriculum_id = p_curriculum;
  insert into public.book_pages (curriculum_id, page_number, path, thumb_path, width, height)
  select p_curriculum, (e ->> 'page')::integer, e ->> 'path', e ->> 'thumb',
         (e ->> 'width')::integer, (e ->> 'height')::integer
  from jsonb_array_elements(p_pages) e;

  delete from public.chapters where curriculum_id = p_curriculum and start_page > v_count;

  update public.books
  set page_count = v_count, upload_id = p_upload, status = 'draft',
      updated_by = p_admin, updated_at = now()
  where curriculum_id = p_curriculum;
end;
$$;

create function public.save_chapters(p_admin uuid, p_curriculum uuid, p_chapters jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_admin is null
     or not exists (select 1 from public.profiles where id = p_admin and role = 'admin' and active) then
    raise exception 'not_admin';
  end if;
  select page_count into v_count from public.books where curriculum_id = p_curriculum for update;
  if not found then
    raise exception 'no_book';
  end if;
  if p_chapters is null or jsonb_typeof(p_chapters) <> 'array' or jsonb_array_length(p_chapters) = 0 then
    raise exception 'invalid_chapters';
  end if;
  if exists (
       select 1 from jsonb_array_elements(p_chapters) e
       where jsonb_typeof(e -> 'title') is distinct from 'string'
          or length(btrim(e ->> 'title')) = 0
          or jsonb_typeof(e -> 'start_page') is distinct from 'number'
          or (e ->> 'start_page') !~ '^[0-9]+$'
     ) then
    raise exception 'invalid_chapters';
  end if;
  if (select (p_chapters -> 0 ->> 'start_page')::integer) <> 1 then
    raise exception 'invalid_chapters';
  end if;
  if exists (
       select 1 from (
         select (e ->> 'start_page')::integer as sp,
                lag((e ->> 'start_page')::integer) over (order by o) as prev
         from jsonb_array_elements(p_chapters) with ordinality t(e, o)
       ) s
       where s.sp > v_count or (s.prev is not null and s.sp <= s.prev)
     ) then
    raise exception 'invalid_chapters';
  end if;

  delete from public.chapters where curriculum_id = p_curriculum;
  insert into public.chapters (curriculum_id, title, start_page)
  select p_curriculum, btrim(e ->> 'title'), (e ->> 'start_page')::integer
  from jsonb_array_elements(p_chapters) e;

  update public.books set updated_by = p_admin, updated_at = now() where curriculum_id = p_curriculum;
end;
$$;

create function public.set_book_status(p_admin uuid, p_curriculum uuid, p_status text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_admin is null
     or not exists (select 1 from public.profiles where id = p_admin and role = 'admin' and active) then
    raise exception 'not_admin';
  end if;
  perform 1 from public.books where curriculum_id = p_curriculum for update;
  if not found then
    raise exception 'no_book';
  end if;
  if p_status is null or p_status not in ('draft', 'published') then
    raise exception 'invalid_status';
  end if;
  if p_status = 'published' and not exists (
       select 1 from public.chapters where curriculum_id = p_curriculum and start_page = 1
     ) then
    raise exception 'no_chapters';
  end if;
  update public.books set status = p_status, updated_by = p_admin, updated_at = now()
  where curriculum_id = p_curriculum;
end;
$$;

revoke all on function public.finalize_book_upload(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.finalize_book_upload(uuid, uuid, uuid, jsonb) to service_role;
revoke all on function public.save_chapters(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_chapters(uuid, uuid, jsonb) to service_role;
revoke all on function public.set_book_status(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.set_book_status(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Private bucket for page images (no policies: service role only)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('book-pages', 'book-pages', false)
on conflict (id) do nothing;
