-- v2 Phase 1: ownership checks inside the service-role functions, plus hardening from the
-- review of 0026. Spec: docs/superpowers/specs/2026-11-24-v2-roadmap-and-foundation-design.md.
--
-- 1. private.staff_manages_student(p_staff, p_student): the ownership rule for an explicit staff
--    id (the service-role functions get the staff id as an argument, there is no auth.uid()).
--    An active admin manages every existing student, an active trainer the students whose
--    trainer_id is theirs. The target must be an existing student (role = 'student'), so an
--    admin no longer "manages" a staff profile. private.manages_student(uuid) calls it with
--    auth.uid(). Executable by service_role only (and used internally by manages_student, a
--    security definer function).
-- 2. give_extra_attempts, remove_curriculum, reorder_curriculums raise not_staff (caller is not
--    an active admin or trainer, as before) and then not_your_student (staff does not manage the
--    student, or the student id is not a student). The check reads profiles only and takes no
--    lock, so the lock order stays assignment first. Bodies are those of 0024 (give_extra_attempts)
--    and 0023 / 0021 (reorder_curriculums, remove_curriculum) with the 0026 role check.
-- 3. student_details UPDATE becomes column-level: student_id, created_at and updated_at can not
--    be changed from a session (same approach as 0025).

-- ---------------------------------------------------------------------------
-- 1. Ownership helper
-- ---------------------------------------------------------------------------
create function private.staff_manages_student(p_staff uuid, p_student uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles me
    join public.profiles s on s.id = p_student and s.role = 'student'
    where me.id = p_staff and me.active
      and (me.role = 'admin' or (me.role = 'trainer' and s.trainer_id = me.id))
  );
$$;

revoke all on function private.staff_manages_student(uuid, uuid) from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.staff_manages_student(uuid, uuid) to service_role;

create or replace function private.manages_student(p_student uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.staff_manages_student((select auth.uid()), p_student);
$$;

-- ---------------------------------------------------------------------------
-- 2. Service-role functions with the ownership check
-- ---------------------------------------------------------------------------
create or replace function public.give_extra_attempts(
  p_staff_id uuid,
  p_student_id uuid,
  p_curriculum_id uuid,
  p_n integer,
  p_allow_repeats boolean
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_assignment_id uuid;
  v_status text;
  v_used integer;
  v_max_attempts integer;
begin
  if p_staff_id is null
     or not exists (select 1 from public.profiles where id = p_staff_id and role in ('admin', 'trainer') and active) then
    raise exception 'not_staff';
  end if;
  if not private.staff_manages_student(p_staff_id, p_student_id) then
    raise exception 'not_your_student';
  end if;
  if p_n is null or p_n < 1 or p_n > 10 then
    raise exception 'invalid_n';
  end if;

  select id, status into v_assignment_id, v_status
  from public.assignments
  where student_id = p_student_id and curriculum_id = p_curriculum_id
  for update;
  if not found then
    raise exception 'not_assigned';
  end if;
  if v_status = 'passed' then
    raise exception 'already_passed';
  end if;

  -- Attempts used in the curriculum (submitted or released) and the limit, read under the lock.
  select count(*) into v_used
  from public.attempts a
  join public.exam_sets e on e.id = a.exam_set_id
  where a.student_id = p_student_id and e.curriculum_id = p_curriculum_id
    and a.status in ('submitted', 'released');
  select max_attempts into v_max_attempts from public.curriculums where id = p_curriculum_id;

  -- The extra attempts always count; a block is lifted only when the new allowance exceeds the
  -- attempts already used (otherwise the student still has nothing to start).
  update public.assignments
  set extra_attempts = extra_attempts + p_n,
      allow_repeats = allow_repeats or coalesce(p_allow_repeats, false),
      status = case
        when status = 'blocked' and v_max_attempts + extra_attempts + p_n > v_used then 'open'
        else status
      end
  where id = v_assignment_id;
end;
$$;

create or replace function public.remove_curriculum(p_staff_id uuid, p_student_id uuid, p_curriculum_id uuid, p_confirm boolean)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_assignment_id uuid;
  v_attempts integer;
begin
  if p_staff_id is null
     or not exists (select 1 from public.profiles where id = p_staff_id and role in ('admin', 'trainer') and active) then
    raise exception 'not_staff';
  end if;
  if not private.staff_manages_student(p_staff_id, p_student_id) then
    raise exception 'not_your_student';
  end if;

  select id into v_assignment_id
  from public.assignments
  where student_id = p_student_id and curriculum_id = p_curriculum_id
  for update;
  if not found then
    raise exception 'not_assigned';
  end if;

  if exists (
    select 1 from public.attempts a
    join public.exam_sets e on e.id = a.exam_set_id
    where a.student_id = p_student_id and e.curriculum_id = p_curriculum_id and a.status = 'in_progress'
  ) then
    raise exception 'in_progress';
  end if;

  select count(*) into v_attempts
  from public.attempts a
  join public.exam_sets e on e.id = a.exam_set_id
  where a.student_id = p_student_id and e.curriculum_id = p_curriculum_id;
  if v_attempts > 0 and p_confirm is not true then
    return jsonb_build_object('ok', false, 'code', 'has_attempts', 'attempts', v_attempts);
  end if;

  delete from public.assignments where id = v_assignment_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.reorder_curriculums(p_staff_id uuid, p_student_id uuid, p_curriculum_ids uuid[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_current uuid[];
begin
  if p_staff_id is null
     or not exists (select 1 from public.profiles where id = p_staff_id and role in ('admin', 'trainer') and active) then
    raise exception 'not_staff';
  end if;
  if not private.staff_manages_student(p_staff_id, p_student_id) then
    raise exception 'not_your_student';
  end if;

  select coalesce(array_agg(curriculum_id order by curriculum_id), '{}') into v_current
  from (
    select curriculum_id from public.assignments where student_id = p_student_id order by id for update
  ) locked;

  if p_curriculum_ids is null
     or cardinality(p_curriculum_ids) <> cardinality(v_current)
     or (select count(distinct c) from unnest(p_curriculum_ids) c) <> cardinality(v_current)
     or exists (select 1 from unnest(p_curriculum_ids) c where c is null or not (c = any (v_current))) then
    raise exception 'order_mismatch';
  end if;

  update public.assignments a
  set position = o.ordinality
  from unnest(p_curriculum_ids) with ordinality o(curriculum_id, ordinality)
  where a.student_id = p_student_id and a.curriculum_id = o.curriculum_id;
end;
$$;

revoke all on function public.give_extra_attempts(uuid, uuid, uuid, integer, boolean) from public, anon, authenticated;
grant execute on function public.give_extra_attempts(uuid, uuid, uuid, integer, boolean) to service_role;
revoke all on function public.remove_curriculum(uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.remove_curriculum(uuid, uuid, uuid, boolean) to service_role;
revoke all on function public.reorder_curriculums(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.reorder_curriculums(uuid, uuid, uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- 3. student_details: column-level UPDATE
-- ---------------------------------------------------------------------------
revoke update on public.student_details from authenticated;
grant update (
  contact_email, phone, guardian_name, guardian_phone, date_of_birth, gender, address,
  passport_number, passport_expiry, destination_country, target_intake, german_level,
  qualification, joined_on, programme_start, status, notes
) on public.student_details to authenticated;
