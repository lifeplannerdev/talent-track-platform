-- CodeRabbit C3: start_attempt (same signature, service role only) also refuses with
-- 'in_progress' while the student has an attempt in progress on ANOTHER exam set of the same
-- curriculum. grant_attempt already refuses a grant then, but a grant made earlier could still be
-- used, giving two exams at once in one curriculum. Server code closes expired attempts first
-- (getExamStartState walks every exam set of the curriculum with findOpenAttemptId).

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
  -- One exam at a time per curriculum: an attempt in progress on another exam set of it blocks
  -- the start (the unique index only covers the same exam set).
  if exists (
    select 1 from public.attempts a
    join public.exam_sets e on e.id = a.exam_set_id
    where a.student_id = p_student_id and e.curriculum_id = v_curriculum_id
      and a.exam_set_id <> p_exam_set_id and a.status = 'in_progress'
  ) then
    raise exception 'in_progress';
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
