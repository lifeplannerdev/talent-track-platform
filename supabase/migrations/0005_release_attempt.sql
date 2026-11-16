-- Release and assignment outcome in one transaction (Task 5 review).
--
-- release_attempt: submitted (with a stored score) -> released. If the attempt passed, the
-- student's assignment for the exam set's curriculum becomes 'passed' in the same call, so
-- the release and the student-visible outcome commit or fail together. Idempotent: returns
-- false (and changes nothing) unless this call released the attempt. Staff release (Task 6)
-- reuses it; Task 7 adds the blocking rule for failed attempts here.
--
-- record_score now only stores the score and, for exam sets without held results, calls
-- release_attempt in the same transaction. Held attempts change nothing student-visible.

create function public.release_attempt(p_attempt_id uuid)
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
  update public.attempts
  set status = 'released', released_at = now()
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
  perform public.release_attempt(p_attempt_id);
  return 'released';
end;
$$;

revoke all on function public.release_attempt(uuid) from public, anon, authenticated;
grant execute on function public.release_attempt(uuid) to service_role;
