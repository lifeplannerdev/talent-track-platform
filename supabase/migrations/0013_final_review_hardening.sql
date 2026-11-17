-- Final review hardening (phase 1).
--
-- 1. Default privileges: functions created later by the migration role are not executable by
--    PUBLIC. PostgreSQL grants EXECUTE to PUBLIC on every new function by default, and anon and
--    authenticated inherit PUBLIC, so the per-schema revokes in 0002 were not enough. Every
--    function that callers need already grants EXECUTE explicitly.
-- 2. Staff have no DELETE privilege on profiles, curriculums or exam_sets (0012 removed the
--    policies; this removes the privilege so a delete fails with 42501 instead of matching no
--    rows). Removing such rows stays a service-role operation (deleteStudent for students).
-- 3. start_attempt (same signature, service role only) also refuses:
--      not_open        - the student's assignment for the curriculum is missing or not 'open'
--                        (blocked or passed), even if an unused grant exists;
--      result_pending  - the student has a held (submitted, unreleased) attempt on any exam set
--                        of the curriculum. Blocking is decided at release, so starting another
--                        set before that would let the student run past a pending block.
--    The assignment row is locked FOR SHARE, so a concurrent release that blocks waits or is
--    seen.

-- 1 ---------------------------------------------------------------------------
alter default privileges revoke execute on functions from public;

-- 2 ---------------------------------------------------------------------------
revoke delete on public.profiles, public.curriculums, public.exam_sets from authenticated;

-- 3 ---------------------------------------------------------------------------
create or replace function public.start_attempt(p_student_id uuid, p_exam_set_id uuid, p_draw jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_grant_id uuid;
  v_granted_by uuid;
  v_time_limit integer;
  v_question_count integer;
  v_curriculum_id uuid;
  v_assignment_status text;
  v_attempt_id uuid;
begin
  select time_limit_min, question_count, curriculum_id into v_time_limit, v_question_count, v_curriculum_id
  from public.exam_sets where id = p_exam_set_id;
  if not found then
    raise exception 'exam_set_not_found';
  end if;

  select status into v_assignment_status
  from public.assignments
  where student_id = p_student_id and curriculum_id = v_curriculum_id
  for share;
  if not found or v_assignment_status <> 'open' then
    raise exception 'not_open';
  end if;
  if exists (
    select 1 from public.attempts a
    join public.exam_sets e on e.id = a.exam_set_id
    where a.student_id = p_student_id and e.curriculum_id = v_curriculum_id and a.status = 'submitted'
  ) then
    raise exception 'result_pending';
  end if;

  if jsonb_typeof(p_draw) <> 'array' or jsonb_array_length(p_draw) <> v_question_count then
    raise exception 'invalid_draw';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_draw) d
    left join public.questions q
      on q.id = (d ->> 'question_id')::uuid and q.exam_set_id = p_exam_set_id and q.status = 'approved'
    where q.id is null
  ) then
    raise exception 'invalid_draw';
  end if;
  -- Never hand a student a question they were already given in this exam set.
  if exists (
    select 1
    from jsonb_array_elements(p_draw) d
    join public.attempt_questions aq on aq.question_id = (d ->> 'question_id')::uuid
    join public.attempts a on a.id = aq.attempt_id
    where a.student_id = p_student_id
  ) then
    raise exception 'question_already_seen';
  end if;

  select id, granted_by into v_grant_id, v_granted_by
  from public.attempt_grants
  where student_id = p_student_id and exam_set_id = p_exam_set_id and used_attempt_id is null
  order by id
  limit 1
  for update; -- a concurrent start waits here, then sees the grant as used
  if not found then
    raise exception 'no_grant';
  end if;

  begin
    insert into public.attempts (student_id, exam_set_id, status, started_at, deadline_at, granted_by)
    values (p_student_id, p_exam_set_id, 'in_progress', now(), now() + make_interval(mins => v_time_limit), v_granted_by)
    returning id into v_attempt_id;
  exception when unique_violation then
    raise exception 'in_progress';
  end;

  insert into public.attempt_questions (attempt_id, question_id, position, option_order)
  select v_attempt_id,
         (d.value ->> 'question_id')::uuid,
         d.ordinality,
         array(select jsonb_array_elements_text(d.value -> 'option_order'))
  from jsonb_array_elements(p_draw) with ordinality d;

  update public.attempt_grants set used_attempt_id = v_attempt_id
  where id = v_grant_id and used_attempt_id is null;

  return v_attempt_id;
end;
$$;

revoke all on function public.start_attempt(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.start_attempt(uuid, uuid, jsonb) to service_role;
