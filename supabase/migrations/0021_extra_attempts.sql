-- Extra attempts (spec change 1): staff give a student more attempts in a curriculum, at any
-- time, which also lifts a block. Replaces grant_attempt (dropped in 0020).
--
-- give_extra_attempts(p_staff_id, p_student_id, p_curriculum_id, p_n, p_allow_repeats):
--   'not_staff' unless p_staff_id is a staff profile (the action passes the session's id after
--   requireRole('staff')); 'invalid_n' unless 1 <= p_n <= 10; locks the assignment row FOR UPDATE
--   ('not_assigned' when missing), so it serialises with start_attempt and record_score;
--   'already_passed' for a passed curriculum. Otherwise adds p_n to extra_attempts, sets
--   allow_repeats when p_allow_repeats is true (false never switches it off) and sets the status
--   back to 'open' when it was 'blocked'. Security invoker, empty search_path, service role only.
--
-- remove_curriculum (0016): same contract without the grants (the table is gone). The assignment
-- row carries extra_attempts / allow_repeats, so deleting it removes them in the same transaction.
--
-- Lock order unchanged (see 0020): assignment row FOR UPDATE first.

create function public.give_extra_attempts(
  p_staff_id uuid,
  p_student_id uuid,
  p_curriculum_id uuid,
  p_n integer,
  p_allow_repeats boolean
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_assignment_id uuid;
  v_status text;
begin
  if p_staff_id is null
     or not exists (select 1 from public.profiles where id = p_staff_id and role = 'staff') then
    raise exception 'not_staff';
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

  update public.assignments
  set extra_attempts = extra_attempts + p_n,
      allow_repeats = allow_repeats or coalesce(p_allow_repeats, false),
      status = case when status = 'blocked' then 'open' else status end
  where id = v_assignment_id;
end;
$$;

create or replace function public.remove_curriculum(p_staff_id uuid, p_student_id uuid, p_curriculum_id uuid, p_confirm boolean)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_assignment_id uuid;
  v_attempts integer;
begin
  if p_staff_id is null
     or not exists (select 1 from public.profiles where id = p_staff_id and role = 'staff') then
    raise exception 'not_staff';
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

revoke all on function
  public.give_extra_attempts(uuid, uuid, uuid, integer, boolean),
  public.remove_curriculum(uuid, uuid, uuid, boolean)
from public, anon, authenticated;
grant execute on function
  public.give_extra_attempts(uuid, uuid, uuid, integer, boolean),
  public.remove_curriculum(uuid, uuid, uuid, boolean)
to service_role;
