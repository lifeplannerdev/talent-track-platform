-- grant_attempt per curriculum (Task 7 review).
--
-- A grant made while a result was held could leave a student blocked with an unusable grant:
-- the failed release blocks the curriculum, the student can no longer start, and staff got
-- grant_exists. Blocking is per curriculum, so the guards are too:
--   * in_progress    - an attempt is in progress on ANY exam set of the curriculum;
--   * result_pending - an attempt is submitted (held, not released) on ANY exam set of the
--                      curriculum: wait for the release, which may block or pass.
-- Recovery: if the assignment is blocked and an unused grant for this exam set already exists
-- (state left by older code or a race), the call lifts the block and returns ok instead of
-- refusing with grant_exists, so staff can always recover. Nothing is stacked.
-- Everything else is unchanged (same signature, service role only, security invoker).

create or replace function public.grant_attempt(p_student_id uuid, p_exam_set_id uuid, p_staff_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_curriculum_id uuid;
  v_needed integer;
  v_mix jsonb;
  v_assignment_id uuid;
  v_assignment_status text;
  v_unseen integer;
begin
  if p_staff_id is null
     or not exists (select 1 from public.profiles where id = p_staff_id and role = 'staff') then
    raise exception 'not_staff';
  end if;

  select curriculum_id, question_count, topic_mix into v_curriculum_id, v_needed, v_mix
  from public.exam_sets where id = p_exam_set_id;
  if not found then
    raise exception 'exam_set_not_found';
  end if;

  -- Locking the assignment serialises concurrent grants for the same student and curriculum,
  -- so two clicks cannot both pass the no-stacking check.
  select id, status into v_assignment_id, v_assignment_status
  from public.assignments
  where student_id = p_student_id and curriculum_id = v_curriculum_id
  for update;
  if not found then
    raise exception 'not_assigned';
  end if;
  if v_assignment_status = 'passed' then
    raise exception 'assignment_passed';
  end if;

  if exists (
    select 1 from public.attempts a
    join public.exam_sets e on e.id = a.exam_set_id
    where a.student_id = p_student_id and e.curriculum_id = v_curriculum_id and a.status = 'in_progress'
  ) then
    raise exception 'in_progress';
  end if;
  if exists (
    select 1 from public.attempts a
    join public.exam_sets e on e.id = a.exam_set_id
    where a.student_id = p_student_id and e.curriculum_id = v_curriculum_id and a.status = 'submitted'
  ) then
    raise exception 'result_pending';
  end if;

  if exists (
    select 1 from public.attempt_grants
    where student_id = p_student_id and exam_set_id = p_exam_set_id and used_attempt_id is null
  ) then
    if v_assignment_status = 'blocked' then
      -- Recovery: the existing grant becomes usable again.
      update public.assignments set status = 'open' where id = v_assignment_id;
      return jsonb_build_object('ok', true);
    end if;
    raise exception 'grant_exists';
  end if;

  with unseen as (
    select q.topic
    from public.questions q
    where q.exam_set_id = p_exam_set_id
      and q.status = 'approved'
      and not exists (
        select 1
        from public.attempt_questions aq
        join public.attempts a on a.id = aq.attempt_id
        where aq.question_id = q.id and a.student_id = p_student_id
      )
  )
  select case
    when v_mix is null or v_mix = '{}'::jsonb then (select count(*) from unseen)
    else (
      select coalesce(sum(least(
        (select count(*) from unseen u where u.topic = m.key),
        m.value::integer
      )), 0)
      from jsonb_each_text(v_mix) m
    )
  end
  into v_unseen;

  if v_unseen < v_needed then
    return jsonb_build_object('ok', false, 'unseen_available', v_unseen, 'needed', v_needed);
  end if;

  insert into public.attempt_grants (student_id, exam_set_id, granted_by)
  values (p_student_id, p_exam_set_id, p_staff_id);

  -- Staff override after a block: unblocked in the same transaction as the grant.
  update public.assignments set status = 'open'
  where id = v_assignment_id and status = 'blocked';

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.grant_attempt(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.grant_attempt(uuid, uuid, uuid) to service_role;
