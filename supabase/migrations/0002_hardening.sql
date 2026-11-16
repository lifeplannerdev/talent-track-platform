-- Hardening after review of 0001.
--
-- 1. Students no longer read public.assignments directly. status 'passed'/'blocked'
--    could reveal a held result, so they read public.student_assignments, where the
--    status is masked to 'open' while the student has a submitted (held, unreleased)
--    attempt on an exam set of that assignment's curriculum.
-- 2. Later migrations must not auto-grant table, sequence or function privileges.
-- 3. The profile trigger requires a username in raw_app_meta_data.

-- 1. assignments ------------------------------------------------------------
drop policy assignments_select_own on public.assignments;

create view public.student_assignments as
select
  asg.id,
  asg.student_id,
  asg.curriculum_id,
  asg.position,
  case
    when exists (
      select 1
      from public.attempts a
      join public.exam_sets e on e.id = a.exam_set_id
      where a.student_id = asg.student_id
        and e.curriculum_id = asg.curriculum_id
        and a.status = 'submitted'
    ) then 'open'
    else asg.status
  end as status
from public.assignments asg
where asg.student_id = (select auth.uid());

revoke all on public.student_assignments from public, anon, authenticated;
grant select on public.student_assignments to authenticated;

-- 2. default privileges -------------------------------------------------------
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- 3. profile trigger ----------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.raw_app_meta_data ->> 'username', '') = '' then
    raise exception 'username is required in raw_app_meta_data';
  end if;
  insert into public.profiles (id, role, username, full_name, batch, track)
  values (
    new.id,
    coalesce(new.raw_app_meta_data ->> 'role', 'student'),
    lower(new.raw_app_meta_data ->> 'username'),
    new.raw_app_meta_data ->> 'full_name',
    new.raw_app_meta_data ->> 'batch',
    new.raw_app_meta_data ->> 'track'
  );
  return new;
end;
$$;

-- 1b. curriculums / exam_sets policies used to subquery assignments under the
--     student's own RLS. With the student policy on assignments gone they need a
--     security definer helper instead.
create function private.is_assigned_to_curriculum(p_curriculum_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.assignments
    where curriculum_id = p_curriculum_id and student_id = (select auth.uid())
  );
$$;

revoke all on function private.is_assigned_to_curriculum(uuid) from public, anon;
grant execute on function private.is_assigned_to_curriculum(uuid) to authenticated;

drop policy curriculums_select_assigned on public.curriculums;
create policy curriculums_select_assigned on public.curriculums
  for select to authenticated
  using ((select private.is_assigned_to_curriculum(id)));

drop policy exam_sets_select_assigned on public.exam_sets;
create policy exam_sets_select_assigned on public.exam_sets
  for select to authenticated
  using ((select private.is_assigned_to_curriculum(curriculum_id)));
