-- Staff release (Task 6): record who released an attempt.
--
-- release_attempt now takes the releasing staff member's id (p_released_by). Server code
-- (src/lib/release.ts) passes the id of the staff session; record_score passes null for the
-- automatic release of exam sets without held results. Everything else is unchanged:
-- only 'submitted' attempts with a stored score are released, the assignment outcome is
-- written in the same transaction, and a second call is a no-op that changes nothing
-- (released_by is never overwritten). Service role only.
--
-- Release never touches points, max_points or passed: staff only make the stored score visible.

alter table public.attempts
  add column released_by uuid references public.profiles (id) on delete set null;
create index attempts_released_by_idx on public.attempts (released_by);

drop function public.release_attempt(uuid);

create function public.release_attempt(p_attempt_id uuid, p_released_by uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_student_id uuid;
  v_exam_set_id uuid;
  v_passed boolean;
begin
  if p_released_by is not null
     and not exists (select 1 from public.profiles where id = p_released_by and role = 'staff') then
    raise exception 'not_staff';
  end if;

  update public.attempts
  set status = 'released', released_at = now(), released_by = p_released_by
  where id = p_attempt_id
    and status = 'submitted'
    and points is not null
    and passed is not null
  returning student_id, exam_set_id, passed into v_student_id, v_exam_set_id, v_passed;
  if not found then
    return false;
  end if;

  if v_passed then
    update public.assignments asg
    set status = 'passed'
    from public.exam_sets e
    where e.id = v_exam_set_id
      and asg.curriculum_id = e.curriculum_id
      and asg.student_id = v_student_id;
  else
    -- Failed: the assignment stays open. Task 7 adds the blocking rule here.
    null;
  end if;
  return true;
end;
$$;

create or replace function public.record_score(p_attempt_id uuid, p_points integer, p_max_points integer, p_passed boolean)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_hold boolean;
begin
  update public.attempts a
  set points = p_points, max_points = p_max_points, passed = p_passed
  from public.exam_sets e
  where a.id = p_attempt_id
    and e.id = a.exam_set_id
    and a.status = 'submitted'
    and a.points is null
  returning e.hold_result into v_hold;
  if not found then
    return null;
  end if;
  if v_hold then
    return 'submitted';
  end if;
  perform public.release_attempt(p_attempt_id, null);
  return 'released';
end;
$$;

revoke all on function public.release_attempt(uuid, uuid) from public, anon, authenticated;
grant execute on function public.release_attempt(uuid, uuid) to service_role;
